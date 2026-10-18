import { inDevelopment } from "../dev";
import type { Read } from "../storage/records";
import { checkOf, hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import type { Host, Layer, Opened } from "./layer";
import { liveWatchers, needsAdvanceRead, NOTHING_LIVE, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { stepAt } from "./state";
import type { AttachOptions, Rect, Run, UiElements } from "./types";

/*
 * The page layer: everything that touches `window` and the document. It
 * measures Waymarks, runs state checks, listens for keys, clicks and Waymark
 * events, keeps the frame loop and the Waymark's aria, and holds the
 * renderers' attachments. It reads the core and sends it messages; the core's
 * file never sees the page. About 270 lines once filled in.
 */

/** What the page reads of the core and asks of it. */
export type PageHost = Pick<Host<Read>, "change" | "open" | "collapsed" | "obey" | "sight" | "setAttached" | "fail">;

export type PageLayer = Readonly<{
  layer: Layer<Read>;
  attach: Run["attach"];
  /** The `attached` port: whether a renderer draws the Run now. The attachments are its one source. */
  attached: () => boolean;
}>;

export type PageOptions = Readonly<{
  /** Read as late as possible, so a Run can be made on a server, where there is no document. */
  root: () => Document | Element;
}>;

const NO_UI: UiElements = { dialog: null };

type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

const inViewport = (rect: Rect): boolean => {
  throw new Error("not implemented");
};

const syncWatcher = <K>(
  watcher: Watcher<K>,
  key: K | undefined,
  open: (key: K) => () => void,
  same: (a: K, b: K) => boolean = Object.is,
): Watcher<K> => {
  throw new Error("not implemented");
};

const openInput = (onClick: (event: MouseEvent) => void, onKeyDown: (event: KeyboardEvent) => void): (() => void) => {
  throw new Error("not implemented");
};

const openWaymarkAria = (aria: WaymarkAria): (() => void) => {
  throw new Error("not implemented");
};

const listenToWaymarkEvents = (events: WaymarkEvents, onEvent: () => void): (() => void) => {
  throw new Error("not implemented");
};

export function createPageLayer(host: PageHost, { root }: PageOptions): PageLayer {
  const attachments: Attachment[] = [];
  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;
  /** The open walkthrough first looked at: once per opening, again after a spell detached. */
  let looked: Opened | undefined;
  // A check that throws would throw every frame; each distinct error once per step is enough to see the bug.
  let thrownStep: number | undefined;
  let thrownErrors = new Set<string>();

  /** Each message its own change, as today. The rules' ask to scroll is met here, inside the change, as today. */
  const send = (...messages: Message[]) => {
    for (const message of messages) {
      host.change((tx) => host.obey(tx, message)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  };

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    // TODO: as run.ts's `measure` today, under root().
    throw new Error("not implemented");
  };

  const firstThrowThisStep = (error: unknown, stepGeneration: number): boolean => {
    throw new Error("not implemented");
  };

  /** Measures the open step's Waymark and runs its check, then sends the read and `after`. */
  const sendRead = (...after: Message[]) => {
    // TODO: as run.ts's `sendRead` today, reading host.open(). A throwing check goes to
    // host.fail("stateCheck", error) once per distinct error per step generation.
    throw new Error("not implemented");
  };

  /** One change: every beacon's Waymark measured, handed to the core to sight. */
  const lookAtBeacons = () =>
    host.change((tx) => {
      const now = performance.now();
      const reads = new Map<string, WaymarkRead>();
      for (const { walkthrough, progress, sighting } of host.collapsed()) {
        const selector = selectorOf(stepAt(walkthrough, progress.step));
        if (selector !== undefined && sighting !== undefined) reads.set(walkthrough.id, measure(selector, sighting.element));
      }
      host.sight(tx, reads, now);
    });

  const inputContext = (): InputContext => {
    // TODO: as today, from host.open() and attachments.at(-1).
    throw new Error("not implemented");
  };

  const onClick = (event: MouseEvent) => {
    const opened = host.open();
    if (opened === undefined) return;
    send({
      kind: "click",
      stepGeneration: opened.state.stepGeneration,
      hit: whereClicked(event, inputContext()),
      now: performance.now(),
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext());
    if (action !== undefined) send({ kind: "act", action });
  };

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      // A fired frame has closed itself; `reconcile` opens the next if still wanted.
      frame = undefined;
      if (host.open() === undefined) lookAtBeacons();
      else sendRead();
    });
    return () => cancelAnimationFrame(id);
  };

  /** The page's listeners and aria, as the open walkthrough and the beacons need them now. */
  const reconcile = () => {
    const opened = host.open();
    const live = opened === undefined ? NOTHING_LIVE : liveWatchers(opened.state);
    const beacons =
      attachments.length > 0 && host.collapsed().some(({ walkthrough, progress }) => hasWaymark(stepAt(walkthrough, progress.step)));
    input = syncWatcher(input, live.input || undefined, () => openInput(onClick, onKeyDown));
    frame = syncWatcher(frame, live.frame || beacons || undefined, openFrame);
    waymarkAria = syncWatcher(waymarkAria, live.waymarkAria, openWaymarkAria, sameWaymarkAria);
    waymarkEvents = syncWatcher(waymarkEvents, live.waymarkEvents, (to) =>
      listenToWaymarkEvents(to, () => send({ kind: "event", stepGeneration: to.stepGeneration, now: performance.now() })),
    sameWaymarkEvents);
  };

  /**
   * A walkthrough is looked at as soon as it is drawn: as it opens while
   * attached, and as the Run attaches. Its first look comes before its `start`,
   * and both before anything a listener does on seeing it, as both are queued
   * here, before the core calls any listener.
   */
  const lookOnOpening = () => {
    const opened = host.open();
    if (opened === undefined || looked === opened || !opened.state.attached) return;
    looked = opened;
    sendRead({ kind: "start", stepGeneration: opened.state.stepGeneration });
  };

  const countAttached = (by: 1 | -1) => {
    // TODO: as today, over `attachedRuns`; inDevelopment() warns when a second Run attaches to one page.
    throw new Error("not implemented");
  };

  const attach = (ui: () => UiElements, { waymarkPadding = 0 }: AttachOptions = {}) => {
    const attachment: Attachment = { ui, padding: waymarkPadding };
    const detach = () => {
      const at = attachments.indexOf(attachment);
      if (at === -1) return;
      attachments.splice(at, 1);
      if (attachments.length > 0) return;
      countAttached(-1);
      host.change((tx) => {
        // Inside the change, so a change queued before this one still sees the first look as sent.
        looked = undefined;
        host.setAttached(tx, false);
      });
    };
    attachments.push(attachment);
    if (attachments.length > 1) return detach;
    countAttached(1);
    try {
      host.change((tx) => host.setAttached(tx, true));
    } catch (error) {
      // The caller gets no detach to call, so nothing may stay attached.
      detach();
      throw error;
    }
    return detach;
  };

  return {
    layer: {
      effect: () => {
        reconcile();
        lookOnOpening();
      },
    },
    attach,
    attached: () => attachments.length > 0,
  };
}
