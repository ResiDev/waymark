// Sketch for packages/core/src/run/checklists.ts, about 220 lines. Not compiled.
//
// Owns: task statuses, the tasks and groups that have reached the Run, and
// which checklist started each running walkthrough. Pure, as walkthroughs.ts
// is. No author code runs here: completion conditions are asked by `run.ts`
// before the change, and their answers come in as `Verdicts`.
//
// Replaces the mutable `checklists/statuses.ts` and `checklists/views.ts`;
// `checklists/tasks.ts` returns new records instead of writing a `Statuses`.

import type { Stored } from "../checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot, ChecklistsEvent, DefinedTask, StorageStatus } from "../checklists/types";
import type { Change } from "./change";
import type { Progress } from "./walkthroughs";

export type Checklists = Readonly<{
  /** Only Tasks off todo. A new object only after a write that changed it. */
  statuses: Stored;
  /** The first definition of each id, in the order they reached the Run: the order checklist events go in. */
  tasks: ReadonlyMap<string, DefinedTask>;
  groups: ReadonlySet<ChecklistGroup>;
  /** The checklist whose Start began each running walkthrough, by walkthrough id, so a skip from its popover names it. */
  startedFrom: ReadonlyMap<string, string>;
}>;

/** Each due condition's answer. `undefined`: no context, or a condition threw and was reported, so nothing is recorded. */
export type Verdicts = ReadonlyMap<string, boolean> | undefined;

export type Condition = Readonly<{ id: string; isComplete: (context: unknown) => boolean }>;

// Edits: between changes.

/** A group's Tasks reach the Run, the first definition of each id. The same value when it already has. */
export function join(c: Checklists, group: ChecklistGroup): Checklists {
  throw new Error("not implemented");
}

// Commands: inside a change. Each credits the checklist it came from.

export function markDone(c: Checklists, id: string): Checklists {
  throw new Error("not implemented");
}
export function markTodo(c: Checklists, id: string, from: string, change: Change): Checklists {
  throw new Error("not implemented");
}
export function toggle(c: Checklists, id: string, from: string, change: Change): Checklists {
  throw new Error("not implemented");
}
/** A todo Task skipped. Its walkthrough's exit is the walkthroughs' half: `run.ts` composes the two. */
export function skip(c: Checklists, id: string, from: string | undefined, change: Change): Checklists {
  // TODO: not todo → c. statuses[id] = "skipped"; credit from ?? startedFrom.get(walkthroughOf(id)).
  throw new Error("not implemented");
}
export function startedFrom(c: Checklists, walkthrough: string, checklist: string): Checklists {
  throw new Error("not implemented");
}

/** The conditions to ask, for Tasks not done. `run.ts` asks them, so a throw is the shell's to report. */
export function conditionsDue(c: Checklists): readonly Condition[] {
  throw new Error("not implemented");
}

/** Records what the conditions said, all or nothing, as `checkConditions` does today. */
export function settleConditions(c: Checklists, verdicts: Verdicts): Checklists {
  throw new Error("not implemented");
}

// The record

/** A record loaded or heard: statuses take it whole. */
export const restore = (c: Checklists, statuses: Stored): Checklists =>
  statuses === c.statuses ? c : { ...c, statuses };

// The pipeline's step. Only `settle` in model.ts calls it.

/**
 * After the walkthroughs settle, before the change's `after`: a Task with no
 * condition is done once its walkthrough finishes, and a walkthrough no
 * longer running forgets the checklist that started it.
 */
export function finish(c: Checklists, before: Progress, after: Progress): Checklists {
  throw new Error("not implemented");
}

// Reads

/** The Task a walkthrough guides, for the open walkthrough's snapshot. */
export function taskOf(c: Checklists, walkthrough: string): string | null {
  throw new Error("not implemented");
}

/** What a checklist's snapshot is drawn from. */
export type Seen = Readonly<{ statuses: Stored; progress: Progress; open: string | undefined; storageStatus: StorageStatus }>;

/** A checklist's snapshot: `previous` itself when no row, its open Task or its storage status changed. */
export function select<TTask extends AnyTask>(
  definition: ChecklistDefinition<TTask>,
  seen: Seen,
  previous: ChecklistSnapshot<TTask> | undefined,
): ChecklistSnapshot<TTask> {
  throw new Error("not implemented");
}

/** As `ChecklistsEvent` orders them: each Task that moved, between two records. */
export function eventsOf(c: Checklists, before: Seen, after: Seen, credits: ReadonlyMap<string, string>): readonly ChecklistsEvent[] {
  throw new Error("not implemented");
}
