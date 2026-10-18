// packages/core/src/run/checklists.ts — about 260 lines.
//
// Owns: task `statuses`, `context`, the Tasks that have reached the Run
// (`groups`, `tasks`, `taskById`), each definition's `View` and `Checklist`,
// `startedFrom`, and what a server render's checklists show.
//
// Everything a checklist shows or announces is decided here. A walkthrough's
// progress is read from `walkthroughs`, never copied, and a Task's walkthrough
// is started and exited through it. Not to be confused with
// `checklists/checklists.ts`, which defines checklists and holds no state.

import { statusIn, EMPTY } from "../checklists/record";
import type { Stored } from "../checklists/record";
import { createStatuses } from "../checklists/statuses";
import { checkConditions, eventsBetween, finishTasks, reopen } from "../checklists/tasks";
import type { Moment } from "../checklists/tasks";
import type {
  AnyTask,
  Checklist,
  ChecklistDefinition,
  ChecklistGroup,
  ChecklistsEvent,
  DefinedTask,
  StorageStatus,
} from "../checklists/types";
import { createView, refresh } from "../checklists/views";
import type { View, ViewSource } from "../checklists/views";
import type { Queue } from "../queue";
import { listen } from "../subscribe";
import type { Change, Durable, MakeChange } from "./change";
import type { Storage } from "./storage";
import type { Walkthroughs } from "./walkthroughs";

export type RunChecklists = Readonly<{
  // The Run's own methods, wired onto `Run` as they are.

  /** A checklist's live state and commands. The same object each time for one definition. */
  checklist: (definition: ChecklistDefinition<AnyTask>) => Checklist<AnyTask>;
  /** As a popover's Skip: names the checklist whose Start began the walkthrough. */
  skipTask: (id: string) => void;
  /** Not held while loading: only the latest context matters, and it is checked once the record is in. */
  setContext: (context: unknown) => void;

  // Reads.

  /** A new object only after a write that changed it, so identity says what to save. */
  statuses: () => Stored;
  /** The Task a walkthrough guides, once a checklist holding it has reached the Run. */
  taskOf: (walkthrough: string) => string | null;

  // The pipeline's steps. Only `commit` calls them.

  /**
   * After `walkthroughs.settle`, before the change's `after` moment is taken: a
   * Task with no condition is done once its walkthrough finishes, and a
   * walkthrough no longer running forgets the checklist that started it.
   */
  settle: (change: Change, before: Moment) => void;
  /** Every view's snapshot brought up to date, after the Run's and before any callback runs. */
  refresh: () => Refreshed;

  // Starting.

  /** What a server render's checklists show: the Run as it is now, before the adapter is read. Once, by `createRun`. */
  captureServer: () => void;

  /** Its part of the record: `tasks`. */
  record: Durable;
}>;

/** The checklists' part of one change, from their snapshots being brought up to date to their events. */
export type Refreshed = Readonly<{
  /** The listeners of each view that changed. */
  notify: () => void;
  /** As `ChecklistsEvent` orders them: each Task that moved, then each checklist just complete. */
  events: (before: Moment, after: Moment, credits: ReadonlyMap<string, string>) => readonly ChecklistsEvent[];
}>;

/** What checklists are drawn from. */
type Seen = Moment & Readonly<{ open: string | undefined; storageStatus: StorageStatus }>;

