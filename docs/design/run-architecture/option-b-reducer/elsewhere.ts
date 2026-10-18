// Sketch: what changes outside packages/core/src/run/. Each block names its file.
// Everything here becomes pure over immutable values; nothing public changes
// except one internal field on ChecklistDefinition.

import type { Stored, StoredStatus } from "../checklists/record";
import type { Moment } from "../checklists/tasks";
import type { DefinedTask } from "../checklists/types";
import type { WalkthroughProgress } from "../walkthrough/types";

// --- checklists/record.ts (+8 lines) ---------------------------------------

/** The record with one status set, or gone for `undefined`. The same record when it already says so. */
export declare function withStatus(record: Stored, id: string, status: StoredStatus | undefined): Stored;

// --- checklists/statuses.ts: deleted (-32) ----------------------------------
// The mutable `Statuses` object goes. Its `record()` identity rule is now just
// the immutability of `Stored`, and `set` is `withStatus`.

// --- checklists/tasks.ts (~same size) ----------------------------------------
// `eventsBetween` is unchanged. The rest return a new record instead of
// writing to `Statuses`.

/** A Task with no condition is done once its walkthrough finishes; one with a condition waits for it. */
export declare function finishTasks(tasks: Iterable<DefinedTask>, before: Moment, after: Moment): Stored;

/** Done or skipped back to todo. A condition that is likely still true would tick a done Task straight back. */
export declare function reopen(task: DefinedTask, statuses: Stored): Stored;

/** The Tasks whose conditions are asked, in order: each with one, not done. Replaces the first half of `checkConditions`. */
export declare function conditionsDue(
  tasks: Iterable<DefinedTask>,
  statuses: Stored,
): readonly Readonly<{ id: string; isComplete: (context: unknown) => boolean }>[];

/**
 * What the answers record: a met condition ticks its Task done, unless it
 * was reopened, which stays todo until its condition has been false. The
 * second half of `checkConditions`; the asking moved to the shell.
 */
export declare function settleConditions(
  tasks: Iterable<DefinedTask>,
  statuses: Stored,
  met: ReadonlyMap<string, boolean>,
): Stored;

// --- checklists/views.ts: deleted (-81) --------------------------------------
// `snapshotOf` and `sameSnapshot` move into select.ts `selectChecklist`.
// `View`, `ViewSource`, `createView` and `refresh` go: a view's snapshot lives
// in `Model.shown`, its listeners in the shell's handle, and `refresh`'s
// "changed" and "completed" lists come out of `publish`.

// --- checklists/types.ts, checklists/checklists.ts (+3 lines) ---------------

/**
 * `ChecklistDefinition` gains the DefinedTask of each of its Tasks, in the
 * same order, so a snapshot reads each row's walkthrough without an index
 * built per view (today `sourceFor`'s `walkthroughOf` map). `defineChecklists`
 * fills it from the group's Tasks it already builds.
 */
export type ChecklistDefinitionAddition = Readonly<{ defined: readonly DefinedTask[] }>;

// --- storage/records.ts (1 line) ---------------------------------------------

/** Takes the time, so the core never reads the clock: `World.now`. */
export declare function staleness(
  progress: WalkthroughProgress,
  stepCount: number,
  maxAge: number,
  now: number,
): "stepsChanged" | "expired" | undefined;

// --- run/rules.ts, run/state.ts, run/input.ts, queue.ts, subscribe.ts: unchanged.
