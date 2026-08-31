import { decide } from "./decide";
import type { Input } from "./decide";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import type { Reading } from "./observe";
import type { Announcement } from "./outcome";
import { CLOSED, createResource, keepInSync, OPEN } from "./resources";
import { canAdvance, enterStep, rendersTheSame } from "./state";
import type { Definition, State } from "./state";
import { advanceRule, selectorFor } from "./tutorial";
import type {
  Action,
  Rect,
  Run,
  RunOptions,
  Snapshot,
  Step,
  Tutorial,
} from "./types";

/**
 * The driver: everything impure, and nothing else, in four named parts.
 *
 *   readPage()       every DOM read of a frame, packaged as one Reading
 *   dispatch()       the one place the State changes
 *   four resources   what must be live right now, derived from the State
 *   snapshot         rebuilt in dispatch, so reading one is just a read
 *
 * It enforces no rules. Moving between Steps is `decide` handing back a State
 * built by `enterStep`, and the resources noticing that their deps changed.
 */

const NO_UI = { dialog: null, beacon: null };

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

const inViewport = (rect: Rect): boolean =>
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
  const definition: Definition = { steps, rules: steps.map(advanceRule) };

  const listeners = new Set<() => void>();
  let state: State = enterStep(options.startAt ?? 0, definition);
  let hasAnnouncedStart = false;

  // ---- the snapshot: built where the State changes, so it cannot go stale ----

  const buildSnapshot = (): Snapshot<TStep> =>
    state.phase === "running"
      ? {
          phase: "running",
          step: steps[state.index],
          stepIndex: state.index,
          stepCount: steps.length,
          canAdvance: canAdvance(state, definition),
          collapsed: state.collapsed,
          waymark: state.location,
        }
      : { phase: state.phase, stepIndex: state.index, stepCount: steps.length };

  let snapshot: Snapshot<TStep> = buildSnapshot();
  const getSnapshot = (): Snapshot<TStep> => snapshot;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const announce = (announcement: Announcement) =>
    options.onEvent?.({
      type: announcement.type,
      step: steps[announcement.stepIndex],
      stepIndex: announcement.stepIndex,
      snapshot,
    });

  // ---- the only DOM reads of a frame, packaged as data ----------------------

  const readPage = (): Reading => {
    const selector = selectorFor(steps[state.index]);
    const element =
      selector === undefined
        ? null
        : state.element?.isConnected
          ? state.element
          : root.querySelector(selector);
    const rect = element ? copyRect(element.getBoundingClientRect()) : null;
    return {
      element,
      rect,
      inView: rect !== null && inViewport(rect),
      conditionHolds: definition.rules[state.index]?.byCheck?.(element) ?? false,
      now: performance.now(),
    };
  };

  // ---- the one place the State changes --------------------------------------

  const dispatch = (input: Input) => {
    const outcome = decide(state, input, definition);
    if (outcome.state !== state) {
      const renderChanged = !rendersTheSame(state, outcome.state);
      state = outcome.state;
      if (renderChanged) snapshot = buildSnapshot();
      syncResources();
      if (renderChanged) notify();
    }
    for (const announcement of outcome.announcements) announce(announcement);
    outcome.scrollTo?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const look = () => dispatch({ kind: "frame", reading: readPage() });

  // ---- what the user is doing ----------------------------------------------

  const inputContext = (): InputContext => ({
    collapsed: state.collapsed,
    element: state.element,
    rect: state.location.status === "found" ? state.location.rect : null,
    padding,
    ui: ui(),
  });

  /** On the Waymark: perhaps the condition. Away from it: put the Run away. */
  const onClick = (event: MouseEvent) => {
    const hit = whereClicked(event, inputContext());
    if (hit === "waymark") {
      if (definition.rules[state.index]?.byClick) {
        dispatch({ kind: "conditionMet", now: performance.now() });
      }
    } else if (hit === "away") {
      dispatch({ kind: "act", action: "collapse" });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext());
    if (action) dispatch({ kind: "act", action });
  };

  // ---- the four resources, named, and nothing else --------------------------

  const frameLoop = createResource();
  const windowInput = createResource();
  const waymarkAria = createResource();
  const waymarkEvents = createResource();

  /** No subscribers, or a Run that has ended, means nothing should be live. */
  const isWatched = () => listeners.size > 0 && state.phase === "running";

  /** A tick can end the Run, which closes this loop from inside itself. */
  const openFrameLoop = () => {
    let live = true;
    let frame = requestAnimationFrame(function tick() {
      look();
      if (live) frame = requestAnimationFrame(tick);
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  };

  const openWindowInput = () => {
    const control = new AbortController();
    const { signal } = control;
    window.addEventListener("click", onClick, { capture: true, signal });
    window.addEventListener("keydown", onKeyDown, { signal });
    return () => control.abort();
  };

  /** Tells assistive technology that the Waymark has a popover attached. */
  const openWaymarkAria = (element: Element) => {
    element.setAttribute("aria-haspopup", "dialog");
    element.setAttribute("aria-expanded", "true");
    return () => {
      element.removeAttribute("aria-haspopup");
      element.removeAttribute("aria-expanded");
    };
  };

  const openWaymarkEvents = (element: Element, names: readonly string[]) => {
    const control = new AbortController();
    for (const name of names) {
      element.addEventListener(
        name,
        () => dispatch({ kind: "conditionMet", now: performance.now() }),
        { signal: control.signal },
      );
    }
    return () => control.abort();
  };

  function syncResources() {
    const watched = isWatched();
    const element = state.element;
    const rule = definition.rules[state.index];

    keepInSync(frameLoop, watched ? OPEN : CLOSED, openFrameLoop);
    keepInSync(windowInput, watched ? OPEN : CLOSED, openWindowInput);

    keepInSync(waymarkAria, watched && element ? [element] : CLOSED, () =>
      openWaymarkAria(element!),
    );

    // One AdvanceRule object per Step, so these deps change when the Step does.
    keepInSync(
      waymarkEvents,
      watched && element && rule?.byEvents.length ? [element, rule] : CLOSED,
      () => openWaymarkEvents(element!, rule!.byEvents),
    );
  }

  return {
    act: (action: Action) => dispatch({ kind: "act", action }),
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      syncResources();
      if (isWatched()) {
        look(); // Locate now, so the first paint is not a frame behind.
        if (!hasAnnouncedStart) {
          hasAnnouncedStart = true;
          announce({ type: "start", stepIndex: state.index });
        }
      }
      return () => {
        listeners.delete(listener);
        syncResources();
      };
    },
  };
}
