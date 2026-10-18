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

// WaymarkAria and WaymarkEvents, the keys of two watchers, move here from today's run.ts.
type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;
type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

/** Everything this file holds, in one place. Private: nothing outside writes it. */
type PageState = {
  /** Renderers drawing the Run, newest last. The newest one's elements are used; the one before takes over when it unmounts. */
  attachments: Attachment[];
  /** DOM listeners. `sync()` brings them in line with the state after every change. */
  watching: {
    input: Watcher<true>;                    // clicks and keys
    frame: Watcher<true>;                    // the next animation frame
    aria: Watcher<WaymarkAria>;              // aria attributes on the Waymark
    events: Watcher<WaymarkEvents>;          // listeners for "advance on event" steps
  };
  /** A state check's error → the step it was reported on, so a check that throws is reported once a step, not every frame. */
  thrown: Map<string, number>;
};

/** Shared by every Run on the page, for the development warning about two Runs drawing over each other. */
const attachedRuns = new WeakMap<Document, number>();

export function createPage(deps: PageDeps): Page {
  const page: PageState = {
    attachments: [],
    watching: { input: undefined, frame: undefined, aria: undefined, events: undefined },
    thrown: new Map(),
  };
  throw new Error("not implemented");
}
