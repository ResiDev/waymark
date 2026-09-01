import { keyAction, whereClicked } from "./input";
import { act, observe } from "./rules";
import type { Reading } from "./rules";
import { enter } from "./state";
import type { Outcome, State } from "./state";
import {
  checkOf,
  conditionOf,
  eventsOf,
  hasWaymark,
  selectorOf,
} from "./tutorial";
import type {
  Action,
  Rect,
  Run,
  RunEventType,
  RunOptions,
  Running,
  Snapshot,
  Step,
  Tutorial,
  UiElements,
} from "./types";

/**
 * The driver: everything impure, and nothing else.
 *
 *   readPage()   every DOM read of a frame, packaged as one Reading
 *   commit()     the one place the State changes
 *   sync()       the two live things, brought in line with the State
 *
 * It enforces no rules. Moving between Steps is `act` or `observe` handing
 * back a State built by `enter`, and `sync` noticing that the Step changed.
 */

const NO_UI: UiElements = { dialog: null, beacon: null };

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

// ---- the live things, each a function that opens and returns how to close --

/** A tick can end the Run, which closes this loop from inside itself. */
const openFrameLoop = (tick: () => void) => {
  let live = true;
  let frameId = requestAnimationFrame(function loop() {
    tick();
    if (live) frameId = requestAnimationFrame(loop);
  });
  return () => {
    live = false;
    cancelAnimationFrame(frameId);
  };
};

/** Watching: a frame loop, and the window's clicks and keys. */
const watch = (
  tick: () => void,
  onClick: (event: MouseEvent) => void,
  onKeyDown: (event: KeyboardEvent) => void,
) => {
  const closeLoop = openFrameLoop(tick);
  const control = new AbortController();
  const { signal } = control;
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  return () => {
    closeLoop();
    control.abort();
  };
};

/**
 * Attaches the Run to a Waymark: tells assistive technology it has a popover,
 * and listens for the Step's events, if it names any.
 */
const attach = (element: Element, step: Step, onEvent: () => void) => {
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", "true");
  const control = new AbortController();
  for (const name of eventsOf(step)) {
    element.addEventListener(name, onEvent, { signal: control.signal });
  }
  return () => {
    control.abort();
    element.removeAttribute("aria-haspopup");
    element.removeAttribute("aria-expanded");
  };
};

/** Hands one Run event to `onEvent`: the Step it happened on, and the Run as it stands after. */
const announce = <TStep extends Step>({
  onEvent,
  steps,
  type,
  stepIndex,
  after,
}: {
  onEvent: RunOptions<TStep>["onEvent"];
  steps: readonly TStep[];
  type: RunEventType;
  stepIndex: number;
  after: Snapshot<TStep>;
}) => onEvent?.({ type, step: steps[stepIndex], stepIndex, snapshot: after });

