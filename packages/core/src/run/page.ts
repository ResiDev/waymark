import { inDevelopment } from "../dev";
import type { Queue } from "../queue";
import type { Candidates, RunState, Message, Msg, StepRead, ShowingId, WaymarkRead } from "../state";
import { checkOf, hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { liveWatchers, needsAdvanceRead, NOTHING_LIVE, sameWaymarkAria, sameWaymarkEvents, stepAt } from "./rules";
import type { OnStep, WaymarkAria, WaymarkEvents } from "./rules";
import type { AttachOptions, Rect, UiElements } from "./types";
import { openOf, waymarkStateOf } from "./walkthroughs";

const NO_UI: UiElements = { dialog: null };

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 && rect.right > 0 && rect.top < globalThis.innerHeight && rect.left < globalThis.innerWidth;

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

const openInput = (onClick: (event: MouseEvent) => void, onKeyDown: (event: KeyboardEvent) => void) => {
  const control = new AbortController();
  const { signal } = control;
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  return () => control.abort();
};

const openWaymarkAria = ({ element, expanded }: WaymarkAria) => {
  const originalAttributes = ["aria-haspopup", "aria-expanded"].map((name) => [name, element.getAttribute(name)] as const);
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
  for (const name of events) element.addEventListener(name, onEvent, { signal: control.signal });
  return () => control.abort();
};

type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

export type Page = Readonly<{
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /** After every change, even one that moved nothing: a frame that has fired has closed itself, and must be asked for again. */
  sync: () => void;
}>;

export function createPage({
  root,
  queue,
  runState,
  candidates,
  send,
  sendNow,
}: Readonly<{
  root: () => Document | Element;
  queue: Queue;
  runState: () => RunState;
  /** The collapsed walkthroughs that may show a beacon, now. */
  candidates: () => Candidates;
  send: (msg: Msg) => void;
  /** Inside the drain, at once: only the first look, which itself runs from the queue. */
  sendNow: (msg: Msg) => void;
}>): Page {
  const attachments: Attachment[] = [];
  // A check that throws would throw every frame; each distinct error once per showing of a step is enough to see the bug.
  let thrown: Readonly<{ showingId: ShowingId; errors: Set<string> }> | undefined;
  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;

  const tell = (message: Message) => send({ _tag: "page", message });

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    const where = root();
    const reusable = cached !== null && cached.isConnected && where.contains(cached) && cached.matches(selector);
    const element = reusable ? cached : where.querySelector(selector);
    const box = element?.getBoundingClientRect();
    // An empty box, as `display: none` gives, is on the page but has nowhere to point.
    const rect = box && (box.width > 0 || box.height > 0) ? box : null;
    return { element, rect, inView: rect !== null && inViewport(rect) };
  };

  const firstThrow = (error: unknown, visit: ShowingId): boolean => {
    if (thrown?.showingId !== visit) thrown = { showingId: visit, errors: new Set() };
    const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (thrown.errors.has(key)) return false;
    thrown.errors.add(key);
    return true;
  };

  const readStep = (on: OnStep, asLooked: boolean): StepRead | undefined => {
    const step = stepAt(on.walkthrough, on.walkthroughProgress.step);
    const { stepState } = on;
    const selector = selectorOf(step);
    const waymark = selector === undefined ? undefined : measure(selector, stepState.waymark.element);
    if (!needsAdvanceRead(on, asLooked)) return waymark === undefined ? undefined : { now: performance.now(), waymark };
    let holds = false;
    try {
      holds = checkOf(step)?.(waymark?.element ?? null) === true;
    } catch (error) {
      if (firstThrow(error, stepState.showingId)) queue.fail("stateCheck", error);
    }
    return { now: performance.now(), waymark, advance: { holds } };
  };

  const lookAtBeacons = (shown: RunState): Msg => {
    const reads = new Map<string, WaymarkRead>();
    for (const [walkthrough, walkthroughProgress] of candidates()) {
      const selector = selectorOf(stepAt(walkthrough, walkthroughProgress.step));
      if (selector !== undefined) reads.set(walkthrough.id, measure(selector, waymarkStateOf(shown.live.beaconWaymarks, walkthrough, walkthroughProgress).element));
    }
    return { _tag: "beaconsRead", reads, now: performance.now() };
  };

  const look = () => {
    if (attachments.length === 0) return;
    const on = openOf(runState());
    if (on === undefined || on.stepState.looked) return;
    sendNow({ _tag: "page", message: { type: "look", showingId: on.stepState.showingId, read: readStep(on, true) } });
  };

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      frame = undefined;
      const shown = runState();
      const on = openOf(shown);
      if (on === undefined) {
        send(lookAtBeacons(shown));
        return;
      }
      const read = readStep(on, false);
      if (read !== undefined) tell({ type: "stepRead", showingId: on.stepState.showingId, read });
    });
    return () => cancelAnimationFrame(id);
  };

  const inputContext = (on: OnStep | undefined): InputContext => {
    const attachment = attachments.at(-1);
    const location = on?.stepState.waymark.location;
    return {
      dismiss: on?.walkthrough.dismiss ?? "collapse",
      element: on?.stepState.waymark.element ?? null,
      rect: location?.status === "found" ? location.rect : null,
      padding: attachment?.padding ?? 0,
      ui: attachment?.ui() ?? NO_UI,
    };
  };

  const onClick = (event: MouseEvent) => {
    const on = openOf(runState());
    if (on === undefined) return;
    tell({ type: "click", showingId: on.stepState.showingId, hit: whereClicked(event, inputContext(on)), now: performance.now() });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext(openOf(runState())));
    if (action !== undefined) tell({ type: "act", action });
  };

  const openWaymarkEvents = (to: WaymarkEvents) =>
    listenToWaymarkEvents(to, () => tell({ type: "event", showingId: to.visit, now: performance.now() }));

  const sync = () => {
    const attached = attachments.length > 0;
    const on = openOf(runState());
    if (attached && on !== undefined && !on.stepState.looked) queue.run(look);
    const live = on === undefined ? NOTHING_LIVE : liveWatchers(on);
    const beacons =
      attached && candidates().some(([walkthrough, walkthroughProgress]) => hasWaymark(stepAt(walkthrough, walkthroughProgress.step)));
    input = syncWatcher(input, live.input || undefined, () => openInput(onClick, onKeyDown));
    frame = syncWatcher(frame, live.frame || beacons || undefined, openFrame);
    waymarkAria = syncWatcher(waymarkAria, live.waymarkAria, openWaymarkAria, sameWaymarkAria);
    waymarkEvents = syncWatcher(waymarkEvents, live.waymarkEvents, openWaymarkEvents, sameWaymarkEvents);
  };

  const countAttached = (by: 1 | -1) => {
    const where = root();
    const page = where instanceof Document ? where : where.ownerDocument;
    const count = (attachedRuns.get(page) ?? 0) + by;
    attachedRuns.set(page, count);
    if (by === 1 && count > 1 && inDevelopment()) {
      console.warn(
        "Two Waymark Runs are attached to one page, and each will draw its walkthroughs over the other's. Make one Run per user, drawn by one renderer.",
      );
    }
  };

  const attach = (ui: () => UiElements, { waymarkPadding = 0 }: AttachOptions = {}) => {
    const attachment: Attachment = { ui, padding: waymarkPadding };
    const detach = () => {
      const at = attachments.indexOf(attachment);
      if (at === -1) return;
      attachments.splice(at, 1);
      if (attachments.length > 0) return;
      countAttached(-1);
      send({ _tag: "detached" });
    };
    attachments.push(attachment);
    if (attachments.length > 1) return detach;
    countAttached(1);
    try {
      send({ _tag: "attached" });
    } catch (error) {
      // The caller gets no detach to call, so nothing may stay attached.
      detach();
      throw error;
    }
    return detach;
  };

  return { attach, sync };
}
