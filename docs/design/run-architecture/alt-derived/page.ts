// Sketch for packages/core/src/run/page.ts, about 240 lines.
//
// Owns: PageState, everything that touches the page. The renderers attached,
// the DOM hookups (input, the frame loop, the Waymark's aria and events),
// the state-check errors already reported on a visit, and the module-level
// count of Runs attached to each page. Reads the facts, never writes them:
// what it sees goes back to the Run as a message, which `commit` runs as a
// change.
//
// Which hookups are wanted is worked out from the facts after every change
// (the rules' `liveWatchers`, and whether a beacon has a Waymark to look
// for), and each is opened or closed to match. Nothing is wanted for a step
// until its first look, so a Run that is not attached touches no page.
//
// Replaces run.ts's measure, firstThrowThisStep, sendRead, lookAtBeacons,
// lookOnOpening, inputContext, onClick, onKeyDown, openFrame, reconcile,
// setAttached, countAttached and attach, with `attachments`, `input`,
// `frame`, `waymarkAria`, `waymarkEvents`, `looked`, `thrownStep` and
// `thrownErrors`. `looked` goes: the visit says whether it was looked at.

import type { Phases, Facts, Message, Work } from "../../../../packages/core/src/state";
import type { Queue } from "../../../../packages/core/src/queue";
import type { WaymarkRead } from "../../../../packages/core/src/run/rules";
import type { AttachOptions, UiElements } from "../../../../packages/core/src/run/types";

/** What the page needs of the Run. */
export type PageDeps = Readonly<{
  root: () => Document | Element;
  queue: Queue;
  /** The facts as they are now. */
  facts: () => Facts;
  /** A change, queued behind the one running, as every page event is. */
  change: (phases: Phases) => void;
  /**
   * A change run at once. Only the first look uses it: it runs from the
   * queue, before the change that made it due has notified anyone, so its
   * `start` is announced before anything a listener does on seeing the step.
   */
  commitNow: (phases: Phases) => void;
  /** A message as a Work, as walkthroughs.ts obeys it. */
  obey: (message: Message) => Work;
  /** A frame with nothing open, as a Work over the beacons measured. */
  sightBeacons: (reads: ReadonlyMap<string, WaymarkRead>, now: number) => Work;
  /** The last renderer detached, as a Work. */
  detached: Work;
}>;

export type Page = Readonly<{
  /** `run.attach`. The first attachment is a change with no work, so the first look comes due; the last one gone is `detached`. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /**
   * Step 7 of every change, whether or not it moved anything, as a frame
   * that has just fired must be asked for again: each hookup opened or
   * closed to match the facts, and the first look queued when one is due.
   *
   * The first look is due while a renderer is attached and the open visit
   * has not been looked at. It is queued, not run, so it measures the page
   * as the renderer left it; when it runs it looks again at whichever visit
   * is open then, and does nothing if none is due. So a step a handler
   * moved before the look ran is the step measured, and `start` names the
   * visit it measured: a look cannot go stale.
   */
  afterChange: (facts: Facts) => void;
}>;

export function createPage(deps: PageDeps): Page {
  throw new Error("not implemented");
}