export function createChecklists({
  walkthroughs,
  storage,
  make,
  queue,
  context: initialContext,
}: Readonly<{
  walkthroughs: Pick<Walkthroughs, "take" | "start" | "act" | "arrive" | "progress" | "open">;
  storage: Pick<Storage, "status" | "later">;
  make: MakeChange;
  queue: Queue;
  context: unknown;
}>): RunChecklists {
  const statuses = createStatuses();
  let context = initialContext;
  const groups = new Set<ChecklistGroup>();
  /** Every Task of the checklists that have reached the Run, the first definition of each id. */
  const tasks: DefinedTask[] = [];
  const taskById = new Map<string, DefinedTask>();
  const views = new Map<ChecklistDefinition<AnyTask>, View<AnyTask>>();
  const made = new Map<ChecklistDefinition<AnyTask>, Checklist<AnyTask>>();
  /** The checklist whose Start began each running walkthrough, by its id, so a skip from its popover names it. */
  const startedFrom = new Map<string, string>();

  const seen = (): Seen => ({
    statuses: statuses.record(),
    progress: walkthroughs.progress(),
    open: walkthroughs.open()?.walkthrough.id,
    storageStatus: storage.status(),
  });
  /** Taken by `captureServer`. No view is made before then: views are made as checklists are used, after `createRun` returns. */
  let server: Seen = seen();

  const sourceFor = (definition: ChecklistDefinition<AnyTask>, now: () => Seen): ViewSource => {
    // TODO: as `sourceFor` today.
    throw new Error("not implemented");
  };

  const viewOf = (definition: ChecklistDefinition<AnyTask>): View<AnyTask> => {
    // TODO: as today: createView(name, tasks, sourceFor(definition, seen), sourceFor(definition, () => server)), kept per definition.
    throw new Error("not implemented");
  };

  const conditions = (change: Change): void => {
    // TODO: if (context !== undefined) checkConditions(tasks, statuses, context, (error) => queue.fail("isComplete", error));
    throw new Error("not implemented");
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup): void => {
    // TODO: as today:
    // if (groups.has(group)) return;
    // const taken = group.tasks.flatMap((task) => (task.walkthrough === undefined ? [] : [walkthroughs.take(task.walkthrough)]));
    // groups.add(group); register each Task id not yet in `taskById`; viewOf each of group.checklists;
    // // Silent: a checklist reaching the Run must not announce what the user did before.
    // if (storage.status() !== "loading") make((change) => { walkthroughs.arrive(change, taken); conditions(change); }, { silent: true });
    throw new Error("not implemented");
  };

  // Each Task command, inside a change. Credit goes to the checklist the command came from.

  const skip = (change: Change, id: string, from: string | undefined): void => {
    // TODO: as `skip` today:
    // const task = taskById.get(id);
    // if (task === undefined || statuses.status(id) !== "todo") return;
    // statuses.set(id, "skipped");
    // // `take` hands back the Run's definition for the id, which `join` has already taken.
    // const walkthrough = task.walkthrough === undefined ? undefined : walkthroughs.take(task.walkthrough);
    // const credit = from ?? (walkthrough === undefined ? undefined : startedFrom.get(walkthrough.id));
    // if (credit !== undefined) change.credit(id, credit);
    // if (walkthrough !== undefined) walkthroughs.act(change, walkthrough, "exit");
    throw new Error("not implemented");
  };

  const toggle = (change: Change, id: string, from: string): void => {
    // TODO: as today: todo → done, otherwise reopen(task, statuses); change.credit(id, from).
    throw new Error("not implemented");
  };

  const markTodo = (change: Change, id: string, from: string): void => {
    // TODO: as today: reopen(task, statuses); change.credit(id, from).
    throw new Error("not implemented");
  };

  const markDone = (_change: Change, id: string): void => {
    // TODO: if (taskById.has(id)) statuses.set(id, "done");
    throw new Error("not implemented");
  };

  const checklistOf = (definition: ChecklistDefinition<AnyTask>): Checklist<AnyTask> => {
    // TODO: as today, kept per definition in `made`:
    // const view = viewOf(definition); const { name, group } = definition;
    // /** Every Task command: the checklist joins, then the command waits for the record and makes one change. */
    // const command = (work: (change: Change, id: string) => void) => (id: string) => {
    //   join(group);
    //   storage.later(() => make((change) => work(change, id)));
    // };
    // return {
    //   getSnapshot: () => view.snapshot,
    //   getServerSnapshot: () => view.serverSnapshot,
    //   subscribe: (listener) => { join(group); return listen(queue, view.listeners, () => view.snapshot)(listener); },
    //   // Taken before it is held, so a second definition under its id throws where it was handed over.
    //   start: (id) => {
    //     join(group);
    //     const walkthrough = taskById.get(id)?.walkthrough; if (walkthrough === undefined) return;
    //     const taken = walkthroughs.take(walkthrough);
    //     storage.later(() => make((change) => { walkthroughs.start(change, taken); startedFrom.set(taken.id, name); }));
    //   },
    //   markDone: command(markDone),
    //   markTodo: command((change, id) => markTodo(change, id, name)),
    //   skip: command((change, id) => skip(change, id, name)),
    //   toggle: command((change, id) => toggle(change, id, name)),
    // };
    throw new Error("not implemented");
  };

  return {
    checklist: checklistOf,
    skipTask: (id) => {
      // TODO: storage.later(() => make((change) => skip(change, id, undefined)));
      throw new Error("not implemented");
    },
    setContext: (next) => {
      // TODO: as today:
      // if (Object.is(next, context)) return;
      // context = next;
      // if (storage.status() !== "loading") make(conditions);
      throw new Error("not implemented");
    },
    statuses: () => statuses.record(),
    taskOf: (walkthrough) => {
      // TODO: tasks.find((task) => task.walkthrough?.id === walkthrough)?.id ?? null
      throw new Error("not implemented");
    },
    settle: (_change, before) => {
      // TODO:
      // const progress = walkthroughs.progress();
      // finishTasks(tasks, before, { statuses: statuses.record(), progress }, statuses);
      // for (const id of startedFrom.keys()) if (progress[id]?.status !== "running") startedFrom.delete(id);
      throw new Error("not implemented");
    },
    refresh: () => {
      // TODO:
      // const { changed, completed } = refresh(views.values());
      // return {
      //   notify: () => { for (const view of changed) queue.notify(view.listeners, view.snapshot); },
      //   events: (before, after, credits) => [
      //     ...eventsBetween(tasks, before, after, (id) => credits.get(id)),
      //     ...completed.map((view) => ({ type: "checklistComplete", checklist: view.name, snapshot: view.snapshot })),
      //   ],
      // };
      throw new Error("not implemented");
    },
    captureServer: () => {
      server = seen();
    },
    record: {
      restore: (_change, read) => {
        // TODO: statuses.replace(read?.tasks ?? EMPTY);
        throw new Error("not implemented");
      },
      hear: (_change, read) => {
        // TODO: statuses take a record heard whole: statuses.replace(read?.tasks ?? EMPTY);
        throw new Error("not implemented");
      },
      check: (change, _after) => {
        // TODO: conditions(change), after a load or a hear alike.
        throw new Error("not implemented");
      },
    },
  };
}
