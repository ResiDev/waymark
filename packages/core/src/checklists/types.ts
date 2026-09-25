import type { Exactly } from "../exact";
import type { Run, RunOptions, Snapshot, UiElements } from "../run/types";
import type { ExactStep, Step, Walkthrough } from "../walkthrough/types";
import type { Stored } from "./record";
import type { StoredRecord } from "./storage";

/**
 * The shape of Checklists: what an application writes (Tasks, selections,
 * config) and what the owner and its views hand back. `createChecklists` is
 * in checklists.ts.
 */

// ---- Tasks and selections --------------------------------------------------

/**
 * One objective. TContext types the application data its completion condition
 * reads; TStep types its walkthrough's instructions. Map keys supply ids.
 */
export type Task<TContext, TStep extends Step = Step> = Readonly<{
  // A Task declared away from `createChecklists` has no context type unless
  // something supplies it. `satisfies` does, keeps the written shape for step
  // inference, and rejects a misspelled field with the compiler's own message:
  //
  //   export type AppContext = typeof initialContext;
  //   export const addPhoto = { walkthrough, isComplete: (c) => c.hasPhoto } satisfies Task<AppContext>;
  //
  // `as const satisfies` keeps literal types inside `meta` too.
  /**
   * The Steps themselves, or a Walkthrough built with `defineWalkthrough` to
   * share between Tasks. Either way the owner checks them at creation.
   */
  walkthrough?: Walkthrough<TStep> | readonly TStep[];
  /**
   * Pure, synchronous. `update(context)` evaluates it and records completion.
   * Without it, finishing the walkthrough records done, and the application
   * may still call `markDone`.
   */
  isComplete?: (context: TContext) => boolean;
  /** The application's own data for this Task. Core keeps it in snapshots and ignores it. */
  meta?: unknown;
}>;

export type TaskMap<TContext> = Readonly<Record<string, Task<TContext>>>;
export type TaskId<TTasks> = keyof TTasks & string;

/** Each checklist name maps to task ids in display order. */
export type ChecklistSelections<TTasks> = Readonly<
  Record<string, readonly TaskId<TTasks>[]>
>;

/**
 * The name of the one checklist an owner has when it names none. Skips are
 * stored under a checklist's name, so this can never change.
 */
export const DEFAULT_CHECKLIST = "main";

/** The checklists an owner has when it names none: one of every Task, in task map order. */
export type DefaultChecklists<TTasks> = Readonly<{
  [DEFAULT_CHECKLIST]: readonly TaskId<TTasks>[];
}>;

/** The step type carried by a Task's walkthrough, however written; never for a Task without one. */
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
 * Each inline Step, typed as a Step. An adapter's Step that shares no key
 * with core's all-optional one, such as `{ content }`, does not extend it;
 * it gains core's optional fields rather than being lost.
 */
type AsStep<TStep> = TStep extends Step ? TStep : TStep & Step;

/** A Task as views and events see it: its own fields plus its map key. */
export type NamedTask<TTasks, TId extends TaskId<TTasks> = TaskId<TTasks>> = {
  [K in TId]: Readonly<TTasks[K] & { id: K }>;
}[TId];

/** The checklists whose selection includes the Task `TId`; for a union, every member of it. */
export type ChecklistsWith<TSelections, TId> = {
  [Name in keyof TSelections]: TSelections[Name] extends readonly (infer TSelected)[]
    ? [TId] extends [TSelected]
      ? Name
      : never
    : never;
}[keyof TSelections] &
  string;

/** Exactly the Task types one selection names. */
export type SelectedTask<
  TTasks,
  TIds extends readonly TaskId<TTasks>[],
> = NamedTask<TTasks, TIds[number]>;


// ---- Status and snapshots --------------------------------------------------

/** Remaining, accomplished, or deliberately skipped. Active guidance is separate. */
export type TaskStatus = "todo" | "done" | "skipped";

export type ChecklistRow<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  status: TaskStatus;
}>;

export type ActiveTask<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  run: Run<StepOf<TTask>>;
  /** The checklists the Run counts for: where a skip from its guidance applies. */
  checklists: readonly string[];
}>;

/** Current display data for one view. A new object only when something in it changed. */
export type ChecklistSnapshot<TTask extends { readonly id: string }> =
  Readonly<{
    tasks: readonly ChecklistRow<TTask>[];
    /** Done plus skipped in this checklist. */
    finishedCount: number;
    taskCount: number;
    complete: boolean;
    /** The shared active Run, only while its Task belongs to this checklist. */
    active: ActiveTask<TTask> | null;
  }>;

