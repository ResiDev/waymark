import { createRun } from "./run";
import type {
  Run,
  RunEvent,
  RunOptions,
  Step,
  UiElements,
  Walkthrough,
} from "./types";

/**
 * Checklists: named, ordered views of Tasks that share one user's completion
 * record and at most one active Run.
 *
 * One `createChecklists` call is one owner. It defines the Tasks by id, hands
 * out a live view per named selection, keeps the shared record of what is
 * done and what each view has skipped, and holds the Run of whichever Task's
 * walkthrough is currently being followed. Views and the owner are stores on
 * the same terms as a Run: `getSnapshot` is stable until something observable
 * changes, `subscribe` returns an unsubscribe.
 *
 * Core keeps progress in memory only. Persistence is `stored` in and
 * `onChange` out; the local storage adapter in storage.ts is one caller of
 * that pair.
 */

// ---- Tasks and selections --------------------------------------------------

/**
 * One objective. TContext types the application data its completion condition
 * reads; TStep types its walkthrough's instructions. Map keys supply ids.
 */
export type Task<TContext, TStep extends Step = Step> = Readonly<{
  walkthrough?: Walkthrough<TStep>;
  /**
   * Pure, synchronous. `update(context)` evaluates it and records completion.
   * Without it, finishing the walkthrough records done, and the application
   * may still call `markDone`.
   */
  isComplete?: (context: TContext) => boolean;
  /** Whatever an adapter shows for the task, such as a title. Core keeps it in snapshots and ignores it. */
  [extra: string]: unknown;
}>;

/**
 * Types a Task declared away from `createChecklists`, where nothing supplies
 * the context type. Curried so TypeScript can still infer the step type:
 *
 *   export type AppContext = typeof initialContext;
 *   "create-deck": defineTask<AppContext>()({ walkthrough, isComplete: (c) => c.hasDeck })
 */
export function defineTask<TContext>(): <const TTask extends Task<TContext, any>>(
  task: TTask,
) => TTask {
  return (task) => task;
}

export type TaskMap<TContext> = Readonly<Record<string, Task<TContext, any>>>;
export type TaskId<TTasks> = keyof TTasks & string;

/** Each checklist name maps to task ids in display order. */
export type ChecklistSelections<TTasks> = Readonly<
  Record<string, readonly TaskId<TTasks>[]>
>;

/** The step type carried by a Task's walkthrough; never for a Task without one. */
export type StepOf<TTask> = TTask extends unknown
  ? "walkthrough" extends keyof TTask
    ? NonNullable<TTask["walkthrough"]> extends Walkthrough<infer TStep>
      ? TStep
      : never
    : never
  : never;

/** A Task as views and events see it: its own fields plus its map key. */
export type NamedTask<TTasks, TId extends TaskId<TTasks> = TaskId<TTasks>> = {
  [K in TId]: Readonly<TTasks[K] & { id: K }>;
}[TId];

/** Exactly the Task types one selection names. */
export type SelectedTask<TTasks, TIds extends readonly TaskId<TTasks>[]> =
  NamedTask<TTasks, TIds[number]>;

// ---- Saved state and snapshots ---------------------------------------------

/** Remaining, accomplished, or deliberately skipped. Active guidance is separate. */
export type TaskStatus = "todo" | "done" | "skipped";

/**
 * One persisted record per owner. Done is shared by every view; skipped is
 * per checklist. The active Run is not stored. No version field: storage
 * adapters wrap the record in their own envelope.
 */
export type Stored = Readonly<{
  done: readonly string[];
  skipped: Readonly<Record<string, readonly string[]>>;
}>;

export type ChecklistRow<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  status: TaskStatus;
}>;

export type ActiveTask<TTask extends { readonly id: string }> = Readonly<{
  task: TTask;
  run: Run<StepOf<TTask>>;
}>;

/** Current display data for one view. A new object only when something in it changed. */
export type ChecklistSnapshot<TTask extends { readonly id: string }> = Readonly<{
  tasks: readonly ChecklistRow<TTask>[];
  /** Done plus skipped in this checklist. */
  finishedCount: number;
  taskCount: number;
  complete: boolean;
  /** The shared active Run, only while its Task belongs to this checklist. */
  active: ActiveTask<TTask> | null;
}>;

