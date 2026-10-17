import { statusIn } from "./record";
import type { Stored } from "./record";
import type { Statuses } from "./statuses";
import type { AnyTask, ChecklistsEvent, DefinedTask, TaskStatus } from "./types";
import type { WalkthroughProgress } from "../walkthrough/types";

/** What checklist events are worked out from: the change between two of these. */
export type Moment = Readonly<{
  statuses: Stored;
  progress: Readonly<Record<string, WalkthroughProgress>>;
}>;

const statusOf = (moment: Moment, task: DefinedTask) =>
  task.walkthrough === undefined ? undefined : moment.progress[task.walkthrough.id]?.status;

const fromChecklist = (checklist: string | undefined) =>
  checklist === undefined ? {} : { checklist };

const statusEvent = (
  task: AnyTask,
  was: TaskStatus,
  now: TaskStatus,
  checklist: string | undefined,
): ChecklistsEvent => {
  if (now === "done") return { type: "taskComplete", task };
  if (now === "skipped") return { type: "taskSkipped", task, ...fromChecklist(checklist) };
  if (was === "done") return { type: "taskReopened", task };
  return { type: "taskUnskipped", task, ...fromChecklist(checklist) };
};

/** `credit` names the checklist a Task's status was changed from. */
export function eventsBetween(
  tasks: readonly DefinedTask[],
  before: Moment,
  after: Moment,
  credit: (id: string) => string | undefined,
): ChecklistsEvent[] {
  const stopped: ChecklistsEvent[] = [];
  const changed: ChecklistsEvent[] = [];
  const started: ChecklistsEvent[] = [];
  for (const task of tasks) {
    const was = statusOf(before, task) === "running";
    const is = statusOf(after, task) === "running";
    const statusWas = statusIn(before.statuses, task.id);
    const statusNow = statusIn(after.statuses, task.id);
    if (was && !is) {
      const reason =
        statusOf(after, task) === "finished"
          ? "finished"
          : statusNow === "skipped" && statusWas !== "skipped"
            ? "skipped"
            : "stopped";
      stopped.push({ type: "taskStopped", task: task.task, reason });
    }
    if (statusWas !== statusNow) changed.push(statusEvent(task.task, statusWas, statusNow, credit(task.id)));
    if (!was && is) started.push({ type: "taskStarted", task: task.task });
  }
  return [...stopped, ...changed, ...started];
}

/** A Task with no condition is done once its walkthrough finishes; one with a condition waits for it. */
export function finishTasks(tasks: readonly DefinedTask[], before: Moment, after: Moment, statuses: Statuses): void {
  for (const task of tasks) {
    if (task.isComplete !== undefined) continue;
    if (statusOf(before, task) === "running" && statusOf(after, task) === "finished") statuses.set(task.id, "done");
  }
}

/** Every condition is checked before anything is recorded, so a throwing check changes nothing. */
export function checkConditions(
  tasks: readonly DefinedTask[],
  statuses: Statuses,
  context: unknown,
  fail: (error: unknown) => void,
): void {
  const complete: string[] = [];
  const settled: string[] = [];
  for (const { id, isComplete } of tasks) {
    if (isComplete === undefined || statuses.status(id) === "done") continue;
    let met: boolean;
    try {
      met = isComplete(context);
    } catch (error) {
      fail(error);
      return;
    }
    if (!statuses.isReopened(id)) {
      if (met) complete.push(id);
    } else if (!met) {
      settled.push(id);
    }
  }
  for (const id of settled) statuses.set(id, undefined);
  for (const id of complete) statuses.set(id, "done");
}

/** Done or skipped back to todo. A condition that is likely still true would tick a done Task straight back. */
export function reopen(task: DefinedTask, statuses: Statuses): void {
  const status = statuses.status(task.id);
  if (status === "todo") return;
  statuses.set(task.id, status === "done" && task.isComplete !== undefined ? "reopened" : undefined);
}
