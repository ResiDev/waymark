// Sketch for packages/core/src/run/tasks.ts, about 190 lines. Replaces
// checklists/tasks.ts and checklists/statuses.ts (134 lines), and run.ts's
// conditions, credit, skip, toggle, markTodo and the checklist commands.
//
// Owns: what a change does to Tasks. It decides every status (written
// through record.ts) and `Asked.startedFrom`. Pure: each command is a Work,
// and a Task's completion condition is asked through `change.verdicts`, so
// no app code runs here.
//
// The Tasks are not stored: they are worked out from the groups the app
// handed over, and cached by the groups' identity. `Recorded` has the shape
// today's `Moment` has, so `eventsBetween` and `finishTasks` take two of
// them as they are.

import type { Stored } from "../../../../packages/core/src/checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistsEvent, DefinedTask } from "../../../../packages/core/src/checklists/types";
import type { Facts, Recorded, Work } from "../../../../packages/core/src/state";
import type { Walkthrough } from "../../../../packages/core/src/walkthrough/types";

// ─── Worked out ─────────────────────────────────────────────────────────────

/** Every Task the Run knows, the first definition of each id, in the order the groups came. Cached by the groups' identity. */
export function tasksOf(groups: readonly ChecklistGroup[]): readonly DefinedTask[] {
  throw new Error("not implemented");
}

/** One Task by id, from the same cache. */
export function taskOf(groups: readonly ChecklistGroup[], id: string): DefinedTask | undefined {
  throw new Error("not implemented");
}

/** The first Task whose walkthrough this is: the open walkthrough's `task`. */
export function taskFor(groups: readonly ChecklistGroup[], walkthrough: string): string | null {
  throw new Error("not implemented");
}

/** Every Task of the checklist is done or skipped. For `checklistComplete`, between two records. */
export function isComplete(definition: ChecklistDefinition<AnyTask>, statuses: Stored): boolean {
  throw new Error("not implemented");
}

// ─── Commands ───────────────────────────────────────────────────────────────

export const markDone = (id: string): Work => {
  throw new Error("not implemented");
};

/** Back to todo, or `reopened` for a Task with a condition, credited to the checklist. */
export const markTodo = (id: string, from: string): Work => {
  throw new Error("not implemented");
};

export const toggle = (id: string, from: string): Work => {
  throw new Error("not implemented");
};

/**
 * Skipped, credited to `from`, or, from a walkthrough's popover, to the
 * checklist that started it; then its walkthrough is exited.
 */
export const skip = (id: string, from: string | undefined): Work => {
  throw new Error("not implemented");
};

/** A checklist's Start: its walkthrough started, and remembered as started from that checklist, for a Skip from its popover. */
export const startFrom = (walkthrough: Walkthrough, checklist: string): Work => {
  throw new Error("not implemented");
};

/** Every completion condition asked of the context, before anything is recorded, so one that throws changes nothing. */
export const conditions: Work = () => {
  throw new Error("not implemented");
};

// ─── After every work ───────────────────────────────────────────────────────

/**
 * Today's steps 4 and 5, after each work of a change rather than once, so a
 * walkthrough one held command finishes and the next starts again still
 * finishes its Task: a Task with no condition done once its walkthrough
 * went from running to finished, and `startedFrom` forgetting each
 * walkthrough that stopped running.
 */
export function finish(before: Facts, after: Facts): Facts {
  throw new Error("not implemented");
}

// ─── Announced ──────────────────────────────────────────────────────────────

/** Today's `eventsBetween`, over two records. `credit` names the checklist a status was changed from. */
export function eventsBetween(
  tasks: readonly DefinedTask[],
  before: Recorded,
  after: Recorded,
  credit: (id: string) => string | undefined,
): ChecklistsEvent[] {
  throw new Error("not implemented");
}
