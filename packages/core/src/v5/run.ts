import { keyAction, whereClicked } from "./input";
import { canAdvance, meetCondition, startAt, transition } from "./progress";
import type { Gates, Progress } from "./progress";
import { trackCondition, type ConditionTracker } from "./condition";
import { sameLocation, startLocating, type Locator } from "./locator";
import { advanceRule, selectorFor } from "./tutorial";
import type {
  Action,
  Location,
  Run,
  RunEvent,
  RunOptions,
  Snapshot,
  Step,
  Tutorial,
} from "./types";

const NO_UI = { dialog: null, beacon: null };

/** Everything a Run knows, between one event and the next. */
type RunState = {
  progress: Progress;
  /** Where the current Step's Waymark was, when the locator last looked. */
  location: Location;
  /** "start" has been announced. It fires once, when watching first begins. */
  started: boolean;
};

/** The frame loop and global listeners: alive only while someone is watching. */
type Loop = {
  input: AbortController;
  /** requestAnimationFrame id of the one scheduled tick, if any. */
  frameId: number | undefined;
};

/**
 * Starts one Run of a Tutorial.
 *
 * This is the only place where the three halves of Waymark meet: what the Run
 * has done so far (progress.ts), what the page is doing (step.ts), and what the
 * user is doing (input.ts). It owns the frame loop and the subscription, and
 * decides nothing else — every rule it appears to enforce is a question it asks
 * one of the three.
 *
 * The loop runs only while someone is subscribed and the Run is still going, so
 * a finished Run costs nothing even if its renderer is still mounted.
 */