export type TaskCommands<TId extends string> = Readonly<{
  /**
   * Starts or replays guidance counting for this checklist; exits any previous
   * Run. If the Task is already active, its Run counts for this checklist too.
   * No-op without a walkthrough.
   */
  start: (id: TId) => void;
  /** Records done in every view; guidance can continue. */
  markDone: (id: TId) => void;
  /** Todo to skipped in this checklist only; exits this Task's active Run. */
  skip: (id: TId) => void;
  /**
   * What ticking the Task's box means: todo to done in every view, done back
   * to todo in every view, skipped back to todo in this checklist only. A
   * Task with a condition, taken back from done, is not completed by the
   * condition again until it has been false.
   */
  toggle: (id: TId) => void;
}>;

/** A framework-neutral live view. Owns neither storage nor application context. */
export type Checklist<TTask extends { readonly id: string }> = TaskCommands<
  TTask["id"]
> &
  Readonly<{
    getSnapshot: () => ChecklistSnapshot<TTask>;
    /** Calls the listener at once with the current snapshot, then with each new one. */
    subscribe: (listener: (snapshot: ChecklistSnapshot<TTask>) => void) => () => void;
  }>;

// ---- Shared owner ----------------------------------------------------------

/**
 * Once per shared transition, not once per view. `taskStarted` and
 * `taskStopped` describe Runs, never application actions. Within one change,
 * task events come first, then `checklistComplete` for each view that just
 * became complete, in declaration order.
 */
export type ChecklistsEvent<
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> =
  | Readonly<{ type: "taskStarted"; task: NamedTask<TTasks> }>
  | Readonly<{ type: "taskComplete"; task: NamedTask<TTasks> }>
  /** Taken back from done, in every view. */
  | Readonly<{ type: "taskReopened"; task: NamedTask<TTasks> }>
  | Readonly<{
      type: "taskStopped";
      task: NamedTask<TTasks>;
      /** finished: reached the last step. skipped: a view or `skipActive` skipped it. stopped: exit, `stop()`, or another `start()`. */
      reason: "finished" | "skipped" | "stopped";
    }>
  | Readonly<{
      type: "taskSkipped";
      task: NamedTask<TTasks>;
      checklist: keyof TSelections & string;
    }>
  | Readonly<{
      type: "taskUnskipped";
      task: NamedTask<TTasks>;
      checklist: keyof TSelections & string;
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
    /** The whole record after each local change. */
    onChange?: (stored: Stored) => void;
    onEvent?: (event: ChecklistsEvent<TTasks, TSelections>) => void;
    /**
     * Options for every Run the owner creates. Core supplies `startAt` and `ui`
     * itself and wraps `onEvent`: it handles finish and exit first, then calls yours.
     */
    run?: Omit<RunOptions<StepOf<TTasks[keyof TTasks]>>, "startAt" | "ui">;
  }>;

