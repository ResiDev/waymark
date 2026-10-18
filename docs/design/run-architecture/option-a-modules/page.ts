// packages/core/src/run/page.ts — about 220 lines.
//
// Owns: the page watchers (`input`, `frame`, `waymarkAria`, `waymarkEvents`),
// `looked`, and the state check's throw dedupe (`thrownStep`, `thrownErrors`).
//
// Everything that touches the DOM: measuring Waymarks, running a step's state
// check, keys and clicks, the frame loop, the Waymark's aria and events, and
// scrolling. It holds nothing a snapshot shows. It reads the open walkthrough
// and the beacons, and turns what it sees into messages, each sent as a change
// of its own.

import type { Queue } from "../queue";
import { checkOf, selectorOf } from "../walkthrough/walkthrough";
import type { Attachments } from "./attachments";
import type { Beacons, Measure } from "./beacons";
import type { Change, MakeChange } from "./change";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { liveWatchers, needsAdvanceRead, NOTHING_LIVE, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents } from "./rules";
import type { AttachOptions, Rect, UiElements } from "./types";
import type { OpenMachine, Walkthroughs } from "./walkthroughs";

export type Page = Readonly<{
  /** As `Run.attach`. The first attachment switches the page listeners on; the last to detach switches them off. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;

  // The pipeline's step. Only `commit` calls it.

  /**
   * After every change's snapshots, before any callback: the page's listeners
   * brought in line with the Run, always, not only on change, as a frame that
   * has just fired must be asked for again. Then a walkthrough just drawn gets
   * its first look, which goes before its `start`, both as changes of their own.
   */
  sync: () => void;
}>;

// Moved from run.ts as they are: `NO_UI`, `inViewport`, `Watcher`, `syncWatcher`,
// `openInput`, `openWaymarkAria`, `listenToWaymarkEvents`.
const NO_UI: UiElements = { dialog: null };
type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;
declare const inViewport: (rect: Rect) => boolean;
declare const syncWatcher: <K>(watcher: Watcher<K>, key: K | undefined, open: (key: K) => () => void, same?: (a: K, b: K) => boolean) => Watcher<K>;
declare const openInput: (onClick: (event: MouseEvent) => void, onKeyDown: (event: KeyboardEvent) => void) => () => void;
declare const openWaymarkAria: (aria: WaymarkAria) => () => void;
declare const listenToWaymarkEvents: (events: WaymarkEvents, onEvent: () => void) => () => void;

export function createPage({
  root,
  queue,
  make,
  attachments,
  walkthroughs,
  beacons,
}: Readonly<{
  /** Read as late as possible, so a Run can be made on a server, where there is no document. */
  root: () => Document | Element;
  queue: Queue;
  make: MakeChange;
  attachments: Attachments;
  walkthroughs: Pick<Walkthroughs, "open" | "obey">;
  beacons: Pick<Beacons, "look" | "detached" | "toLookFor">;
}>): Page {
  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;
  /** The opening whose first look has been sent while attached. */
  let looked: OpenMachine | undefined;
  // A check that throws would throw every frame; each distinct error once per step is enough to see the bug.
  let thrownStep: number | undefined;
  let thrownErrors = new Set<string>();

  const measure: Measure = (selector, cached) => {
    // TODO: as `measure` today, under root().
    throw new Error("not implemented");
  };

  const firstThrowThisStep = (error: unknown, stepGeneration: number): boolean => {
    // TODO: as today.
    throw new Error("not implemented");
  };

  /** Each message is a change of its own. The scroll the machine asks for is done here, as it obeys. */
  const send = (...messages: Message[]): void => {
    // TODO: for (const message of messages)
    //   make((change) => walkthroughs.obey(change, message)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    throw new Error("not implemented");
  };

  const sendRead = (...after: Message[]): void => {
    // TODO: as `sendRead` today, reading `walkthroughs.open()`:
    // stamp the step generation before the check runs (the check is the author's code and may act on the Run);
    // measure the step's Waymark; if needsAdvanceRead, run its check, reporting a throw once per step with
    // queue.fail("stateCheck", error) after the look is queued; then send(stepRead?, ...after).
    throw new Error("not implemented");
  };

  const inputContext = (): InputContext => {
    // TODO: as today, from walkthroughs.open() and attachments.newest(), with NO_UI and padding 0 when none.
    throw new Error("not implemented");
  };

  const onClick = (event: MouseEvent): void => {
    // TODO: as today: nothing while none is open; else send a `click` with whereClicked(event, inputContext()).
    throw new Error("not implemented");
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // TODO: as today: send({ kind: "act", action }) for keyAction(event, inputContext()).
    throw new Error("not implemented");
  };

  const openFrame = (): (() => void) => {
    // TODO: as today:
    // const id = requestAnimationFrame(() => {
    //   // A fired frame has closed itself; `reconcile` opens the next if still wanted.
    //   frame = undefined;
    //   if (walkthroughs.open() === undefined) make((change) => beacons.look(change, measure, performance.now()));
    //   else sendRead();
    // });
    // return () => cancelAnimationFrame(id);
    throw new Error("not implemented");
  };

  const reconcile = (): void => {
    // TODO: as today:
    // const open = walkthroughs.open();
    // const live = open === undefined ? NOTHING_LIVE : liveWatchers(open.state);
    // const forBeacons = attachments.attached() && beacons.toLookFor();
    // input = syncWatcher(input, live.input || undefined, () => openInput(onClick, onKeyDown));
    // frame = syncWatcher(frame, live.frame || forBeacons || undefined, openFrame);
    // waymarkAria = syncWatcher(waymarkAria, live.waymarkAria, openWaymarkAria, sameWaymarkAria);
    // waymarkEvents = syncWatcher(waymarkEvents, live.waymarkEvents, (to) => listenToWaymarkEvents(to, () =>
    //   send({ kind: "event", stepGeneration: to.stepGeneration, now: performance.now() })), sameWaymarkEvents);
    throw new Error("not implemented");
  };

  /**
   * A walkthrough is looked at as soon as it is drawn: as it opens while
   * attached, and as the Run attaches. Its first look comes before its `start`,
   * and both before anything a listener does on seeing it.
   */
  const lookOnOpening = (): void => {
    // TODO: as today:
    // const open = walkthroughs.open();
    // if (open === undefined || looked === open || !open.state.attached) return;
    // looked = open;
    // sendRead({ kind: "start", stepGeneration: open.state.stepGeneration });
    throw new Error("not implemented");
  };

  /** Inside a change, as the first attachment arrives or the last leaves. */
  const setAttached = (change: Change, attached: boolean): void => {
    // TODO:
    // walkthroughs.obey(change, { kind: attached ? "attached" : "detached" });
    // if (!attached) {
    //   // Nobody looked while detached, so that time does not count towards missing or lost.
    //   looked = undefined;
    //   beacons.detached(change);
    // }
    throw new Error("not implemented");
  };

  return {
    attach: (ui, { waymarkPadding = 0 } = {}) => {
      // TODO: as `attach` today, with the list in `attachments`:
      // const attachment = { ui, padding: waymarkPadding };
      // const detach = () => { if (attachments.remove(attachment)) make((change) => setAttached(change, false)); };
      // if (!attachments.add(attachment)) return detach;
      // try { make((change) => setAttached(change, true)); }
      // catch (error) { detach(); throw error; } // The caller gets no detach to call, so nothing may stay attached.
      // return detach;
      throw new Error("not implemented");
    },
    sync: () => {
      reconcile();
      lookOnOpening();
    },
  };
}
