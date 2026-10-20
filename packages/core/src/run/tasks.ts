import { statusIn } from "../checklists/record";
import type { StoredStatus } from "../checklists/record";
import type {
  AnyTask,
  ChecklistDefinition,
  ChecklistGroup,
  ChecklistsEvent,
  DefinedTask,
  TaskStatus,
} from "../checklists/types";
import type { RunState, UserRecord, Work } from "../state";
import type { Walkthrough } from "../walkthrough/types";
import { setStatus } from "./record";
import { act, start } from "./walkthroughs";

export function tasksOf(groups: readonly ChecklistGroup[]): readonly DefinedTask[] {
  const seen = new Set<string>();
  const tasks: DefinedTask[] = [];
  for (const group of groups) {
    for (const task of group.tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  }
  return tasks;
}

export function taskOf(groups: readonly ChecklistGroup[], id: string): DefinedTask | undefined {
  for (const group of groups) for (const task of group.tasks) if (task.id === id) return task;
  return undefined;
}

export const taskIdFor = (groups: readonly ChecklistGroup[], walkthrough: string): string | null =>
  tasksOf(groups).find((task) => task.walkthrough?.id === walkthrough)?.id ?? null;

export const isComplete = (definition: ChecklistDefinition<AnyTask>, taskStatusById: UserRecord["taskStatusById"]): boolean =>
  definition.tasks.every((task) => statusIn(taskStatusById, task.id) !== "todo");

const withStatus = (runState: RunState, id: string, status: StoredStatus | undefined): RunState => {
  const userRecord = setStatus(runState.userRecord, id, status);
  return userRecord === runState.userRecord ? runState : { ...runState, userRecord };
};

/** Done or skipped back to todo. A condition that is likely still true would tick a done Task straight back. */
const reopen = (runState: RunState, task: DefinedTask): RunState => {
  const status = statusIn(runState.userRecord.taskStatusById, task.id);
  if (status === "todo") return runState;
  return withStatus(runState, task.id, status === "done" && task.isComplete !== undefined ? "reopened" : undefined);
};

export const markDone =
  (id: string): Work =>
  (runState) =>
    taskOf(runState.walkthroughsAndChecklistsInUse.checklistDefinitions, id) === undefined ? runState : withStatus(runState, id, "done");

export const markTodo =
  (id: string, from: string): Work =>
  (runState, change) => {
    const task = taskOf(runState.walkthroughsAndChecklistsInUse.checklistDefinitions, id);
    if (task === undefined) return runState;
    change.credits.set(id, from);
    return reopen(runState, task);
  };

export const toggle =
  (id: string, from: string): Work =>
  (runState, change) => {
    const task = taskOf(runState.walkthroughsAndChecklistsInUse.checklistDefinitions, id);
    if (task === undefined) return runState;
    change.credits.set(id, from);
    return statusIn(runState.userRecord.taskStatusById, id) === "todo" ? withStatus(runState, id, "done") : reopen(runState, task);
  };

export const skip =
  (id: string, from: string | undefined): Work =>
  (runState, change) => {
    const task = taskOf(runState.walkthroughsAndChecklistsInUse.checklistDefinitions, id);
    if (task === undefined || statusIn(runState.userRecord.taskStatusById, id) !== "todo") return runState;
    const next = withStatus(runState, id, "skipped");
    const walkthrough = task.walkthrough === undefined ? undefined : runState.walkthroughsAndChecklistsInUse.walkthroughsById.get(task.walkthrough.id);
    const credited = from ?? (walkthrough === undefined ? undefined : runState.startRequests.startedFromChecklist.get(walkthrough.id));
    if (credited !== undefined) change.credits.set(id, credited);
    return walkthrough === undefined ? next : act("exit", walkthrough)(next, change);
  };

export const startFrom =
  (walkthrough: Walkthrough, checklist: string): Work =>
  (runState, change) => {
    const next = start(walkthrough)(runState, change);
    const { startedFromChecklist } = next.startRequests;
    if (startedFromChecklist.get(walkthrough.id) === checklist) return next;
    return { ...next, startRequests: { ...next.startRequests, startedFromChecklist: new Map(startedFromChecklist).set(walkthrough.id, checklist) } };
  };

/** Every completion condition asked before anything is recorded, so one that throws changes nothing. */
export const conditions: Work = (runState, change) => {
  const { checklistContext } = runState;
  if (checklistContext === undefined) return runState;
  const { taskStatusById } = runState.userRecord;
  const open = tasksOf(runState.walkthroughsAndChecklistsInUse.checklistDefinitions).filter(
    (task) => task.isComplete !== undefined && statusIn(taskStatusById, task.id) !== "done",
  );
  if (open.length === 0) return runState;
  const verdicts = change.verdicts(open, checklistContext);
  if (verdicts === undefined) return runState;
  let next = runState;
  for (const { id } of open) {
    const met = verdicts.get(id) === true;
    if (taskStatusById[id] !== "reopened") {
      if (met) next = withStatus(next, id, "done");
    } else if (!met) {
      next = withStatus(next, id, undefined);
    }
  }
  return next;
};

const walkthroughStatus = (userRecord: UserRecord, task: DefinedTask) =>
  task.walkthrough === undefined ? undefined : userRecord.walkthroughProgressById[task.walkthrough.id]?.status;

/** A Task with no condition is done once its walkthrough finishes; one with a condition waits for it. */
export function finish(before: RunState, after: RunState): RunState {
  const { walkthroughProgressById } = after.userRecord;
  if (
    walkthroughProgressById === before.userRecord.walkthroughProgressById &&
    after.startRequests.startedFromChecklist === before.startRequests.startedFromChecklist
  ) {
    return after;
  }
  let next = after;
  const moved = walkthroughProgressById !== before.userRecord.walkthroughProgressById;
  for (const task of moved ? tasksOf(after.walkthroughsAndChecklistsInUse.checklistDefinitions) : []) {
    if (task.isComplete !== undefined) continue;
    if (walkthroughStatus(before.userRecord, task) === "running" && walkthroughStatus(after.userRecord, task) === "finished") {
      next = withStatus(next, task.id, "done");
    }
  }
  const { startedFromChecklist } = next.startRequests;
  let kept: Map<string, string> | undefined;
  for (const id of startedFromChecklist.keys()) {
    if (walkthroughProgressById[id]?.status !== "running") (kept ??= new Map(startedFromChecklist)).delete(id);
  }
  return kept === undefined ? next : { ...next, startRequests: { ...next.startRequests, startedFromChecklist: kept } };
}

const fromChecklist = (checklist: string | undefined) => (checklist === undefined ? {} : { checklist });

const statusEvent = (task: AnyTask, was: TaskStatus, now: TaskStatus, checklist: string | undefined): ChecklistsEvent => {
  if (now === "done") return { type: "taskComplete", task };
  if (now === "skipped") return { type: "taskSkipped", task, ...fromChecklist(checklist) };
  if (was === "done") return { type: "taskReopened", task };
  return { type: "taskUnskipped", task, ...fromChecklist(checklist) };
};

/** `credit` names the checklist a Task's status was changed from. */
export function eventsBetween(
  tasks: readonly DefinedTask[],
  before: UserRecord,
  after: UserRecord,
  credit: (id: string) => string | undefined,
): ChecklistsEvent[] {
  const stopped: ChecklistsEvent[] = [];
  const changed: ChecklistsEvent[] = [];
  const started: ChecklistsEvent[] = [];
  for (const task of tasks) {
    const was = walkthroughStatus(before, task) === "running";
    const is = walkthroughStatus(after, task) === "running";
    const statusWas = statusIn(before.taskStatusById, task.id);
    const statusNow = statusIn(after.taskStatusById, task.id);
    if (was && !is) {
      const reason =
        walkthroughStatus(after, task) === "finished"
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
