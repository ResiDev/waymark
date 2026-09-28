import type { Exactly } from "../exact";
import type { Run, RunOptions, Snapshot, UiElements } from "../run/types";
import type { ExactStep, Step, Walkthrough } from "../walkthrough/types";
import type { Stored } from "./record";
import type { StoredRecord } from "./storage";

/**
 * A Task written away from `createChecklists` has no context type. Give it one
 * with `satisfies Task<AppContext>`, which also keeps the written shape for
 * step inference; `as const satisfies` keeps literal types inside `meta` too.
 */
export type Task<TContext, TStep extends Step = Step> = Readonly<{
  walkthrough?: Walkthrough<TStep> | readonly TStep[];
  /** Must be pure. Without one, finishing the walkthrough records the Task done. */
  isComplete?: (context: TContext) => boolean;
  meta?: unknown;
}>;

export type TaskMap<TContext> = Readonly<Record<string, Task<TContext>>>;
export type TaskId<TTasks> = keyof TTasks & string;

export type ChecklistSelections<TTasks> = Readonly<
  Record<string, readonly TaskId<TTasks>[]>
>;

export const DEFAULT_CHECKLIST = "main";

export type DefaultChecklists<TTasks> = Readonly<{
  [DEFAULT_CHECKLIST]: readonly TaskId<TTasks>[];
}>;

export type StepOf<TTask> = TTask extends unknown
  ? "walkthrough" extends keyof TTask
    ? StepsOf<NonNullable<TTask["walkthrough"]>>
    : never
  : never;

type StepsOf<TWalkthrough> =
  TWalkthrough extends Walkthrough<infer TStep>
    ? TStep
    : TWalkthrough extends readonly (infer TStep)[]
      ? AsStep<TStep>
      : never;

/**
 * A Step type sharing no key with core's all-optional Step, such as
 * `{ content }`, fails TypeScript's weak type check and does not extend it.
 * Intersecting keeps it instead of losing it.
 */
type AsStep<TStep> = TStep extends Step ? TStep : TStep & Step;

export type NamedTask<TTasks, TId extends TaskId<TTasks> = TaskId<TTasks>> = {
  [K in TId]: Readonly<TTasks[K] & { id: K }>;
}[TId];

export type SelectedTask<
  TTasks,
  TIds extends readonly TaskId<TTasks>[],
> = NamedTask<TTasks, TIds[number]>;

export type TaskStatus = "todo" | "done" | "skipped";

export type ChecklistRow<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  status: TaskStatus;
}>;

export type ActiveTask<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  run: Run<StepOf<TTask>>;
}>;

/** A new object only when something in it changed. */
export type ChecklistSnapshot<TTask extends { readonly id: string }> =
  Readonly<{
    tasks: readonly ChecklistRow<TTask>[];
    /** Done plus skipped. */
    finishedCount: number;
    taskCount: number;
    complete: boolean;
    /** Null while the active Task is not in this checklist. */
    active: ActiveTask<TTask> | null;
  }>;

export type TaskCommands<TId extends string> = Readonly<{
  /** Exits any other Run. No-op if the Task is already active or has no walkthrough. */
  start: (id: TId) => void;
  markDone: (id: TId) => void;
  /** Only from todo. Exits the Task's Run if it is active. */
  skip: (id: TId) => void;
  /**
   * Todo to done; done or skipped back to todo. A Task with a condition, taken
   * back from done, stays todo until the condition has been false.
   */
  toggle: (id: TId) => void;
}>;

export type Checklist<TTask extends { readonly id: string }> = TaskCommands<
  TTask["id"]
> &
  Readonly<{
    getSnapshot: () => ChecklistSnapshot<TTask>;
    /** Calls the listener at once, then on each change. */
    subscribe: (listener: (snapshot: ChecklistSnapshot<TTask>) => void) => () => void;
  }>;

/**
 * Once per change, not once per view, in this order: `taskStopped`, each Task
 * whose status changed in task map order, `taskStarted`, then
 * `checklistComplete` for each view that just became complete.
 */
