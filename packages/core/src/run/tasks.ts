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
import type { Facts, Recorded, Work } from "../state";
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

export const isComplete = (definition: ChecklistDefinition<AnyTask>, statuses: Recorded["statuses"]): boolean =>
  definition.tasks.every((task) => statusIn(statuses, task.id) !== "todo");

const withStatus = (facts: Facts, id: string, status: StoredStatus | undefined): Facts => {
  const recorded = setStatus(facts.recorded, id, status);
  return recorded === facts.recorded ? facts : { ...facts, recorded };
};

/** Done or skipped back to todo. A condition that is likely still true would tick a done Task straight back. */
const reopen = (facts: Facts, task: DefinedTask): Facts => {
  const status = statusIn(facts.recorded.statuses, task.id);
  if (status === "todo") return facts;
  return withStatus(facts, task.id, status === "done" && task.isComplete !== undefined ? "reopened" : undefined);
};

export const markDone =
  (id: string): Work =>
  (facts) =>
    taskOf(facts.given.groups, id) === undefined ? facts : withStatus(facts, id, "done");

export const markTodo =
  (id: string, from: string): Work =>
  (facts, change) => {
    const task = taskOf(facts.given.groups, id);
    if (task === undefined) return facts;
    change.credits.set(id, from);
    return reopen(facts, task);
  };

export const toggle =
  (id: string, from: string): Work =>
  (facts, change) => {
    const task = taskOf(facts.given.groups, id);
    if (task === undefined) return facts;
    change.credits.set(id, from);
    return statusIn(facts.recorded.statuses, id) === "todo" ? withStatus(facts, id, "done") : reopen(facts, task);
  };

export const skip =
  (id: string, from: string | undefined): Work =>
  (facts, change) => {
    const task = taskOf(facts.given.groups, id);
    if (task === undefined || statusIn(facts.recorded.statuses, id) !== "todo") return facts;
    const next = withStatus(facts, id, "skipped");
    const walkthrough = task.walkthrough === undefined ? undefined : facts.given.walkthroughs.get(task.walkthrough.id);
    const credited = from ?? (walkthrough === undefined ? undefined : facts.asked.startedFrom.get(walkthrough.id));
    if (credited !== undefined) change.credits.set(id, credited);
    return walkthrough === undefined ? next : act("exit", walkthrough)(next, change);
  };

export const startFrom =
  (walkthrough: Walkthrough, checklist: string): Work =>
  (facts, change) => {
    const next = start(walkthrough)(facts, change);
    const { startedFrom } = next.asked;
    if (startedFrom.get(walkthrough.id) === checklist) return next;
    return { ...next, asked: { ...next.asked, startedFrom: new Map(startedFrom).set(walkthrough.id, checklist) } };
  };

/** Every completion condition asked before anything is recorded, so one that throws changes nothing. */
export const conditions: Work = (facts, change) => {
  const { context, groups } = facts.given;
  if (context === undefined) return facts;
  const { statuses } = facts.recorded;
  const open = tasksOf(groups).filter((task) => task.isComplete !== undefined && statusIn(statuses, task.id) !== "done");
  if (open.length === 0) return facts;
  const verdicts = change.verdicts(open, context);
  if (verdicts === undefined) return facts;
  let next = facts;
  for (const { id } of open) {
    const met = verdicts.get(id) === true;
    if (statuses[id] !== "reopened") {
      if (met) next = withStatus(next, id, "done");
    } else if (!met) {
      next = withStatus(next, id, undefined);
    }
  }
  return next;
};

const walkthroughStatus = (recorded: Recorded, task: DefinedTask) =>
  task.walkthrough === undefined ? undefined : recorded.progress[task.walkthrough.id]?.status;

/** A Task with no condition is done once its walkthrough finishes; one with a condition waits for it. */
export function finish(before: Facts, after: Facts): Facts {
  const { progress } = after.recorded;
  if (progress === before.recorded.progress && after.asked.startedFrom === before.asked.startedFrom) return after;
  let next = after;
  const moved = progress !== before.recorded.progress;
  for (const task of moved ? tasksOf(after.given.groups) : []) {
    if (task.isComplete !== undefined) continue;
    if (walkthroughStatus(before.recorded, task) === "running" && walkthroughStatus(after.recorded, task) === "finished") {
      next = withStatus(next, task.id, "done");
    }
  }
  const { startedFrom } = next.asked;
  let kept: Map<string, string> | undefined;
  for (const id of startedFrom.keys()) {
    if (progress[id]?.status !== "running") (kept ??= new Map(startedFrom)).delete(id);
  }
  return kept === undefined ? next : { ...next, asked: { ...next.asked, startedFrom: kept } };
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
  before: Recorded,
  after: Recorded,
  credit: (id: string) => string | undefined,
): ChecklistsEvent[] {
  const stopped: ChecklistsEvent[] = [];
  const changed: ChecklistsEvent[] = [];
  const started: ChecklistsEvent[] = [];
  for (const task of tasks) {
    const was = walkthroughStatus(before, task) === "running";
    const is = walkthroughStatus(after, task) === "running";
    const statusWas = statusIn(before.statuses, task.id);
    const statusNow = statusIn(after.statuses, task.id);
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
