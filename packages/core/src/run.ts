import { keyAction, whereClicked } from "./input";
import { apply, liveWatchers, needsAdvanceRead, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { enter } from "./state";
import type { State } from "./state";
import { checkOf, hasWaymark, selectorOf } from "./walkthrough";
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
 *   sendRead()    every DOM read of a look, packaged as one StepRead
 *   send()        the one place the State changes: a Message in, one at a time
 *   reconcile()   the live watchers, brought in line with what the State wants
 *
 * It decides nothing. A frame, a click, a key or a Waymark event is turned
 * into a Message and sent; what it means is `apply`'s business. Every change
 * is `apply` handing back a State, and every live thing exists because
 * `liveWatchers` said it should.
 */

const NO_UI: UiElements = { dialog: null, beacon: null };

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

// ---- the live watchers, each a function that opens and returns how to close --

/** A live watcher as the driver holds it: what it was opened for, and how to close it. */
type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

/**
 * Preserve the current watcher when its key matches. Otherwise close it
 * and open a watcher for the requested key, or leave none if undefined.
 */
const syncWatcher = <K>(
  watcher: Watcher<K>,
  key: K | undefined,
  open: (key: K) => () => void,
  same: (a: K, b: K) => boolean = Object.is,
): Watcher<K> => {
  if (watcher !== undefined && key !== undefined && same(watcher.key, key)) return watcher;
  watcher?.close();
  return key === undefined ? undefined : { key, close: open(key) };
};

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

/** Set the waymark's ARIA attributes and restore the authored values on cleanup. */
const openWaymarkAria = ({ element, expanded }: WaymarkAria) => {
  const originalAttributes = ["aria-haspopup", "aria-expanded"].map(
    (name) => [name, element.getAttribute(name)] as const,
  );
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", String(expanded));
  return () => {
    for (const [name, value] of originalAttributes) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
};

/** Listen for the step's advance events independently of its ARIA attributes. */
const listenToWaymarkEvents = ({ element, events }: WaymarkEvents, onEvent: () => void) => {
  const control = new AbortController();
  for (const name of events) {
    element.addEventListener(name, onEvent, { signal: control.signal });
  }
  return () => control.abort();
};

/** Report callback errors after all pending work has had a chance to finish. */
const reportErrors = (errors: readonly unknown[]) => {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Run callbacks failed.");
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
  const send = (...messages: Message[]) => {
    queue.push(...messages);
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
        const outcome = apply(state, queue[cursor]!, walkthrough);
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
              step: walkthrough.steps[before.snapshot.stepIndex]!,
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

    reportErrors(errors);
  };

  // ---- one look --------------------------------------------------------------

  /** Find the step's waymark and measure its position and viewport overlap. */
  const measureWaymark = (step: TStep): WaymarkRead => {
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
    };
  };

  /**
   * Look at the current Step now and send what was seen, then `after`.
   * The look carries only the parts the State needs: a measurement for a
   * Step with a Waymark, and the check while advancement is still shut. The
   * check runs on the element this same look measured, so it never sees a
   * stale one. Nothing to see once the Run is over.
   *
   * A throwing check counts as false, which breaks the condition's delay.
   * Its error is thrown only once the look has been sent, so reconciliation
   * can still schedule the next frame.
   */
  const sendRead = (...after: Message[]) => {
    const snapshot = state.snapshot;
    if (snapshot.phase !== "running") return;
    const step = snapshot.step;
    // Stamped before the check runs: the check is the author's code and may act on the Run.
    const stepGeneration = state.stepGeneration;
    const waymark = hasWaymark(step) ? measureWaymark(step) : undefined;

    let advance: AdvanceRead | undefined;
    let failure: { error: unknown } | undefined;
    if (needsAdvanceRead(state)) {
      let holds = false;
      try {
        holds = checkOf(step)?.(waymark?.element ?? null) === true;
      } catch (error) {
        failure = { error };
      }
      advance = { holds, now: performance.now() };
    }

    const stepRead: StepRead = { waymark, advance };
    const read: Message[] =
      waymark || advance
        ? [{ kind: "stepRead", stepGeneration, stepRead }]
        : [];
    try {
      send(...read, ...after);
    } catch (error) {
      if (failure) throw new AggregateError([failure.error, error], "Run callbacks failed.");
      throw error;
    }
    if (failure) throw failure.error;
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

  const onClick = (event: MouseEvent) =>
    send({
      kind: "click",
      stepGeneration: state.stepGeneration,
      hit: whereClicked(event, getInputContext()),
      now: performance.now(),
    });

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, getInputContext());
    if (action) send({ kind: "act", action });
  };

  // ---- the live watchers, reconciled with the State after every Message ------

  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      // A fired frame has closed itself; `reconcile` opens the next if still wanted.
      frame = undefined;
      sendRead();
    });
    return () => cancelAnimationFrame(id);
  };

  const openWaymarkEvents = (to: WaymarkEvents) =>
    listenToWaymarkEvents(to, () =>
      send({ kind: "event", stepGeneration: to.stepGeneration, now: performance.now() }),
    );

  function reconcile() {
    const live = liveWatchers(state);
    input = syncWatcher(input, live.input || undefined, () => openInput(onClick, onKeyDown));
    frame = syncWatcher(frame, live.frame || undefined, openFrame);
    waymarkAria = syncWatcher(waymarkAria, live.waymarkAria, openWaymarkAria, sameWaymarkAria);
    waymarkEvents = syncWatcher(waymarkEvents, live.waymarkEvents, openWaymarkEvents, sameWaymarkEvents);
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
          // Queued with the first look so that `start` precedes anything a
          // subscriber does on seeing it. Once started it is a no-op.
          sendRead({ kind: "start" });
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
