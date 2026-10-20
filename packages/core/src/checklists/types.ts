import type { Exactly } from "../exact";
import type { ExactStep, Step, Walkthrough } from "../walkthrough/types";

/**
 * A Task's condition reads the context the app gives the Run, whose type the
 * Run cannot know: type it on the condition, `(context: AppContext) => …`. A
 * Task written away from `defineChecklists` gets it from
 * `satisfies Task<AppContext>`, which also keeps the written shape for step
 * inference; `as const satisfies` keeps literal types inside `meta` too.
 */
export type Task<TContext = unknown, TStep extends Step = Step> = Readonly<{
  /** A walkthrough, or its steps inline, which become a walkthrough with the Task's id. */
  walkthrough?: Walkthrough<TStep> | readonly TStep[];
  /**
   * Must be pure. Without one, finishing the walkthrough records the Task done.
   * A method, so a condition on any context fits a Task of unknown context.
   */
  isComplete?: { check(this: void, context: TContext): boolean }["check"];
  meta?: unknown;
}>;

export type TaskMap = Readonly<Record<string, Task>>;
export type TaskId<TTasks> = keyof TTasks & string;

export type ChecklistSelections<TTasks> = Readonly<
  Record<string, readonly TaskId<TTasks>[]>
>;

export const DEFAULT_CHECKLIST = "main";

export type DefaultChecklists<TTasks> = Readonly<{
  [DEFAULT_CHECKLIST]: readonly TaskId<TTasks>[];
}>;

export type NamedTask<TTasks, TId extends TaskId<TTasks> = TaskId<TTasks>> = {
  [K in TId]: Readonly<TTasks[K] & { id: K }>;
}[TId];

export type SelectedTask<
  TTasks,
  TIds extends readonly TaskId<TTasks>[],
> = NamedTask<TTasks, TIds[number]>;

/** Any Task as written, named by its id, as events hand it back. */
export type AnyTask = Readonly<{ id: string; meta?: unknown }>;

export type TaskStatus = "todo" | "done" | "skipped";

/**
 * Of the stored record: `error` when storage failed, and `unreadable` when it
 * holds a record this Waymark cannot read. In both, every Task starts todo.
 */
export type StorageStatus = "loading" | "ready" | "error" | "unreadable";

export type ChecklistRow<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  status: TaskStatus;
  /** Its walkthrough is collapsed part way: set aside, with a beacon to go back to it. */
  inProgress: boolean;
}>;

/** A new object only when something in it changed. */
export type ChecklistSnapshot<TTask extends { readonly id: string }> =
  Readonly<{
    tasks: readonly ChecklistRow<TTask>[];
    /** Done plus skipped. */
    finishedCount: number;
    taskCount: number;
    complete: boolean;
    /** The Task whose walkthrough is open, while it is in this checklist. */
    open: TTask | null;
    /** While `loading`, every Task shows todo. */
    storageStatus: StorageStatus;
  }>;

export type TaskCommands<TId extends string> = Readonly<{
  /**
   * Shows the Task's walkthrough as `run.start` does, setting aside an open
   * one: part way through, where it was; otherwise from its first step. No-op
   * if the Task has no walkthrough.
   */
  start: (id: TId) => void;
  markDone: (id: TId) => void;
  /**
   * Done or skipped back to todo. A Task with a condition, taken back from
   * done, stays todo until the condition has been false.
   */
  markTodo: (id: TId) => void;
  /** Only from todo. Exits the Task's walkthrough if it is running. */
  skip: (id: TId) => void;
  /** Todo to done; done or skipped back to todo, as `markTodo` does. */
  toggle: (id: TId) => void;
}>;

/** A checklist's live state, from a Run's `checklist`. */
export type Checklist<TTask extends { readonly id: string }> = TaskCommands<
  TTask["id"]
> &
  Readonly<{
    getSnapshot: () => ChecklistSnapshot<TTask>;
    /**
     * The snapshot from before storage was read, for a server render and the
     * hydration after it, which cannot see the browser's storage.
     */
    getServerSnapshot: () => ChecklistSnapshot<TTask>;
    /** Calls the listener at once, then on each change. */
    subscribe: (listener: (snapshot: ChecklistSnapshot<TTask>) => void) => () => void;
  }>;

/**
 * Once per change, in this order: `taskStopped`, each Task whose status
 * changed in task order, `taskStarted`, then `checklistComplete` for each
 * checklist that just became complete. They follow the walkthroughs' events.
 */
export type ChecklistsEvent =
  /** Its walkthrough started, from its first step. */
  | Readonly<{ type: "taskStarted"; task: AnyTask }>
  | Readonly<{ type: "taskComplete"; task: AnyTask }>
  | Readonly<{ type: "taskReopened"; task: AnyTask }>
  | Readonly<{
      type: "taskStopped";
      task: AnyTask;
      /** Its walkthrough ended: finished, exited as the Task was skipped, or otherwise exited or reset. */
      reason: "finished" | "skipped" | "stopped";
    }>
  | Readonly<{
      type: "taskSkipped";
      task: AnyTask;
      /**
       * The checklist it was skipped from. A skip from the walkthrough's own
       * popover names the checklist whose `start` began it.
       */
      checklist?: string;
    }>
  | Readonly<{ type: "taskUnskipped"; task: AnyTask; checklist?: string }>
  | Readonly<{ type: "checklistComplete"; checklist: string; snapshot: ChecklistSnapshot<AnyTask> }>;

/** A Task as the Run uses it. */
export type DefinedTask = Readonly<{
  id: string;
  /** As written, handed back in snapshots and events. */
  task: AnyTask;
  walkthrough: Walkthrough | undefined;
  isComplete: ((context: unknown) => boolean) | undefined;
}>;

/** Every Task and checklist defined together. A Run takes them in whole the first time one of the checklists is used. */
export type ChecklistGroup = Readonly<{
  tasks: readonly DefinedTask[];
  checklists: readonly ChecklistDefinition<AnyTask>[];
}>;

/** One checklist, from `defineChecklists`. It holds no state: pass it to a Run's `checklist`. */
export type ChecklistDefinition<TTask extends { readonly id: string }> = Readonly<{
  name: string;
  tasks: readonly TTask[];
  group: ChecklistGroup;
}>;

export type ChecklistsDefinition<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  checklists: {
    readonly [Name in keyof TSelections]: ChecklistDefinition<SelectedTask<TTasks, TSelections[Name]>>;
  };
}>;

/** Inline Steps are checked here because no `defineWalkthrough` call checks them. */
export type ExactTasks<TTasks, TShape, TStepShape extends Step = Step> = {
  readonly [K in keyof TTasks]: Exactly<TTasks[K], TShape> &
    ExactInlineSteps<TTasks[K], TStepShape>;
};

// Inferred as `object`, not `Step`: a Step sharing no key with core's
// all-optional Step fails the weak type check and would slip past.
type ExactInlineSteps<TTask, TStepShape extends Step> = TTask extends {
  readonly walkthrough: readonly (infer TStep extends object)[];
}
  ? {
      readonly walkthrough: readonly TStepShape[] &
        readonly ExactStep<TStep, TStepShape>[];
    }
  : unknown;

/** `TShape` lets an adapter allow its own Task fields, such as a title. */
export type ChecklistsConfig<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
  TShape = Task,
  TStepShape extends Step = Step,
> = Readonly<{
  tasks: TTasks & ExactTasks<TTasks, TShape, TStepShape>;
  /** Omit for one checklist, `main`, of every Task. */
  checklists?: TSelections;
}>;