export function createRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;
  const ui = options.ui ?? (() => NO_UI);

  const listeners = new Set<() => void>();
  let state: State<TStep> = enter(tutorial, options.startAt ?? 0);
  let started = false;

  // ---- the one place the State changes --------------------------------------

  /**
   * Obeys an Outcome, in this order:
   *
   *   1. scroll     fire and forget, so it goes first and cannot go stale
   *   2. store      the new State, if there is one
   *   3. sync       the live things follow the State
   *   4. notify     subscribers, only if the Snapshot is a new object
   *   5. announce   Run events, after notify, so an onEvent handler always
   *                 sees a renderer that already knows
   *
   * A listener or onEvent handler may call `act` and nest another commit;
   * the events of this one are still stamped with the Step it left.
   */
  const commit = (outcome: Outcome<TStep>) => {
    // `scrollIntoView` is optional only because jsdom does not implement it.
    outcome.scrollTo?.scrollIntoView?.({ behavior: "smooth", block: "center" });

    const before = state;
    if (outcome.state !== before) {
      state = outcome.state;
      sync();
      if (state.snapshot !== before.snapshot) {
        for (const listener of listeners) listener();
      }
    }

    for (const type of outcome.events) {
      announce({
        onEvent: options.onEvent,
        steps: tutorial.steps,
        type,
        stepIndex: before.snapshot.stepIndex,
        after: state.snapshot,
      });
    }
  };

  // ---- one frame -------------------------------------------------------------

  /** The only DOM reads of a frame, packaged as data. */
  const readPage = (step: TStep, satisfied: boolean): Reading => {
    const element = state.element?.isConnected
      ? state.element
      : hasWaymark(step)
        ? root.querySelector(selectorOf(step))
        : null;
    const rect = element ? element.getBoundingClientRect() : null;
    return {
      element,
      rect,
      inView: rect !== null && inViewport(rect),
      condition: satisfied
        ? "satisfied"
        : checkOf(step)?.(element)
          ? "holds"
          : "unmet",
      now: performance.now(),
    };
  };

  /** Look at the page now. */
  const look = () => {
    if (state.snapshot.phase !== "running") return;
    commit(observe(state, readPage(state.snapshot.step, false), tutorial));
  };

  /** The user has done what the Step asked: look now, with the condition satisfied. */
  const satisfy = () => {
    if (state.snapshot.phase !== "running") return;
    commit(observe(state, readPage(state.snapshot.step, true), tutorial));
  };

  // ---- what the user is doing ------------------------------------------------

  const inputContext = () => ({
    collapsed: state.snapshot.phase === "running" && state.snapshot.collapsed,
    element: state.element,
    rect:
      state.snapshot.phase === "running" &&
      state.snapshot.waymark.status === "found"
        ? state.snapshot.waymark.rect
        : null,
    padding,
    ui: ui(),
  });

  /** On the Waymark: perhaps the condition. Away from it: put the Run away. */
  const onClick = (event: MouseEvent) => {
    const hit = whereClicked(event, inputContext());
    if (hit === "waymark") {
      if (
        state.snapshot.phase === "running" &&
        conditionOf(state.snapshot.step) === "click"
      ) {
        satisfy();
      }
    } else if (hit === "away") {
      commit(act(state, "collapse", tutorial));
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext());
    if (action) commit(act(state, action, tutorial));
  };

  // ---- the two live things, derived from the State ---------------------------
  //
  // Watching (the frame loop and window input) exists while the Run is running
  // and someone is subscribed. The attachment exists while watching and a
  // Waymark has been found, and is redone when the element or the Step changes.

  let stopWatching: (() => void) | undefined;
  let attached:
    | { element: Element; step: Step; detach: () => void }
    | undefined;

  /** The running Snapshot while someone is subscribed to see it; otherwise nothing should be live. */
  const watched = (): Running<TStep> | undefined =>
    listeners.size > 0 && state.snapshot.phase === "running"
      ? state.snapshot
      : undefined;

  function sync() {
    const running = watched();
    // Start or stop only when the State and the loop disagree. When they agree
    // (watching and should be, or not watching and should not be) there is
    // nothing to do, and that is the common case: sync runs after every change.
    const shouldWatch = running !== undefined;
    if (shouldWatch && stopWatching === undefined) {
      stopWatching = watch(look, onClick, onKeyDown);
    } else if (!shouldWatch && stopWatching !== undefined) {
      stopWatching();
      stopWatching = undefined;
    }

    const element = running ? state.element : null;
    const step = running && element ? running.step : undefined;
    if (element !== attached?.element || step !== attached?.step) {
      attached?.detach();
      attached =
        element && step
          ? { element, step, detach: attach(element, step, satisfy) }
          : undefined;
    }
  }

  return {
    act: (action: Action) => commit(act(state, action, tutorial)),
    getSnapshot: (): Snapshot<TStep> => state.snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      sync();
      const running = watched();
      if (running) {
        look(); // Locate now, so the first paint is not a frame behind.
        if (!started) {
          started = true;
          announce({
            onEvent: options.onEvent,
            steps: tutorial.steps,
            type: "start",
            stepIndex: running.stepIndex,
            after: state.snapshot,
          });
        }
      }
      return () => {
        listeners.delete(listener);
        sync();
      };
    },
  };
}
