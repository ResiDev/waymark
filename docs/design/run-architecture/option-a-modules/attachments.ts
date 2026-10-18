// packages/core/src/run/attachments.ts — about 55 lines.
//
// Owns: `attachments`, and the page-wide count behind the development warning
// (`attachedRuns`).
//
// Who draws the Run. A leaf, made before anything else that reads it:
// `walkthroughs` asks whether the Run is attached as a walkthrough opens, and
// the page reads the newest attachment's elements as each key and click
// arrives. Telling the open walkthrough's machine is the page's job, in a
// change; this only keeps the list.

import { inDevelopment } from "../dev";
import type { UiElements } from "./types";

export type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

export type Attachments = Readonly<{
  /** True when it is the first: the Run has just become attached. */
  add: (attachment: Attachment) => boolean;
  /** True when it was the last: the Run has just become detached. False for one already gone, so detaching twice is the same as once. */
  remove: (attachment: Attachment) => boolean;
  attached: () => boolean;
  /** The newest attachment's elements and padding count. */
  newest: () => Attachment | undefined;
}>;

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

export function createAttachments(root: () => Document | Element): Attachments {
  const attachments: Attachment[] = [];

  const countAttached = (by: 1 | -1): void => {
    // TODO: as `countAttached` today, with its development warning on a second Run.
    throw new Error("not implemented");
  };

  return {
    add: (attachment) => {
      // TODO: attachments.push(attachment); if it is the only one, countAttached(1) and return true.
      throw new Error("not implemented");
    },
    remove: (attachment) => {
      // TODO: splice it out; false if it was not there or others remain; else countAttached(-1) and return true.
      throw new Error("not implemented");
    },
    attached: () => attachments.length > 0,
    newest: () => attachments.at(-1),
  };
}
