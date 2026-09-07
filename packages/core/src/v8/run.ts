import { keyAction, whereClicked } from "./input";
import { apply, liveWatchers } from "./rules";
import type { Attachment, Message, StepRead } from "./rules";
import { enter } from "./state";
import type { State } from "./state";
import {
  checkOf,
  conditionOf,
  eventsOf,
  hasWaymark,
  selectorOf,
} from "./walkthrough";
import type {
  Action,
  Rect,
  Run,
  RunOptions,
  Snapshot,
  Step,
  UiElements,
  Walkthrough,
} from "./types";

/**
 * The driver: everything impure, and nothing else.
 *
 *   readStep()    every DOM read of a look, packaged as one StepRead
 *   send()        the one place the State changes: a Message in, one at a time
 *   reconcile()   the live watchers, brought in line with what the State wants
 *
 * It decides nothing. Every change is `apply` handing back a State, and every
 * live thing exists because `liveWatchers` said it should.
 */

const NO_UI: UiElements = { dialog: null, beacon: null };

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

// ---- the live watchers, each a function that opens and returns how to close --

/** Input: the window's clicks and keys. */
const openInput = (
  onClick: (event: MouseEvent) => void,
  onKeyDown: (event: KeyboardEvent) => void,
) => {
  const control = new AbortController();
  const { signal } = control;
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  return () => control.abort();
};

/**
 * Attaches the Run to a Waymark: tells assistive technology it has a popover,
 * and listens for the Step's events while there is something to hear.
 */
const attach = (to: Attachment, onEvent: () => void) => {
  const { element } = to;
  const originalAttributes = ["aria-haspopup", "aria-expanded"].map(
    (name) => [name, element.getAttribute(name)] as const,
  );
  element.setAttribute("aria-haspopup", "dialog");
  const control = new AbortController();
  if (to.listening) {
    for (const name of eventsOf(to.step)) {
      element.addEventListener(name, onEvent, { signal: control.signal });
    }
  }
  return () => {
    control.abort();
    for (const [name, value] of originalAttributes) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
};

export function createRun<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;

  const listeners = new Set<() => void>();
  let state: State<TStep> = enter(walkthrough, options.startAt ?? 0);

  // ---- the one place the State changes --------------------------------------

  const queue: Message[] = [];
  let draining = false;

  /**
   * Applies Messages in order, one at a time. Each is obeyed in full:
   *
   *   1. scroll      fire and forget, so it goes first and cannot go stale
   *   2. store       the new State
   *   3. reconcile   the live watchers follow the State
   *   4. notify      subscribers, only if the Snapshot is a new object
   *   5. announce    Run events, after notify, so an onEvent handler always
   *                  sees a renderer that already knows
   *
   * A listener or onEvent handler may call `act`, subscribe, or cause a DOM
   * event the Run is listening for. That Message joins the queue and runs
   * once this one has been notified and announced in full, so every event of
   * a change carries the Snapshot that change produced, never one a callback
   * made afterwards. Between drains the queue is empty and `draining` is false.
   *
   * A callback that throws does not stop the others, nor the rest of the
   * queue; its error is thrown once the drain is over.
   */
  const send = (message: Message) => {
    queue.push(message);
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
        const outcome = apply(state, queue[cursor], walkthrough);
        // `scrollIntoView` is optional only because jsdom does not implement it.
        outcome.scrollTo?.scrollIntoView?.({
          behavior: "smooth",
          block: "center",
        });

        const before = state;
        state = outcome.state;
        // Always, not only on change: a frame that has just fired must be
        // re-requested even when its look found nothing new.
        reconcile();

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
              step: walkthrough.steps[before.snapshot.stepIndex],
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

  // ---- one look --------------------------------------------------------------

  /** The only DOM reads of a look, packaged as data. */
  const readStep = (step: TStep, satisfied: boolean): StepRead => {
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
      // The look that starts a Run does not consult the check (see `observe`),
      // so it is not run: it is the author's code, and its answer would be dropped.
      condition: satisfied
        ? "satisfied"
        : state.started && checkOf(step)?.(element)
          ? "holds"
          : "unmet",
      now: performance.now(),
    };
  };

  /** Look at the current Step now, and queue what was seen. Nothing to see once the Run is over. */
  const sendRead = (satisfied: boolean) => {
    const snapshot = state.snapshot;
    if (snapshot.phase !== "running") return;
    send({
      kind: "read",
      stepGeneration: state.stepGeneration,
      read: readStep(snapshot.step, satisfied),
    });
  };

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
        sendRead(true);
      }
    } else if (hit === "away") {
      send({ kind: "act", action: "collapse" });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, getInputContext());
    if (action) send({ kind: "act", action });
  };

  // ---- the live watchers, reconciled with the State after every Message ------

  let closeInput: (() => void) | undefined;
  let frame: number | undefined;
  let attached: { to: Attachment; detach: () => void } | undefined;

  /** One frame, one look. `reconcile` requests the next if the Step still wants one. */
  const tick = () => {
    frame = undefined;
    sendRead(false);
  };

  function reconcile() {
    const live = liveWatchers(state);

    if (live.input && closeInput === undefined) {
      closeInput = openInput(onClick, onKeyDown);
    } else if (!live.input && closeInput !== undefined) {
      closeInput();
      closeInput = undefined;
    }

    if (live.frame && frame === undefined) {
      frame = requestAnimationFrame(tick);
    } else if (!live.frame && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }

    const want = live.waymark;
    const have = attached?.to;
    if (
      want?.element !== have?.element ||
      want?.stepGeneration !== have?.stepGeneration ||
      want?.listening !== have?.listening
    ) {
      attached?.detach();
      attached = want
        ? { to: want, detach: attach(want, () => sendRead(true)) }
        : undefined;
    }
    if (want) {
      const expanded = String(want.expanded);
      if (want.element.getAttribute("aria-expanded") !== expanded) {
        want.element.setAttribute("aria-expanded", expanded);
      }
    }
  }

  return {
    act: (action: Action) => send({ kind: "act", action }),
    getSnapshot: (): Snapshot<TStep> => state.snapshot,
    subscribe: (listener) => {
      const first = listeners.size === 0;
      listeners.add(listener);
      if (first) {
        try {
          send({ kind: "mounted" });
          sendRead(false);
        } catch (error) {
          listeners.delete(listener);
          if (listeners.size === 0) send({ kind: "unmounted" });
          throw error;
        }
      }
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) {
          send({ kind: "unmounted" });
        }
      };
    },
  };
}