export function createRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;
  const ui = options.ui ?? (() => NO_UI);
  const steps = tutorial.steps;
  const advanceRules = steps.map(advanceRule);
  const gates: Gates = {
    stepCount: steps.length,
    gated: (index) => advanceRules[index] !== undefined,
  };

  const listeners = new Set<() => void>();

  const state: RunState = {
    progress: startAt(options.startAt ?? 0),
    location: { status: "searching" },
    started: false,
  };
  // Handles: things to release, not things the Run knows.
  // Per step state
  let locator: Locator | null = null;
  let condition: ConditionTracker | null = null;

  /**
   * The snapshot is a view over progress and location, rebuilt only when one
   * of them is replaced — so a subscriber can never be handed a stale one.
   */
  let lastSnapshot: {
    progress: Progress;
    location: Location;
    snapshot: Snapshot<TStep>;
  } | null = null;

  // Per subscription
  let loop: Loop | null = null;

  // Guards
  let locating = false;

  const buildSnapshot = (
    progress: Progress,
    location: Location,
  ): Snapshot<TStep> =>
    progress.phase === "running"
      ? {
          phase: "running",
          step: steps[progress.index],
          stepIndex: progress.index,
          stepCount: steps.length,
          canAdvance: canAdvance(progress, gates),
          collapsed: progress.collapsed,
          waymark: location,
        }
      : {
          phase: progress.phase,
          stepIndex: progress.index,
          stepCount: steps.length,
        };

  const getSnapshot = (): Snapshot<TStep> => {
    const { progress, location } = state;
    if (
      lastSnapshot &&
      lastSnapshot.progress === progress &&
      lastSnapshot.location === location
    ) {
      return lastSnapshot.snapshot;
    }
    lastSnapshot = {
      progress,
      location,
      snapshot: buildSnapshot(progress, location),
    };
    return lastSnapshot.snapshot;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const emit = (type: RunEvent<TStep>["type"], stepIndex: number) => {
    options.onEvent?.({
      type,
      step: steps[stepIndex],
      stepIndex,
      snapshot: getSnapshot(),
    });
  };

  /** Lets go of the current Step's page presence and takes up the new Step's. */
  const enterStep = () => {
    locator?.release();
    condition?.release();
    locator = null;
    condition = null;
    const { progress } = state;
    if (progress.phase !== "running") return;
    const step = steps[progress.index];
    state.location =
      selectorFor(step) === undefined
        ? { status: "absent" }
        : { status: "searching" };
    locator = startLocating(step, root);
    const rule = advanceRules[progress.index];
    if (rule) condition = trackCondition(rule, onConditionMet);
  };

  /**
   * Locates the Waymark once, right now, then lets the condition look at what
   * was found. Observing the condition can move the Run on; it comes last so
   * this frame's Location is already in place, and re-entrant calls are
   * dropped so the new Step is located next frame rather than mid-way.
   */
  const locateWaymark = () => {
    if (locating || !locator) return;
    locating = true;
    try {
      const next = locator.locate(!state.progress.collapsed);
      if (!sameLocation(next, state.location)) {
        state.location = next;
        notify();
      }
      condition?.observe(locator.element(), performance.now());
    } finally {
      locating = false;
    }
  };

  const schedule = () => {
    if (loop && loop.frameId === undefined) {
      loop.frameId = requestAnimationFrame(tick);
    }
  };

  const tick = () => {
    if (loop) loop.frameId = undefined;
    locateWaymark();
    schedule();
  };

  const inputContext = () => ({
    collapsed: state.progress.collapsed,
    element: locator?.element() ?? null,
    rect: state.location.status === "found" ? state.location.rect : null,
    padding,
    ui: ui(),
  });

  const onClick = (event: MouseEvent) => {
    if (state.progress.phase !== "running") return;
    const hit = whereClicked(event, inputContext());
    if (hit === "waymark") {
      if (advanceRules[state.progress.index]?.byClick) condition?.satisfy();
    } else if (hit === "away") {
      act("collapse");
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (state.progress.phase !== "running") return;
    const action = keyAction(event, inputContext());
    if (action) act(action);
  };

  const syncLoop = () => {
    const shouldWatch =
      listeners.size > 0 && state.progress.phase === "running";

    if (shouldWatch && !loop) {
      const input = new AbortController();
      const { signal } = input;
      window.addEventListener("click", onClick, { capture: true, signal });
      window.addEventListener("keydown", onKeyDown, { signal });
      loop = { input, frameId: undefined };
      if (!state.started) {
        state.started = true;
        emit("start", state.progress.index);
      }
      locateWaymark();
      schedule();
    } else if (!shouldWatch && loop) {
      loop.input.abort();
      if (loop.frameId !== undefined) cancelAnimationFrame(loop.frameId);
      loop = null;
      locator?.release();
      condition?.release();
    }
  };

  /** The one place progress changes. */
  const commit = (next: Progress) => {
    const prev = state.progress;
    if (next === prev) return;
    const moved = next.index !== prev.index || next.phase !== prev.phase;
    state.progress = next;
    if (moved) enterStep();
    notify();
    syncLoop();
    // Locate the new Step's Waymark now, so the renderer is not a frame behind.
    if (moved) locateWaymark();
  };

  /**
   * One atomic decision, like an act: the gate opens and — on an auto rule —
   * the Run moves on, in a single commit, with the events settled before it.
   */
  function onConditionMet() {
    const from = state.progress;
    const met = meetCondition(from);
    if (met.phase !== "running") return;
    const auto = advanceRules[met.index]?.auto === true;
    const next = auto ? transition(met, "advance", gates) : met;
    if (next === from) return;
    commit(next);
    if (next !== met) {
      emit("advance", from.index);
      if (next.phase === "completed") emit("finish", next.index);
    }
  }

  function act(action: Action) {
    const from = state.progress;
    const next = transition(from, action, gates);
    if (next === from) return; // refused: nothing happened, nothing to announce
    commit(next);
    emit(action, from.index);
    if (next.phase === "completed") emit("finish", next.index);
  }

  enterStep();

  return {
    act,
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      syncLoop();
      return () => {
        listeners.delete(listener);
        syncLoop();
      };
    },
  };
}