export type TaskCommands<TId extends string> = Readonly<{
  /** Starts or replays guidance; exits any previous Run. No-op without a walkthrough or if already active. */
  start: (id: TId) => void;
  /** Records done in every view; guidance can continue. */
  markDone: (id: TId) => void;
  /** Todo to skipped in this checklist only; exits this Task's active Run. */
  skip: (id: TId) => void;
}>;

/** A framework-neutral live view. Owns neither storage nor application context. */
export type Checklist<TTask extends { readonly id: string }> = TaskCommands<TTask["id"]> &
  Readonly<{
    getSnapshot: () => ChecklistSnapshot<TTask>;
    subscribe: (listener: () => void) => () => void;
  }>;

// ---- Shared owner ----------------------------------------------------------

/**
 * Once per shared transition, not once per view. `taskStarted` and
 * `taskStopped` describe Runs, never application actions. Within one change,
 * task events come first, then `checklistComplete` for each view that just
 * became complete, in declaration order.
 */
export type ChecklistsEvent<TTasks, TSelections extends ChecklistSelections<TTasks>> =
  | Readonly<{ type: "taskStarted"; task: NamedTask<TTasks> }>
  | Readonly<{ type: "taskComplete"; task: NamedTask<TTasks> }>
  | Readonly<{
      type: "taskStopped";
      task: NamedTask<TTasks>;
      /** finished: reached the last step. skipped: a view skipped it. stopped: exit, `stop()`, or another `start()`. */
      reason: "finished" | "skipped" | "stopped";
    }>
  | Readonly<{
      type: "taskSkipped";
      task: NamedTask<TTasks>;
      checklist: keyof TSelections & string;
    }>
  | Readonly<{
      type: "checklistComplete";
      checklist: keyof TSelections & string;
      snapshot: ChecklistSnapshot<NamedTask<TTasks>>;
    }>;

export type ChecklistsOptions<TTasks, TSelections extends ChecklistSelections<TTasks>> = Readonly<{
  /** Starts empty if omitted. */
  stored?: Stored;
  /** The whole record after each local change. */
  onChange?: (stored: Stored) => void;
  onEvent?: (event: ChecklistsEvent<TTasks, TSelections>) => void;
  /**
   * Options for every Run the owner creates. Core supplies `startAt` and `ui`
   * itself and wraps `onEvent`: it handles finish and exit first, then calls yours.
   */
  run?: Omit<RunOptions<StepOf<TTasks[keyof TTasks]>>, "startAt" | "ui">;
}>;

export type ChecklistViews<TTasks, TSelections extends ChecklistSelections<TTasks>> = {
  readonly [Name in keyof TSelections]: Checklist<SelectedTask<TTasks, TSelections[Name]>>;
};

export type ChecklistsSnapshot<TTasks> = Readonly<{
  active: Readonly<{ task: NamedTask<TTasks>; run: Run<any> }> | null;
}>;

export type Checklists<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  checklists: ChecklistViews<TTasks, TSelections>;

  /** Starts or replays guidance; exits any previous Run. No-op without a walkthrough or if already active. */
  start: (id: TaskId<TTasks>) => void;
  /** Exits the active Run. No-op when nothing is active. */
  stop: () => void;
  /** Records done across every view. Skip is a view command, since it is recorded per checklist. */
  markDone: (id: TaskId<TTasks>) => void;

  /**
   * For the one guidance renderer. Runs read their UI elements through the
   * bound getter; one binding at a time, newest wins. Returns release.
   */
  bindUi: (ui: () => UiElements) => () => void;
  /** The halo every Run draws around its Waymark, from the `run` options. */
  waymarkPadding: number;

  /** Changes identity only when the active Task changes. */
  getSnapshot: () => ChecklistsSnapshot<TTasks>;
  subscribe: (listener: () => void) => () => void;

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

export type ChecklistsConfig<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  /** Initial application data. Its shape is the context type every condition receives. */
  context: TContext;
  tasks: TTasks;
  checklists: TSelections;
}> &
  ChecklistsOptions<TTasks, TSelections>;

// ---- The record ------------------------------------------------------------

const EMPTY: Stored = { done: [], skipped: {} };
const NO_UI: UiElements = { dialog: null, beacon: null };

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameRecord = (a: Stored, b: Stored): boolean => {
  if (!sameList(a.done, b.done)) return false;
  const names = Object.keys(a.skipped);
  return (
    sameList(names, Object.keys(b.skipped)) &&
    names.every((name) => sameList(a.skipped[name]!, b.skipped[name] ?? []))
  );
};

