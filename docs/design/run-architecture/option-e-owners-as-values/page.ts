// Sketch for packages/core/src/run/page.ts, about 230 lines. Not compiled.
//
// The shell's other half: everything that touches the DOM. Owns the
// attachments, the watchers (keys, clicks, the frame loop, the Waymark's aria
// and events), the dev warning for two Runs on one page, and which errors a
// state check has already thrown this step. It reads the state through
// `open` and `collapsed`, and changes it only by sending what it saw.
//
// Mostly moved as it is from today's run.ts: `measure`, `sendRead`,
// `lookAtBeacons`, `inputContext`, `onClick`, `onKeyDown`, `openFrame`,
// `reconcile`, `countAttached`, `attach`, `firstThrowThisStep`.

import type { WaymarkRead, Message } from "./rules";
import type { AttachOptions, UiElements } from "./types";
import type { Collapsed, Machine } from "./walkthroughs";

export type PageDeps = Readonly<{
  root: () => Document | Element;
  open: () => Machine | undefined;
  collapsed: () => readonly Collapsed[];
  /** A message for the open machine, as a change of its own. */
  send: (message: Message) => void;
  /** Each beacon's Waymark as measured, by walkthrough id, as a change of its own. */
  sightBeacons: (reads: ReadonlyMap<string, WaymarkRead>, now: number) => void;
  /** The first attachment, or the last to detach, as a change of its own. */
  attached: (attached: boolean) => void;
  fail: (callback: "stateCheck", error: unknown) => void;
}>;

export type Page = Readonly<{
  /** As `Run.attach`. The newest attachment's elements and padding count. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /** Whether a renderer draws the Run now. Read by `commit` as each change opens. */
  attached: () => boolean;
  /** After every change's state is in, before any callback: the listeners brought in line with the state. */
  sync: () => void;
  /** A walkthrough just drawn: measure it, run its state check, and send the read with its `start`. */
  look: (start: Message) => void;
}>;

export function createPage(deps: PageDeps): Page {
  throw new Error("not implemented");
}
