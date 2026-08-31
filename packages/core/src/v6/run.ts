/**
 * v6 PROTOTYPE driver. Everything impure lives here, in four shapes:
 *
 *   sense()          every DOM read of a frame, packaged as a Reading
 *   dispatch()       the single mutation site: decide → commit → sync → notify
 *   four slots       resources derived from state; changing deps restarts them
 *   getSnapshot()    a plain read: the snapshot is rebuilt eagerly in dispatch
 *
 * There is no enterStep, no release ordering, no re-entrancy guard: moving
 * between Steps is decide returning a rebuilt State, and the slots noticing
 * their deps changed.
 */
import { keyAction, whereClicked } from "../v5/input";
import { advanceRule, selectorFor } from "../v5/tutorial";
import type {
  Action,
  Rect,
  Run,
  RunEvent,
  RunOptions,
  Snapshot,
  Step,
  Tutorial,
} from "../v5/types";
import { canAdvance, decide, goTo, sameView } from "./decide";
import type { Ctx, Input, Note, Reading, State } from "./decide";

const NO_UI = { dialog: null, beacon: null };

// ---- slots: a resource is live iff its deps are non-null ---------------------
type Slot = { deps: readonly unknown[] | null; stop: () => void };
const noop = () => {};
const newSlot = (): Slot => ({ deps: null, stop: noop });
const sameDeps = (a: readonly unknown[] | null, b: readonly unknown[] | null) =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

function sync(
  s: Slot,
  deps: readonly unknown[] | null,
  start: () => () => void,
) {
  if (sameDeps(s.deps, deps)) return;
  s.stop();
  s.deps = deps;

  if (deps) {
    const cleanup = start();
    s.stop = cleanup;
  } else {
    s.stop = noop;
  }
}

const LIVE: readonly unknown[] = [];

const copyRect = (rect: DOMRect): Rect => ({
  x: rect.x,
  y: rect.y,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

const onScreen = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

export function createRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;
  const ui = options.ui ?? (() => NO_UI);
  const steps = tutorial.steps;
  const ctx: Ctx = { steps, rules: steps.map(advanceRule) };

  const listeners = new Set<() => void>();
  let state: State = goTo(options.startAt ?? 0, ctx);
  let started = false;

  // ---- the snapshot: rebuilt eagerly, in the one place state changes ---------
  // dispatch is the single mutation site, so building on view change there
  // cannot go stale; getSnapshot is a plain read of the current build.
  const buildSnapshot = (): Snapshot<TStep> =>
    state.phase === "running"
      ? {
          phase: "running",
          step: steps[state.index],
          stepIndex: state.index,
          stepCount: steps.length,
          canAdvance: canAdvance(state, ctx),
          collapsed: state.collapsed,
          waymark: state.location,
        }
      : { phase: state.phase, stepIndex: state.index, stepCount: steps.length };

  let snapshot: Snapshot<TStep> = buildSnapshot();
  const getSnapshot = (): Snapshot<TStep> => snapshot;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const emit = (note: Note) =>
    options.onEvent?.({
      type: note.type as RunEvent<TStep>["type"],
      step: steps[note.stepIndex],
      stepIndex: note.stepIndex,
      snapshot: getSnapshot(),
    });

  // ---- the sensor: the only per-frame DOM reads, packaged as data ------------
  const sense = (): Reading => {
    const selector = selectorFor(steps[state.index]);
    const el =
      selector === undefined
        ? null
        : state.el?.isConnected
          ? state.el
          : root.querySelector(selector);
    const rect = el ? copyRect(el.getBoundingClientRect()) : null;
    return {
      el,
      rect,
      inView: rect !== null && onScreen(rect),
      conditionHolds: ctx.rules[state.index]?.byCheck?.(el) ?? false,
      now: performance.now(),
    };
  };

  // ---- the single mutation site ----------------------------------------------
  const dispatch = (input: Input) => {
    const out = decide(state, input, ctx);
    if (out.state !== state) {
      const viewChanged = !sameView(state, out.state);
      state = out.state;
      if (viewChanged) snapshot = buildSnapshot();
      syncSlots();
      if (viewChanged) notify();
    }
    for (const note of out.notes) emit(note);
    out.scroll?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const frame = () => dispatch({ type: "frame", reading: sense() });

  const inputContext = () => ({
    collapsed: state.collapsed,
    element: state.el,
    rect: state.location.status === "found" ? state.location.rect : null,
    padding,
    ui: ui(),
  });

  // ---- the four resources, named, visible, and nothing else ------------------
  const frameLoop = newSlot();
  const windowInput = newSlot();
  const aria = newSlot();
  const waymarkEvents = newSlot();

  const isWatched = () => listeners.size > 0 && state.phase === "running";

  function syncSlots() {
    const watched = isWatched();
    const el = state.el;
    const rule = ctx.rules[state.index];

    sync(frameLoop, watched ? LIVE : null, () => {
      let id = requestAnimationFrame(function tick() {
        id = requestAnimationFrame(tick);
        frame();
      });
      return () => cancelAnimationFrame(id);
    });

    sync(windowInput, watched ? LIVE : null, () => {
      const control = new AbortController();
      const { signal } = control;
      window.addEventListener(
        "click",
        (event) => {
          const hit = whereClicked(event, inputContext());
          if (hit === "waymark") {
            if (ctx.rules[state.index]?.byClick) {
              dispatch({ type: "conditionMet", now: performance.now() });
            }
          } else if (hit === "away") {
            dispatch({ type: "collapse" });
          }
        },
        { capture: true, signal },
      );
      window.addEventListener(
        "keydown",
        (event) => {
          const action = keyAction(event, inputContext());
          if (action) dispatch({ type: action });
        },
        { signal },
      );
      return () => control.abort();
    });

    sync(aria, watched && el ? [el] : null, () => {
      el!.setAttribute("aria-haspopup", "dialog");
      el!.setAttribute("aria-expanded", "true");
      return () => {
        el!.removeAttribute("aria-haspopup");
        el!.removeAttribute("aria-expanded");
      };
    });

    sync(
      waymarkEvents,
      watched && el && rule && rule.byEvents.length > 0
        ? [el, state.index]
        : null,
      () => {
        const control = new AbortController();
        for (const name of rule!.byEvents) {
          el!.addEventListener(
            name,
            () => dispatch({ type: "conditionMet", now: performance.now() }),
            { signal: control.signal },
          );
        }
        return () => control.abort();
      },
    );
  }

  return {
    act: (action: Action) => dispatch({ type: action }),
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      syncSlots();
      if (isWatched()) {
        frame(); // locate now, so the first paint is not a frame behind
        if (!started) {
          started = true;
          emit({ type: "start", stepIndex: state.index });
        }
      }
      return () => {
        listeners.delete(listener);
        syncSlots();
      };
    },
  };
}
