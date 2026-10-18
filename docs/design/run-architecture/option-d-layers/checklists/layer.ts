import type { Host, Layer, Moment, Ports, Slice, Tx, Write } from "../run/layer";
import { notice } from "../run/layer";
import type { Run, WaymarkEvent } from "../run/types";
import type { Read } from "../storage/records";
import { statusIn } from "./record";
import type { Stored } from "./record";
import { statusesIn } from "./statuses";
import { checkConditions, eventsBetween, finishTasks, reopen } from "./tasks";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup, DefinedTask } from "./types";
import { createView, refresh } from "./views";
import type { View, ViewSource } from "./views";

/*
 * The checklists layer: Tasks, their statuses, checklist views, completion
 * conditions and checklist events. Statuses are its slice of the record,
 * `tasks`; it sees each change as the record before and after, never as a
 * list of what happened, so a new way for a walkthrough to move needs nothing
 * here. About 220 lines once filled in.
 */

/** What the checklists layer reads of the core and asks of it. */
export type ChecklistHost = Pick<
  Host<Read>,
  "change" | "later" | "slice" | "moment" | "server" | "take" | "definition" | "start" | "act" | "arrive" | "fail" | "listen"
>;

export type ChecklistLayer = Readonly<{
  layer: Layer<Read>;
  /** The `taskOf` port: the first Task, in the order they reached the Run, whose walkthrough this is. */
  taskOf: Ports["taskOf"];
  checklist: Run["checklist"];
  setContext: Run["setContext"];
  skipTask: Run["skipTask"];
}>;

export function createChecklistLayer(host: ChecklistHost, options: Readonly<{ context: unknown }>): ChecklistLayer {
  let context = options.context;
  const groups = new Set<ChecklistGroup>();
  /** Every Task of the checklists that have reached the Run, the first definition of each id. */
  const tasks: DefinedTask[] = [];
  const taskById = new Map<string, DefinedTask>();
  const views = new Map<ChecklistDefinition<AnyTask>, View<AnyTask>>();
  const checklists = new Map<ChecklistDefinition<AnyTask>, Checklist<AnyTask>>();
  /** The checklist whose Start began each running walkthrough, by its id, so a skip from its popover names it. */
  const startedFrom = new Map<string, string>();
  /** The checklist each Task's status was changed from in the running change, for its event. */
  let credits = new Map<string, string>();

  /** Every condition is checked before anything is recorded, so a throwing check changes nothing. */
  const conditions = (write: Write) => {
    if (context !== undefined) {
      checkConditions(tasks, statusesIn(statuses, write), context, (error) => host.fail("isComplete", error));
    }
  };

  // Statuses take a record from outside whole; a Task held done by its condition stays done, though the record lacks it.
  const statuses: Slice<Stored> = host.slice("tasks", {
    restore: (write, stored) => write.set(statuses, stored),
    hear: (write, heard) => write.set(statuses, heard),
    reconcile: (write) => conditions(write),
  });

  const layer: Layer<Read> = {
    begin: () => {
      credits = new Map();
    },
    settle: ({ before, now }, write) => {
      // A Task with no condition is done once its walkthrough finishes. Before any snapshot, so every view shows it.
      finishTasks(tasks, before.saved, now.saved, statusesIn(statuses, write));
      for (const id of startedFrom.keys()) {
        if (now.saved.walkthroughs[id]?.status !== "running") startedFrom.delete(id);
      }
    },
    publish: ({ before, after }) => {
      // A view that did not change keeps its snapshot, so identity means "nothing to redraw".
      const refreshed = refresh(views.values());
      const credited = credits;
      return {
        notices: refreshed.changed.map((view) => notice(view.listeners, view.snapshot)),
        events: (): WaymarkEvent[] => [
          ...eventsBetween(tasks, before.saved, after.saved, (id) => credited.get(id)),
          ...refreshed.completed.map(
            (view): WaymarkEvent => ({ type: "checklistComplete", checklist: view.name, snapshot: view.snapshot }),
          ),
        ],
      };
    },
  };

  const credit = (id: string, from: string | undefined) => {
    if (from !== undefined) credits.set(id, from);
  };

  /** Only from todo. Exits the Task's walkthrough, crediting the checklist whose Start began it when no other is named. */
  const skip = (tx: Tx, id: string, from: string | undefined) => {
    const task = taskById.get(id);
    if (task === undefined || statusIn(statuses.get(), id) !== "todo") return;
    statusesIn(statuses, tx).set(id, "skipped");
    const walkthrough = task.walkthrough === undefined ? undefined : host.definition(task.walkthrough.id);
    credit(id, from ?? (walkthrough === undefined ? undefined : startedFrom.get(walkthrough.id)));
    if (walkthrough !== undefined) host.act(tx, walkthrough, "exit");
  };

  const toggle = (tx: Tx, id: string, from: string) => {
    // TODO: as today: todo to done, otherwise reopen(task, statusesIn(statuses, tx)); credit(id, from).
    throw new Error("not implemented");
  };

  const markTodo = (tx: Tx, id: string, from: string) => {
    // TODO: as today: reopen(task, statusesIn(statuses, tx)); credit(id, from).
    throw new Error("not implemented");
  };

  /** Each by Task id, read from `now`: the live moment, or the server's. */
  const sourceFor = (definition: ChecklistDefinition<AnyTask>, now: () => Moment<Read>): ViewSource => {
    // TODO: as run.ts's `sourceFor` today, with now().saved.tasks, now().saved.walkthroughs, now().open, now().recordStatus.
    throw new Error("not implemented");
  };

  const viewOf = (definition: ChecklistDefinition<AnyTask>): View<AnyTask> => {
    // TODO: as today: createView(name, tasks, sourceFor(definition, host.moment), sourceFor(definition, host.server)).
    throw new Error("not implemented");
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    // TODO: as today: take each walkthrough, add the Tasks, make the views; then, unless the record is loading,
    // host.change((tx) => { for (const walkthrough of taken) host.arrive(tx, walkthrough); conditions(tx); }, { silent: true }).
    // Silent: a checklist reaching the Run must not announce what the user did before.
    throw new Error("not implemented");
  };

  const checklistOf = (definition: ChecklistDefinition<AnyTask>): Checklist<AnyTask> => {
    // TODO: as today. Each command: join(group); host.later(() => host.change((tx) => work(tx, id))).
    // `start`: join; taken = host.take(walkthrough);
    //   host.later(() => host.change((tx) => { host.start(tx, taken); startedFrom.set(taken.id, name); })).
    // `subscribe`: join; host.listen(view.listeners, () => view.snapshot)(listener).
    throw new Error("not implemented");
  };

  return {
    layer,
    taskOf: (walkthroughId) => tasks.find((task) => task.walkthrough?.id === walkthroughId)?.id ?? null,
    checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      checklistOf(definition) as Checklist<TTask>,
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (host.moment().recordStatus !== "loading") host.change(conditions);
    },
    skipTask: (id) => host.later(() => host.change((tx) => skip(tx, id, undefined))),
  };
}
