// Sketch: packages/core/src/run/statuses.ts (~95 lines implemented)
// Each Task's status, and which checklist changed it. The one writer of
// `record.statuses`, `startedFrom` and a change's credits. The rules over a
// stored record stay in checklists/tasks.ts, now returning a new record
// instead of writing to a mutable one (see elsewhere.ts).

import { statusIn, withStatus } from "../checklists/record";
import type { Stored } from "../checklists/record";
import { finishTasks, reopen, settleConditions as settled } from "../checklists/tasks";
import type { Moment } from "../checklists/tasks";
import { credit, edit } from "./model";
import type { Draft, TaskCommand, Verdicts } from "./model";
import { actOn } from "./schedule";

/** Statuses in place of the change's: a record loaded or heard takes them whole, and every command here goes through it. */
export const takeStatuses = (draft: Draft, statuses: Stored): Draft =>
  statuses === draft.state.record.statuses ? draft : edit(draft, { record: { ...draft.state.record, statuses } });

/** A checklist's command, or the popover's Skip (`checklist` undefined). An unknown Task id does nothing. */
export function task(draft: Draft, command: TaskCommand, id: string, checklist: string | undefined): Draft {
  const known = draft.state.known.tasks.get(id);
  if (known === undefined) return draft;
  const { statuses } = draft.state.record;
  switch (command) {
    case "markDone":
      return takeStatuses(draft, withStatus(statuses, id, "done"));
    case "markTodo":
      return credit(takeStatuses(draft, reopen(known, statuses)), id, checklist);
    case "toggle": {
      const next = statusIn(statuses, id) === "todo" ? withStatus(statuses, id, "done") : reopen(known, statuses);
      return credit(takeStatuses(draft, next), id, checklist);
    }
    case "skip":
      return skip(draft, id, checklist);
  }
}

/** Only from todo. Exits the Task's walkthrough; a skip from its popover names the checklist whose Start began it. */
function skip(draft: Draft, id: string, checklist: string | undefined): Draft {
  // TODO: as run.ts `skip` today:
  // status !== "todo" -> draft. next = takeStatuses(withStatus(id, "skipped")).
  // walkthrough = task.walkthrough && known.walkthroughs.get(task.walkthrough.id).
  // next = credit(next, id, checklist ?? (walkthrough && startedFrom.get(walkthrough.id))).
  // walkthrough ? actOn(next, walkthrough, "exit") : next.
  throw new Error("not implemented");
}

/** A checklist's Start began this walkthrough. */
export function startedFrom(draft: Draft, walkthrough: string, checklist: string): Draft {
  // TODO: unchanged when already so; else a copied map with the entry set.
  throw new Error("not implemented");
}

/**
 * After settle, every change: a Task with no condition is done once its
 * walkthrough finishes, and `startedFrom` forgets walkthroughs no longer running.
 */
export function finish(draft: Draft, before: Moment): Draft {
  // TODO: next = takeStatuses(draft, finishTasks(known.tasks.values(), before, draft.state.record)).
  // Skip both when record === before: the frame loop's changes touch neither.
  // startedFrom without every id whose progress is not running; the same map when none goes.
  throw new Error("not implemented");
}

/** Conditions' answers, worked out by the shell before the change. None (no context, or one threw): nothing recorded. */
export function settleConditions(draft: Draft, verdicts: Verdicts): Draft {
  if (verdicts === undefined) return draft;
  return takeStatuses(draft, settled(draft.state.known.tasks.values(), draft.state.record.statuses, verdicts));
}