/** Where progress starts from, and whether core saves it: one or the other. */
type Persistence =
  | Readonly<{
      /** Starts empty if omitted. */
      stored?: Stored;
      storage?: never;
    }>
  | Readonly<{
      /**
       * Loaded once at creation and saved after each local change, before
       * `onChange`. `load` never saves; `clear` does.
       */
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

export type ChecklistsSnapshot<
  TTasks,
  TSelections extends ChecklistSelections<TTasks> = ChecklistSelections<TTasks>,
> = Readonly<{
  active: Readonly<{
    task: NamedTask<TTasks>;
    run: Run<any>;
    /**
     * The checklists the Run counts for, as every `start` of it named them. A
     * renderer skips from guidance with `skipActive(run)`; with none, it offers no skip.
     */
    checklists: readonly (keyof TSelections & string)[];
  }> | null;
}>;

/**
 * What `subscribeActive` hands its listener: the active Task, and the step
 * its Run is on. A new object whenever either changes.
 */
export type ActiveSnapshot<
  TTasks,
  TSelections extends ChecklistSelections<TTasks> = ChecklistSelections<TTasks>,
> = Readonly<{
  active: ChecklistsSnapshot<TTasks, TSelections>["active"];
  /** The active Run's Snapshot; null when nothing is active. */
  step: Snapshot<any> | null;
}>;

export type Checklists<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  checklists: ChecklistViews<TTasks, TSelections>;

  /**
   * Starts or replays guidance; exits any previous Run. `checklists` are the
   * ones the guidance counts for, where a skip from it applies; a view's
   * `start` names its own. If the Task is already active, its Run counts for
   * them too. Throws for a checklist that does not select the Task. No-op
   * without a walkthrough.
   */
  start: <TId extends TaskId<TTasks>>(
    id: TId,
    checklists?:
      | ChecklistsWith<TSelections, TId>
      | readonly ChecklistsWith<TSelections, TId>[],
  ) => void;
  /** Exits the active Run. No-op when nothing is active. */
  stop: () => void;
  /** Records done across every view. */
  markDone: (id: TaskId<TTasks>) => void;
  /**
   * Back to todo in every view: from done, and from skipped in every
   * checklist. A Task with a condition, taken back from done, is not
   * completed by the condition again until it has been false.
   */
  markTodo: (id: TaskId<TTasks>) => void;
  /**
   * For the guidance renderer: skips the active Task in the checklists its
   * Run counts for, as one change, and exits the Run. `run` is the Run the
   * renderer drew; no-op unless it is still the active Run, so a second press
   * cannot skip the guidance that replaced it.
   */
  skipActive: (run: Run) => void;

  /**
   * For the one guidance renderer. Runs read their UI elements through the
   * bound getter; one binding at a time, newest wins. Returns release.
   */
  bindUi: (ui: () => UiElements) => () => void;
  /** The halo every Run draws around its Waymark, from the `run` options. */
  waymarkPadding: number;

  /** Changes identity only when the active Task changes. */
  getSnapshot: () => ChecklistsSnapshot<TTasks, TSelections>;
  /** Calls the listener at once with the current snapshot, then with each new one. */
  subscribe: (
    listener: (snapshot: ChecklistsSnapshot<TTasks, TSelections>) => void,
  ) => () => void;
  /**
   * For a renderer drawing guidance itself. Like `subscribe`, but also
   * subscribes to whichever Run is active, swapping as it changes, so the
   * listener hears every step too. A Run watches the page only while
   * subscribed: reading the active Run through `subscribe` alone leaves its
   * Waymark searching and its clicks unheard. The listener is called at once,
   * like `subscribe`'s. Unsubscribing lets go of both.
   */
  subscribeActive: (
    listener: (snapshot: ActiveSnapshot<TTasks, TSelections>) => void,
  ) => () => void;

  /**
   * Checks every non-done Task's condition once, in task map order, and
   * commits every completion together. True overrides skipped everywhere.
   */
  update: (context: TContext) => void;
  /** Authoritative replacement. Notifies changed views; no `onChange`, no events. */
  load: (stored: Stored) => void;
  /** Empties all progress, including unknown ids, and calls `onChange` once. Keeps the active Run. */
  clear: () => void;
}>;

/**
 * Every Task in the map, with keys its shape does not name turned into errors.
 * Steps written inline are held to TStepShape as `defineWalkthrough` holds
 * its own, since nothing else checks them.
 */
export type ExactTasks<TTasks, TShape, TStepShape extends Step = Step> = {
  readonly [K in keyof TTasks]: Exactly<TTasks[K], TShape> &
    ExactInlineSteps<TTasks[K], TStepShape>;
};

// `infer` is unconstrained: a Step sharing no key with core's all-optional
// `Step` fails to extend it, and would slip past this check altogether.
type ExactInlineSteps<TTask, TStepShape extends Step> = TTask extends {
  readonly walkthrough: readonly (infer TStep extends object)[];
}
  ? {
      readonly walkthrough: readonly TStepShape[] &
        readonly ExactStep<TStep, TStepShape>[];
    }
  : unknown;

/**
 * TShape names the fields a Task may carry. Core's own is `Task`; an adapter
 * that adds display fields passes its wider Task type.
 */
export type ChecklistsConfig<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
  TShape = Task<TContext>,
  TStepShape extends Step = Step,
> = Readonly<{
  /**
   * Initial application data. Its shape is the context type every condition
   * receives. Omit it when no Task has a condition.
   */
  context?: TContext;
  tasks: TTasks & ExactTasks<TTasks, TShape, TStepShape>;
  /** Named, ordered selections of the tasks. Omit for one checklist, `main`, of every Task. */
  checklists?: TSelections;
}> &
  ChecklistsOptions<TTasks, TSelections>;
