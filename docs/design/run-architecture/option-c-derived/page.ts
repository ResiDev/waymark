// Sketch for packages/core/src/run/page.ts. Not compiled.
//
// The page: measuring Waymarks, the frame loop, keys and clicks, the
// Waymark's aria and events, and the renderers attached. It reads the Model
// and reports what it sees as messages; it never writes the Model, and does
// not import `change.ts`.

import { inDevelopment } from "../dev";
import type { CallbackName } from "../problems";
import { checkOf, hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { candidates, machineOf } from "./model";
import type { Model } from "./model";
import { liveWatchers, needsAdvanceRead, NOTHING_LIVE, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { stepAt } from "./state";
import type { AttachOptions, Rect, UiElements } from "./types";

// Moved unchanged from run.ts: NO_UI, inViewport, Watcher, syncWatcher,
// openInput, openWaymarkAria, listenToWaymarkEvents.

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

export type PageDeps = Readonly<{
  /** Where Waymarks are looked for, read as late as possible: there is no document on a server. */
  root: () => Document | Element;
  model: () => Model;
  /** Messages for the open walkthrough, applied together as one change. */
  send: (...messages: Message[]) => void;
  /** What each beacon's Waymark was seen as on one frame, applied as one change. */
  seeBeacons: (reads: ReadonlyMap<string, WaymarkRead>, now: number) => void;
  /** As the first renderer attaches, and as the last detaches. */
  setAttached: (attached: boolean) => void;
  fail: (callback: CallbackName, error: unknown) => void;
}>;

/** What a change asks of the page once its work is done. */
export type Asked = Readonly<{
  /** The first renderer attached in this change. */
  attaching: boolean;
  scrollTo: Element | undefined;
}>;

export type Page = Readonly<{
  /** See `Run["attach"]`. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  attached: () => boolean;
  /**
   * After every change's snapshots are built, before anyone hears of it:
   * makes the scroll the change asked for, brings the page listeners and the
   * frame into line with the Model, and sends the open walkthrough's first
   * look when it is due. Always, not only on change: a frame that has just
   * fired must be asked for again even when its look found nothing new.
   */
  afterChange: (asked: Asked) => void;
}>;

export function createPage(deps: PageDeps): Page {
  // Kept here: the renderers attached, the four watchers, and which errors a
  // throwing check has already reported. None is worked out from the Model.

  /**
   * A check that throws would throw every frame; each distinct error once per
   * step is enough to see the bug. One value, not two kept in step.
   */
  // let thrown: Readonly<{ stepGeneration: number; keys: Set<string> }> | undefined;

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    // TODO, unchanged from run.ts.
    throw new Error("not implemented");
  };

  const sendRead = (...after: Message[]) => {
    // TODO, as today with `machineOf(deps.model())` for `machine`:
    // running only; stamp stepGeneration before the check (the check is the author's code and may act on the Run);
    // measure the step's Waymark from state.element; run the check if needsAdvanceRead, reporting
    // a throw once per step generation via `thrown`; deps.send(...read, ...after)
    throw new Error("not implemented");
  };

  const lookAtBeacons = () => {
    // TODO
    // const reads = new Map();
    // for { walkthrough, progress, sighting } of candidates(deps.model()):
    //   selector of its step → reads.set(id, measure(selector, sighting.element))
    // deps.seeBeacons(reads, performance.now());
    throw new Error("not implemented");
  };

  /**
   * The open walkthrough is looked at as soon as it is drawn: as it opens
   * while attached, and as the Run attaches. Its first look comes before its
   * `start`, both in one change, and before anything a listener does on
   * seeing it. Due while its machine has not started, so no flag says
   * whether it was looked at: a look dropped because the step moved on
   * before it landed is simply sent again.
   */
  const lookWhenDue = (attaching: boolean) => {
    // TODO
    // const machine = machineOf(deps.model());
    // if (!machine?.state.attached || (machine.state.started && !attaching)) return;
    // sendRead({ kind: "start", stepGeneration: machine.state.stepGeneration });
    throw new Error("not implemented");
  };

  const inputContext = (): InputContext => {
    // TODO, as today with machineOf(deps.model()) and the newest attachment.
    throw new Error("not implemented");
  };

  const reconcile = () => {
    // TODO, as today:
    // const machine = machineOf(model); live = machine ? liveWatchers(machine.state) : NOTHING_LIVE;
    // beacons = attached && candidates(model).some(c => hasWaymark(stepAt(c.walkthrough, c.progress.step)));
    // input, frame (live.frame || beacons), waymarkAria, waymarkEvents via syncWatcher.
    // The frame callback: frame = undefined; machineOf(model) ? sendRead() : lookAtBeacons();
    throw new Error("not implemented");
  };

  return {
    attach: (ui, options) => {
      // TODO, as today: the first attachment counts this page (warning of a second
      // Run in development) and calls deps.setAttached(true), detaching again if that
      // throws, as the caller gets no detach to call; the last to detach calls
      // deps.setAttached(false).
      throw new Error("not implemented");
    },
    attached: () => {
      throw new Error("not implemented");
    },
    afterChange: ({ attaching, scrollTo }) => {
      // TODO
      // scrollTo?.scrollIntoView({ behavior: "smooth", block: "center" });
      // reconcile();
      // lookWhenDue(attaching);
      throw new Error("not implemented");
    },
  };
}
