import { keyAction, whereClicked } from "./input";
import { createQueue } from "../queue";
import { apply, liveWatchers, needsAdvanceRead, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { begin, loading, stepAt } from "./state";
import type { Start, State } from "./state";
import { loadFrom, reporter, saveTo } from "../storage/adapter";
import type { StorageAdapter } from "../storage/adapter";
import { DEFAULT_MAX_AGE, isCurrent, parseWalkthrough, storedWalkthrough } from "../storage/records";
import type { StoredWalkthrough } from "../storage/records";
import { checkOf, selectorOf } from "../walkthrough/walkthrough";
import type { Action, Rect, Run, RunOptions, Snapshot, UiElements } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

const NO_UI: UiElements = { dialog: null, beacon: null };

/** What storage keeps of a Snapshot: its phase, step and whether it is collapsed. */
const sameStored = (a: Snapshot, b: Snapshot): boolean => {
  if (a.phase !== "running" || b.phase !== "running") return a.phase === b.phase;
  return a.stepIndex === b.stepIndex && a.collapsed === b.collapsed;
};

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

  const storage = options.storage?.walkthrough;
  const maxAge = options.storage?.maxAge ?? DEFAULT_MAX_AGE;
  const report = reporter("walkthrough", options.onStorageError);
  const asked: Start = {
    phase: "running",
    step: options.startAt ?? 0,
    collapsed: options.collapsed ?? false,
    resumed: options.resumed ?? false,
  };

  const listeners = new Set<(snapshot: Snapshot<TStep>) => void>();
  let state: State<TStep> = storage ? loading(walkthrough) : begin(walkthrough, asked);
  /** Actions asked for while loading, run once the Run has begun. */
  const held: Action[] = [];

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
    // Restoring saves nothing: storage already holds it.
    if (storage && message.kind !== "loaded" && !sameStored(before.snapshot, after)) {
      const saved = storedWalkthrough(after);
      queue.invoke(() => saveTo(storage, saved, report));
    }

    // A loading Run takes no actions, so it has no events.
    const from = before.snapshot;
    if (from.phase === "loading") return;
    // After notify, so an onEvent handler sees a renderer that has already redrawn.
    for (const type of outcome.events) {
      queue.invoke(() =>
        options.onEvent?.({
          type,
          step: stepAt(walkthrough, from.stepIndex),
          stepIndex: from.stepIndex,
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
    const box = element?.getBoundingClientRect();
    // An empty box, as `display: none` gives, is on the page but has nowhere to point.
    const rect = box && (box.width > 0 || box.height > 0) ? box : null;
    return { element, rect, inView: rect !== null && inViewport(rect) };
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
      advance = { holds };
    }

    const stepRead: StepRead = { now: performance.now(), waymark, advance };
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

  /** A stored Run that cannot be picked up again starts as asked, and its record is wiped. */
  const startFrom = (adapter: StorageAdapter<StoredWalkthrough>, value: unknown): Start => {
    const parsed = parseWalkthrough(value);
    if (!parsed.ok) {
      report(parsed.error);
    } else {
      const saved = parsed.value;
      if (saved === null) return asked;
      if (saved.phase !== "running") return saved;
      if (isCurrent(saved, walkthrough.steps.length, maxAge)) {
        return { phase: "running", step: saved.step, collapsed: saved.collapsed, resumed: true };
      }
    }
    saveTo(adapter, null, report);
    return asked;
  };

  if (storage) {
    const arrive = (value: unknown) => {
      send({ kind: "loaded", start: startFrom(storage, value) });
      // A subscriber that came while loading has not seen the Run start.
      if (listeners.size > 0) queue.now(() => sendRead({ kind: "start" }));
      for (const action of held.splice(0)) send({ kind: "act", action });
    };
    loadFrom(storage, arrive, (error) => {
      report(error);
      arrive(null);
    });
  }

  return {
    act: (action: Action) => {
      if (state.snapshot.phase === "loading") held.push(action);
      else send({ kind: "act", action });
    },
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