const isEmpty = (record: Stored): boolean =>
  record.done.length === 0 && Object.keys(record.skipped).length === 0;

/**
 * Deduplicate; done removes a Task from every skipped list; known ids come
 * first in task map order and known names first in declaration order, with
 * unknown ones after in input order. Empty skipped lists are dropped.
 */
function normalise(
  stored: Stored,
  taskIds: readonly string[],
  viewNames: readonly string[],
): Stored {
  const known = new Set(taskIds);
  const orderIds = (ids: readonly string[]): string[] => {
    const wanted = new Set(ids);
    return [
      ...taskIds.filter((id) => wanted.has(id)),
      ...unique(ids).filter((id) => !known.has(id)),
    ];
  };

  const done = orderIds(stored.done);
  const doneSet = new Set(done);
  const names = [
    ...viewNames.filter((name) => Object.hasOwn(stored.skipped, name)),
    ...Object.keys(stored.skipped).filter((name) => !viewNames.includes(name)),
  ];
  const skipped: Record<string, readonly string[]> = Object.create(null);
  for (const name of names) {
    const ids = orderIds(stored.skipped[name] ?? []).filter((id) => !doneSet.has(id));
    if (ids.length > 0) skipped[name] = ids;
  }
  return { done, skipped };
}

// ---- Validation ------------------------------------------------------------

function validate(tasks: TaskMap<any>, selections: Readonly<Record<string, readonly string[]>>): void {
  const taskIds = Object.keys(tasks);
  if (taskIds.length === 0) throw new Error("Checklists need at least one task.");
  if (taskIds.includes("")) throw new Error("A task id cannot be empty.");

  const names = Object.keys(selections);
  if (names.length === 0) throw new Error("Checklists need at least one checklist.");
  for (const name of names) {
    if (name === "") throw new Error("A checklist name cannot be empty.");
    const ids = selections[name]!;
    if (ids.length === 0) throw new Error(`Checklist "${name}" selects no tasks.`);
    const seen = new Set<string>();
    for (const id of ids) {
      if (!Object.hasOwn(tasks, id)) {
        throw new Error(`Checklist "${name}" selects unknown task "${id}".`);
      }
      if (seen.has(id)) throw new Error(`Checklist "${name}" repeats task "${id}".`);
      seen.add(id);
    }
  }
}

// ---- Creation --------------------------------------------------------------

type AnyTask = Task<any, any>;
type Named = Readonly<AnyTask & { id: string }>;
type Active = Readonly<{ task: Named; run: Run<any> }>;
type Event = ChecklistsEvent<Record<string, AnyTask>, ChecklistSelections<Record<string, AnyTask>>>;

type View = {
  readonly name: string;
  readonly ids: readonly string[];
  snapshot: ChecklistSnapshot<Named>;
  readonly listeners: Set<() => void>;
};

/** What one command may do besides changing state, gathered until the change is committed. */
type Change = {
  events: Event[];
  /** Run after every notification of this change, still inside the drain. */
  effects: (() => void)[];
  /** `load` and `clear` emit no transition events. */
  silent: boolean;
  /** `load` never calls `onChange`. */
  persist: boolean;
};

/** Report callback errors after all pending work has had a chance to finish. */
const reportErrors = (errors: readonly unknown[]) => {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Checklist callbacks failed.");
};

/**
 * Infers the context type from its initial values only, so `false` widens to
 * `boolean`. Tasks written inline are typed from that context; tasks in other
 * files go through `defineTask`.
 */
export function createChecklists<
  TContext,
  const TTasks extends TaskMap<NoInfer<TContext>>,
  const TSelections extends ChecklistSelections<TTasks>,