export type ChecklistsEvent<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> =
  | Readonly<{ type: "taskStarted"; task: NamedTask<TTasks> }>
  | Readonly<{ type: "taskComplete"; task: NamedTask<TTasks> }>
  | Readonly<{ type: "taskReopened"; task: NamedTask<TTasks> }>
  | Readonly<{
      type: "taskStopped";
      task: NamedTask<TTasks>;
      /** `stopped` covers exit, `stop()` and starting another Task. */
      reason: "finished" | "skipped" | "stopped";
    }>
  | Readonly<{
      type: "taskSkipped";
      task: NamedTask<TTasks>;
      /**
       * A skip from guidance names the view whose `start` began it, so a
       * guidance renderer's Skip counts where the user started.
       */
      checklist?: keyof TSelections & string;
    }>
  | Readonly<{
      type: "taskUnskipped";
      task: NamedTask<TTasks>;
      checklist?: keyof TSelections & string;
    }>
  | Readonly<{
      type: "checklistComplete";
      checklist: keyof TSelections & string;
      snapshot: ChecklistSnapshot<NamedTask<TTasks>>;
    }>;

export type ChecklistsOptions<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Persistence &
  Readonly<{
    onChange?: (stored: Stored) => void;
    onEvent?: (event: ChecklistsEvent<TTasks, TSelections>) => void;
    /** Your `onEvent` is called after the owner has handled the event. */
    run?: Omit<RunOptions<StepOf<TTasks[keyof TTasks]>>, "startAt" | "ui">;
  }>;

type Persistence =
  | Readonly<{
      stored?: Stored;
      storage?: never;
    }>
  | Readonly<{
      /** Loaded once at creation, saved after each change. `load()` does not save; `clear()` does. */
      storage: StoredRecord;
      stored?: never;
    }>;

export type ChecklistViews<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = {
  readonly [Name in keyof TSelections]: Checklist<
    SelectedTask<TTasks, TSelections[Name]>
  >;
};

export type ChecklistsSnapshot<TTasks> = Readonly<{
  active: ActiveTask<NamedTask<TTasks>> | null;
}>;

export type ActiveSnapshot<TTasks> = Readonly<{
  active: ChecklistsSnapshot<TTasks>["active"];
  step: Snapshot<StepOf<TTasks[keyof TTasks]>> | null;
}>;

export type Checklists<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  checklists: ChecklistViews<TTasks, TSelections>;

  /** Exits any other Run. No-op if the Task is already active or has no walkthrough. */
  start: (id: TaskId<TTasks>) => void;
  stop: () => void;
  markDone: (id: TaskId<TTasks>) => void;
  /**
   * Done or skipped back to todo. A Task with a condition, taken back from
   * done, stays todo until the condition has been false.
   */
  markTodo: (id: TaskId<TTasks>) => void;
  /** Only from todo. Exits the Task's Run if it is active. */
  skip: (id: TaskId<TTasks>) => void;

  /**
   * The guidance renderer's elements, so clicks on them do not collapse the
   * Run. The newest binding wins.
   */
  bindUi: (ui: () => UiElements) => () => void;
  waymarkPadding: number;

  getSnapshot: () => ChecklistsSnapshot<TTasks>;
  /** Calls the listener at once, then on each change. */
  subscribe: (
    listener: (snapshot: ChecklistsSnapshot<TTasks>) => void,
  ) => () => void;
  /**
   * Use this, not `subscribe`, to draw guidance. A Run watches the page only
   * while subscribed, so one read through `subscribe` alone never finds its
   * Waymark or hears its clicks.
   */
  subscribeActive: (
    listener: (snapshot: ActiveSnapshot<TTasks>) => void,
  ) => () => void;

  /** A condition that holds completes a skipped Task too. */
  update: (context: TContext) => void;
  /** No `onChange`, no events. */
  load: (stored: Stored) => void;
  /** Also removes unknown ids. Calls `onChange` but emits no events, and keeps the active Run. */
  clear: () => void;
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
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
  TShape = Task<TContext>,
  TStepShape extends Step = Step,
> = Readonly<{
  /** Its type is the context every condition receives. */
  context?: TContext;
  tasks: TTasks & ExactTasks<TTasks, TShape, TStepShape>;
  /** Omit for one checklist, `main`, of every Task. */
  checklists?: TSelections;
}> &
  ChecklistsOptions<TTasks, TSelections>;
