import { keyAction, whereClicked } from "./input";
import { act, observe } from "./rules";
import type { Reading } from "./rules";
import { enter, noChange } from "./state";
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
 *   commit()     the one place the State changes, one piece of Work at a time
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
    try {
      tick();
    } finally {
      if (live) frameId = requestAnimationFrame(loop);
    }
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

export function createRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;

  const listeners = new Set<() => void>();
  let state: State<TStep> = enter(tutorial, options.startAt ?? 0);
  let started = false;

  // ---- the one place the State changes --------------------------------------

  /**
   * Something that, run against the State as it stands *then*, says what
   * happens. Handed to `commit` instead of a finished Outcome so that work
   * requested from inside a notification sees the State it will be applied to.
   */
  type Work = () => Outcome<TStep>;

  const queue: Work[] = [];
  let draining = false;

  /**
   * Runs Work in order, one item at a time. Each item is obeyed in full:
   *
   *   1. scroll     fire and forget, so it goes first and cannot go stale
   *   2. store      the new State, if there is one
   *   3. sync       the live things follow the State
   *   4. notify     subscribers, only if the Snapshot is a new object
   *   5. announce   Run events, after notify, so an onEvent handler always
   *                 sees a renderer that already knows
   *
   * A listener or onEvent handler may call `act`, or cause a DOM event the
   * Run is listening for. That Work joins the queue and runs once this item
   * has been notified and announced in full, so every event of a change
   * carries the Snapshot that change produced, never one a callback made
   * afterwards. Between drains the queue is empty and `draining` is false.
   *
   * A callback that throws does not stop the others, nor the rest of the
   * queue; its error is thrown once the drain is over.
   */
  const commit = (work: Work) => {
    queue.push(work);
    if (draining) return;
    draining = true;

    const errors: unknown[] = [];
    const invoke = (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    };

    try {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const outcome = queue[cursor]();
        // `scrollIntoView` is optional only because jsdom does not implement it.
        outcome.scrollTo?.scrollIntoView?.({
          behavior: "smooth",
          block: "center",
        });

        const before = state;
        if (outcome.state !== before) {
          state = outcome.state;
          sync();
        }
        const after = state.snapshot;
        if (after !== before.snapshot) {
          for (const listener of [...listeners]) {
            if (listeners.has(listener)) invoke(listener);
          }
        }
        for (const type of outcome.events) {
          invoke(() =>
            options.onEvent?.({
              type,
              step: tutorial.steps[before.snapshot.stepIndex],
              stepIndex: before.snapshot.stepIndex,
              snapshot: after,
            }),
          );
        }
      }
    } finally {
      queue.length = 0;
      draining = false;
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Run callbacks failed.");
  };

  // ---- one frame -------------------------------------------------------------

  /** The only DOM reads of a frame, packaged as data. */
  const readPage = (
    step: TStep,
    mode: "check" | "satisfied" | "locate",
  ): Reading => {
    const selector = hasWaymark(step) ? selectorOf(step) : undefined;

    const cached = state.element;
    const canReuseTarget =
      cached?.isConnected &&
      root.contains(cached) &&
      selector !== undefined &&
      cached.matches(selector);

    const element =
      selector === undefined
        ? null
        : canReuseTarget
          ? cached
          : root.querySelector(selector);
    const rect = element ? element.getBoundingClientRect() : null;
    return {
      element,
      rect,
      inView: rect !== null && inViewport(rect),
      condition:
        mode === "satisfied"
          ? "satisfied"
          : mode === "check" && checkOf(step)?.(element)
            ? "holds"
            : "unmet",
      now: performance.now(),
    };
  };

  /** Read the page and calculate an outcome against the current state. */
  function evaluatePage(
    mode: "check" | "satisfied" | "locate" = "check",
  ): Outcome<TStep> {
    if (state.snapshot.phase !== "running") return noChange(state);
    return observe(state, readPage(state.snapshot.step, mode), tutorial);
  }

  function handleConditionSatisfied() {
    const generation = state.stepGeneration;
    commit(() => {
      if (state.stepGeneration !== generation) return noChange(state);
      return evaluatePage("satisfied");
    });
  }

  /** Locate and announce startup in one commit, before conditions can advance. */
  function initialize(): Outcome<TStep> {
    sync();
    const running = getWatchedSnapshot();
    if (!running) return noChange(state);
    if (started) return evaluatePage();
    const outcome = evaluatePage("locate");
    started = true;
    return { ...outcome, events: ["start"] };
  }

  // ---- what the user is doing ------------------------------------------------

  const getInputContext = () => ({
    collapsed: state.snapshot.phase === "running" && state.snapshot.collapsed,
    element: state.element,
    rect:
      state.snapshot.phase === "running" &&
      state.snapshot.waymark.status === "found"
        ? state.snapshot.waymark.rect
        : null,
    padding,
    ui: options.ui?.() ?? NO_UI,
  });

  /** On the Waymark: perhaps the condition. Away from it: put the Run away. */
  const onClick = (event: MouseEvent) => {
    const hit = whereClicked(event, getInputContext());
    if (hit === "waymark") {
      if (
        state.snapshot.phase === "running" &&
        conditionOf(state.snapshot.step) === "click"
      ) {
        handleConditionSatisfied();
      }
    } else if (hit === "away") {
      commit(() => act(state, "collapse", tutorial));
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, getInputContext());
    if (action) commit(() => act(state, action, tutorial));
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
  const getWatchedSnapshot = (): Running<TStep> | undefined =>
    listeners.size > 0 && state.snapshot.phase === "running"
      ? state.snapshot
      : undefined;

  function sync() {
    const running = getWatchedSnapshot();
    // Start or stop only when the State and the loop disagree. When they agree
    // (watching and should be, or not watching and should not be) there is
    // nothing to do, and that is the common case: sync runs after every change.
    const shouldWatch = running !== undefined;
    if (shouldWatch && stopWatching === undefined) {
      stopWatching = watch(() => commit(evaluatePage), onClick, onKeyDown);
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
          ? {
              element,
              step,
              detach: attach(element, step, handleConditionSatisfied),
            }
          : undefined;
    }
  }

  return {
    act: (action: Action) => commit(() => act(state, action, tutorial)),
    getSnapshot: (): Snapshot<TStep> => state.snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      try {
        commit(initialize);
      } catch (error) {
        listeners.delete(listener);
        sync();
        throw error;
      }
      return () => {
        listeners.delete(listener);
        sync();
      };
    },
  };
}