>(
  config: ChecklistsConfig<TContext, TTasks, TSelections>,
): Checklists<TContext, TTasks, TSelections> {
  const tasks: TaskMap<TContext> = config.tasks;
  const selections: Readonly<Record<string, readonly string[]>> = config.checklists;
  validate(tasks, selections);
  const { onChange, onEvent, run: runOptions } = config;
  const emit = onEvent as ((event: Event) => void) | undefined;

  const taskIds = Object.keys(tasks);
  const named: Record<string, Named> = Object.create(null);
  for (const id of taskIds) named[id] = { ...tasks[id]!, id };
  const viewNames = Object.keys(selections);

  // ---- state ----------------------------------------------------------------

  let record = normalise(config.stored ?? EMPTY, taskIds, viewNames);
  let done = new Set(record.done);
  const setRecord = (next: Stored) => {
    record = normalise(next, taskIds, viewNames);
    done = new Set(record.done);
  };

  const isSkipped = (name: string, id: string): boolean =>
    record.skipped[name]?.includes(id) ?? false;
  const statusOf = (name: string, id: string): TaskStatus =>
    done.has(id) ? "done" : isSkipped(name, id) ? "skipped" : "todo";

  let active: Active | null = null;
  let ownerSnapshot: ChecklistsSnapshot<Record<string, AnyTask>> = { active: null };
  const ownerListeners = new Set<() => void>();
  let boundUi: (() => UiElements) | undefined;

  // ---- views ----------------------------------------------------------------

  const buildSnapshot = (view: View): ChecklistSnapshot<Named> => {
    const rows = view.ids.map((id) => ({ task: named[id]!, status: statusOf(view.name, id) }));
    const finishedCount = rows.filter((row) => row.status !== "todo").length;
    return {
      tasks: rows,
      finishedCount,
      taskCount: rows.length,
      complete: finishedCount === rows.length,
      active: active !== null && view.ids.includes(active.task.id) ? active : null,
    };
  };

  const sameSnapshot = (a: ChecklistSnapshot<Named>, b: ChecklistSnapshot<Named>): boolean =>
    a.active === b.active &&
    a.tasks.every((row, index) => row.status === b.tasks[index]!.status);

  const views: View[] = viewNames.map((name) => {
    const view: View = {
      name,
      ids: selections[name]!,
      snapshot: undefined as unknown as ChecklistSnapshot<Named>,
      listeners: new Set(),
    };
    view.snapshot = buildSnapshot(view);
    return view;
  });

  // ---- the one place state changes -------------------------------------------

  const queue: { run: (change: Change) => void; silent: boolean; persist: boolean }[] = [];
  let draining = false;

  /**
   * Runs commands in order, one at a time, each committed in full before the
   * next: state, then view and owner snapshots, then listeners, `onChange`,
   * events, and finally the command's effects on Runs. A command sent from a
   * listener or event handler joins the queue and runs once this one is over.
   * A callback that throws does not stop the others; errors are thrown once
   * the drain is over.
   */
  const send = (run: (change: Change) => void, flags: Partial<Change> = {}) => {
    queue.push({ run, silent: flags.silent ?? false, persist: flags.persist ?? true });
    if (draining) return;
    draining = true;

    const errors: unknown[] = [];
    const invoke = (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    };

    try {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const command = queue[cursor]!;
        const change: Change = {
          events: [],
          effects: [],
          silent: command.silent,
          persist: command.persist,
        };
        const recordBefore = record;
        const activeBefore = active;
        command.run(change);

        // Commit every affected snapshot before any callback sees the change.
        const changedViews: View[] = [];
        const completedViews: View[] = [];
        for (const view of views) {
          const next = buildSnapshot(view);
          if (sameSnapshot(view.snapshot, next)) continue;
          if (!view.snapshot.complete && next.complete) completedViews.push(view);
          view.snapshot = next;
          changedViews.push(view);
        }
        const activeChanged = active !== activeBefore;
        if (activeChanged) ownerSnapshot = { active };
        const recordChanged = !sameRecord(recordBefore, record);

        // Copied on purpose: a listener may subscribe or unsubscribe others mid-notify.
        for (const view of changedViews) {
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const listener of [...view.listeners]) {
            if (view.listeners.has(listener)) invoke(listener);
          }
        }
        if (activeChanged) {
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const listener of [...ownerListeners]) {
            if (ownerListeners.has(listener)) invoke(listener);
          }
        }
        if (recordChanged && change.persist) invoke(() => onChange?.(record));
        if (!change.silent) {
          for (const event of change.events) invoke(() => emit?.(event));
          for (const view of completedViews) {
            invoke(() =>
              emit?.({ type: "checklistComplete", checklist: view.name, snapshot: view.snapshot }),
            );
          }
        }
        for (const effect of change.effects) invoke(effect);
      }
    } finally {
      queue.length = 0;
      draining = false;
    }

    reportErrors(errors);
  };

  // ---- transitions -----------------------------------------------------------

  /** Record done in one update and drop the Tasks from every skipped list. Already done ids are ignored. */
  const recordDone = (change: Change, ...ids: string[]) => {
    const fresh = ids.filter((id) => !done.has(id));
    if (fresh.length === 0) return;
    setRecord({ done: [...record.done, ...fresh], skipped: record.skipped });
    for (const id of fresh) change.events.push({ type: "taskComplete", task: named[id]! });
  };

  /** Settle a finished Run, or exit it once the change is committed. */
  const release = (change: Change, reason: "finished" | "skipped" | "stopped") => {
    if (active === null) return;
    const { task, run } = active;
    // A subscriber may release the Run before its finish event reaches us.
    if (run.getSnapshot().phase === "completed") reason = "finished";
    active = null;
    change.events.push({ type: "taskStopped", task, reason });
    if (reason === "finished") {
      if (task.isComplete === undefined) recordDone(change, task.id);
    } else {
      change.effects.push(() => run.act("exit"));
    }
  };

  /**
   * Finish and exit are observed here, never through `subscribe`, since
   * subscribing switches on page watching. A Run the owner has already let go
   * of is not its concern any more.
   */
  const onRunEvent = (run: Run<any>, event: RunEvent<any>) => {
    if (event.type !== "finish" && event.type !== "exit") return;
    send((change) => {
      if (active?.run !== run) return;
      release(change, event.type === "finish" ? "finished" : "stopped");
    });
  };

  const start = (id: string) =>
    send((change) => {
      const task = named[id];
      if (task?.walkthrough === undefined || active?.task.id === id) return;
      release(change, "stopped");
      const run: Run<any> = createRun(task.walkthrough, {
        ...runOptions,
        ui: () => boundUi?.() ?? NO_UI,
        onEvent: (event) => {
          onRunEvent(run, event);
          runOptions?.onEvent?.(event);
        },
      });
      active = { task, run };
      change.events.push({ type: "taskStarted", task });
    });

  const stop = () => send((change) => release(change, "stopped"));

  const markDone = (id: string) =>
    send((change) => {
      if (Object.hasOwn(named, id)) recordDone(change, id);
    });

  const skip = (name: string, id: string) =>
    send((change) => {
      // A finished Run settles first, so its Task is done rather than skipped.
      if (active?.task.id === id && active.run.getSnapshot().phase === "completed") {
        release(change, "finished");
      }
      if (!Object.hasOwn(named, id) || done.has(id) || isSkipped(name, id)) return;
      setRecord({
        done: record.done,
        skipped: { ...record.skipped, [name]: [...(record.skipped[name] ?? []), id] },
      });
      change.events.push({ type: "taskSkipped", task: named[id]!, checklist: name });
      if (active?.task.id === id) release(change, "skipped");
    });

  /** Every eligible condition is checked before anything is recorded, so a throwing check changes nothing. */
  const check = (change: Change, context: TContext) => {
    const complete = taskIds.filter((id) => {
      const task = named[id]!;
      return !done.has(id) && task.isComplete !== undefined && task.isComplete(context) === true;
    });
    recordDone(change, ...complete);
  };

  const update = (context: TContext) => send((change) => check(change, context));

  const load = (stored: Stored) =>
    send(() => setRecord(stored), { silent: true, persist: false });

  const clear = () =>
    send(
      () => {
        if (!isEmpty(record)) setRecord(EMPTY);
      },
      { silent: true },
    );

  const subscribeTo = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // Creation checks the initial context like `update`, saving any change but
  // announcing nothing: the owner is not assigned yet, and a reload must not
  // repeat completion for a view storage already had complete.
  send((change) => check(change, config.context), { silent: true });

  const checklists: Record<string, Checklist<Named>> = Object.create(null);
  for (const view of views) {
    checklists[view.name] = {
      start,
      markDone,
      skip: (id) => skip(view.name, id),
      getSnapshot: () => view.snapshot,
      subscribe: subscribeTo(view.listeners),
    };
  }

  const owner: Checklists<TContext, Record<string, AnyTask>, ChecklistSelections<Record<string, AnyTask>>> = {
    checklists,
    start,
    stop,
    markDone,
    bindUi: (ui) => {
      boundUi = ui;
      return () => {
        if (boundUi === ui) boundUi = undefined;
      };
    },
    waymarkPadding: runOptions?.waymarkPadding ?? 0,
    getSnapshot: () => ownerSnapshot,
    subscribe: subscribeTo(ownerListeners),
    update,
    load,
    clear,
  };
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
