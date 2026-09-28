import { keyAction, whereClicked } from "./input";
import { createQueue } from "../queue";
import { apply, liveWatchers, needsAdvanceRead, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { enter, stepAt } from "./state";
import type { State } from "./state";
import { checkOf, selectorOf } from "../walkthrough/walkthrough";
import type { Action, Rect, Run, RunOptions, Snapshot, UiElements } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

const NO_UI: UiElements = { dialog: null, beacon: null };

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

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

const listenToWaymarkEvents = ({ element, events }: WaymarkEvents, onEvent: () => void) => {
  const control = new AbortController();
  for (const name of events) {
    element.addEventListener(name, onEvent, { signal: control.signal });
  }
  return () => control.abort();
};

export function createRun<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;

  const listeners = new Set<(snapshot: Snapshot<TStep>) => void>();
  let state: State<TStep> = enter(walkthrough, options.startAt ?? 0);

  const queue = createQueue("Run callbacks failed.");

  const obey = (message: Message) => {
    const outcome = apply(state, message, walkthrough);
    outcome.scrollTo?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    const before = state;
    state = outcome.state;
    // Always, not only on change: a frame that has just fired must be
    // re-requested even when its look found nothing new.
    reconcile();

    const after = state.snapshot;
    if (after !== before.snapshot) queue.notify(listeners, after);
    // After notify, so an onEvent handler sees a renderer that has already redrawn.
    for (const type of outcome.events) {
      queue.invoke(() =>
        options.onEvent?.({
          type,
          step: stepAt(walkthrough, before.snapshot.stepIndex),
          stepIndex: before.snapshot.stepIndex,
          snapshot: after,
        }),
      );
    }
  };

  const send = (...messages: Message[]) =>
    queue.run(...messages.map((message) => () => obey(message)));

  const measureWaymark = (selector: string): WaymarkRead => {
    const cached = state.element;
    const canReuseTarget =
      cached !== null &&
      cached.isConnected &&
      root.contains(cached) &&
      cached.matches(selector);

    const element = canReuseTarget ? cached : root.querySelector(selector);
    const rect = element ? element.getBoundingClientRect() : null;
    return {
      element,
      rect,
      inView: rect !== null && inViewport(rect),
    };
  };

  const sendRead = (...after: Message[]) => {
    const snapshot = state.snapshot;
    if (snapshot.phase !== "running") return;
    const step = snapshot.step;
    // Stamped before the check runs: the check is the author's code and may act on the Run.
    const stepGeneration = state.stepGeneration;
    const selector = selectorOf(step);
    const waymark = selector === undefined ? undefined : measureWaymark(selector);

    let advance: AdvanceRead | undefined;
    if (needsAdvanceRead(state)) {
      let holds = false;
      try {
        holds = checkOf(step)?.(waymark?.element ?? null) === true;
      } catch (error) {
        // Thrown once the look is sent, so the next frame is still scheduled.
        queue.fail(error);
      }
      advance = { holds, now: performance.now() };
    }

    const stepRead: StepRead = { waymark, advance };
    const read: Message[] =
      waymark || advance
        ? [{ kind: "stepRead", stepGeneration, stepRead }]
        : [];
    send(...read, ...after);
  };

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
    if (action !== undefined) send({ kind: "act", action });
  };

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
      try {
        if (first) send({ kind: "mounted" });
        queue.now(() => {
          // Queued with the first look so that `start` precedes anything a
          // subscriber does on seeing it.
          if (first) sendRead({ kind: "start" });
          queue.invoke(() => listener(state.snapshot));
        });
      } catch (error) {
        listeners.delete(listener);
        if (listeners.size === 0) send({ kind: "unmounted" });
        throw error;
      }
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) {
          send({ kind: "unmounted" });
        }
      };
    },
  };
}
