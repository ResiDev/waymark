import { inDevelopment } from "../dev";
import type { Queue } from "../queue";
import type { Facts, Message, Phases, Shown, StepRead, VisitKey, WaymarkRead, Work } from "../state";
import { checkOf, hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { liveWatchers, needsAdvanceRead, NOTHING_LIVE, sameWaymarkAria, sameWaymarkEvents, stepAt } from "./rules";
import type { OnStep, WaymarkAria, WaymarkEvents } from "./rules";
import type { AttachOptions, Rect, UiElements } from "./types";
import { detached, obey, openOf, sightBeacons, sightingOf } from "./walkthroughs";
import type { Collapsed } from "./walkthroughs";

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
  /** `run.attach`. The first attachment is a change with no work, so the first look comes due; the last one gone is `detached`. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /**
   * After every change, whether or not it moved anything, as a frame that has
   * just fired must be asked for again: each hookup opened or closed to match
   * the facts, and the first look queued when one is due.
   */
  afterChange: (facts: Facts) => void;
}>;

/** Everything that touches the page. It reads the facts and never writes them: what it sees goes back to the Run as a change. */
export function createPage({
  root,
  queue,
  facts,
  change,
  commitNow,
  collapsedNow,
}: Readonly<{
  root: () => Document | Element;
  queue: Queue;
  facts: () => Facts;
  /** A change, queued behind the one running. */
  change: (phases: Phases) => void;
  /** A change run at once, inside the queue's drain. */
  commitNow: (phases: Phases) => void;
  collapsedNow: (facts: Shown) => Collapsed;
}>): Page {
  const attachments: Attachment[] = [];
  // A check that throws would throw every frame; each distinct error once per visit is enough to see the bug.
  let thrown: Readonly<{ visit: VisitKey; errors: Set<string> }> | undefined;
  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;

  const tell = (message: Message) => change({ commands: [obey(message)] });

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    const where = root();
    const reusable = cached !== null && cached.isConnected && where.contains(cached) && cached.matches(selector);
    const element = reusable ? cached : where.querySelector(selector);
    const box = element?.getBoundingClientRect();
    // An empty box, as `display: none` gives, is on the page but has nowhere to point.
    const rect = box && (box.width > 0 || box.height > 0) ? box : null;
    return { element, rect, inView: rect !== null && inViewport(rect) };
  };

  const firstThrow = (error: unknown, visit: VisitKey): boolean => {
    if (thrown?.visit !== visit) thrown = { visit, errors: new Set() };
    const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (thrown.errors.has(key)) return false;
    thrown.errors.add(key);
    return true;
  };

  const readStep = (on: OnStep, asLooked: boolean): StepRead | undefined => {
    const step = stepAt(on.walkthrough, on.entry.step);
    const { visit } = on;
    const selector = selectorOf(step);
    const waymark = selector === undefined ? undefined : measure(selector, visit.sighting.element);
    if (!needsAdvanceRead(on, asLooked)) return waymark === undefined ? undefined : { now: performance.now(), waymark };
    let holds = false;
    try {
      holds = checkOf(step)?.(waymark?.element ?? null) === true;
    } catch (error) {
      if (firstThrow(error, visit.key)) queue.fail("stateCheck", error);
    }
    return { now: performance.now(), waymark, advance: { holds } };
  };

  const lookAtBeacons = (shown: Shown): Work => {
    const reads = new Map<string, WaymarkRead>();
    for (const [walkthrough, entry] of collapsedNow(shown)) {
      const selector = selectorOf(stepAt(walkthrough, entry.step));
      if (selector !== undefined) reads.set(walkthrough.id, measure(selector, sightingOf(shown.live.beacons, walkthrough, entry).element));
    }
    return sightBeacons(reads, performance.now());
  };

  // Queued, so it measures the page as the change's listeners left it, and
  // looks at whichever visit is open when it runs. Run at once from the
  // queue, so its `start` comes before anything those listeners queued.
  const look = () => {
    if (attachments.length === 0) return;
    const on = openOf(facts());
    if (on === undefined || on.visit.looked) return;
    commitNow({ commands: [obey({ type: "look", visit: on.visit.key, read: readStep(on, true) })] });
  };

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      frame = undefined;
      const shown = facts();
      const on = openOf(shown);
      if (on === undefined) {
        change({ commands: [lookAtBeacons(shown)] });
        return;
      }
      const read = readStep(on, false);
      if (read !== undefined) tell({ type: "stepRead", visit: on.visit.key, read });
    });
    return () => cancelAnimationFrame(id);
  };

  const inputContext = (on: OnStep | undefined): InputContext => {
    const attachment = attachments.at(-1);
    const waymark = on?.visit.sighting.waymark;
    return {
      dismiss: on?.walkthrough.dismiss ?? "collapse",
      element: on?.visit.sighting.element ?? null,
      rect: waymark?.status === "found" ? waymark.rect : null,
      padding: attachment?.padding ?? 0,
      ui: attachment?.ui() ?? NO_UI,
    };
  };

  const onClick = (event: MouseEvent) => {
    const on = openOf(facts());
    if (on === undefined) return;
    tell({ type: "click", visit: on.visit.key, hit: whereClicked(event, inputContext(on)), now: performance.now() });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext(openOf(facts())));
    if (action !== undefined) tell({ type: "act", action });
  };

  const openWaymarkEvents = (to: WaymarkEvents) =>
    listenToWaymarkEvents(to, () => tell({ type: "event", visit: to.visit, now: performance.now() }));

  const afterChange = (shown: Facts) => {
    const attached = attachments.length > 0;
    const on = openOf(shown);
    if (attached && on !== undefined && !on.visit.looked) queue.run(look);
    const live = on === undefined ? NOTHING_LIVE : liveWatchers(on);
    const beacons =
      attached && collapsedNow(shown).some(([walkthrough, entry]) => hasWaymark(stepAt(walkthrough, entry.step)));
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
      change({ commands: [detached] });
    };
    attachments.push(attachment);
    if (attachments.length > 1) return detach;
    countAttached(1);
    try {
      change({});
    } catch (error) {
      // The caller gets no detach to call, so nothing may stay attached.
      detach();
      throw error;
    }
    return detach;
  };

  return { attach, afterChange };
}
