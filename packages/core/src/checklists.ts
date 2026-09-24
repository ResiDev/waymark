import { createQueue } from "./queue";
import { createRun } from "./run";
import type {
  Exactly,
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
  /** The application's own data for this Task. Core keeps it in snapshots and ignores it. */
  meta?: unknown;
}>;

/**
 * Types a Task declared away from `createChecklists`, where nothing supplies
 * the context type. Curried so TypeScript can still infer the step type:
 *
 *   export type AppContext = typeof initialContext;
 *   "create-deck": defineTask<AppContext>()({ walkthrough, isComplete: (c) => c.hasDeck })
 */
export function defineTask<TContext>(): <const TTask extends Task<TContext, any>>(
  task: TTask & Exactly<TTask, Task<TContext, any>>,
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
  /** The checklists the Run counts for: where a skip from its guidance applies. */
  checklists: readonly string[];
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
      /** finished: reached the last step. skipped: a view or `skipActive` skipped it. stopped: exit, `stop()`, or another `start()`. */
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
    checklists?: ChecklistsWith<TSelections, TId> | readonly ChecklistsWith<TSelections, TId>[],
  ) => void;
  /** Exits the active Run. No-op when nothing is active. */
  stop: () => void;
  /** Records done across every view. */
  markDone: (id: TaskId<TTasks>) => void;
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

/** Every Task in the map, with keys its shape does not name turned into errors. */
export type ExactTasks<TTasks, TShape> = {
  readonly [K in keyof TTasks]: Exactly<TTasks[K], TShape>;
};

/**
 * TShape names the fields a Task may carry. Core's own is `Task`; an adapter
 * that adds display fields passes its wider Task type.
 */
export type ChecklistsConfig<
  TContext,
  TTasks,
  TSelections extends ChecklistSelections<TTasks>,
  TShape = Task<TContext, any>,
> = Readonly<{
  /** Initial application data. Its shape is the context type every condition receives. */
  context: TContext;
  tasks: TTasks & ExactTasks<TTasks, TShape>;
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
type Active = Readonly<{ task: Named; run: Run<any>; checklists: readonly string[] }>;
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

  const queue = createQueue("Checklist callbacks failed.");

  /** Run one command and commit it in full; see `send`. */
  const commit = (run: (change: Change) => void, flags: Partial<Change>) => {
    const change: Change = {
      events: [],
      effects: [],
      silent: flags.silent ?? false,
      persist: flags.persist ?? true,
    };
    const recordBefore = record;
    const activeBefore = active;
    run(change);

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

    for (const view of changedViews) queue.notify(view.listeners);
    if (activeChanged) queue.notify(ownerListeners);
    if (recordChanged && change.persist) queue.invoke(() => onChange?.(record));
    if (!change.silent) {
      for (const event of change.events) queue.invoke(() => emit?.(event));
      for (const view of completedViews) {
        queue.invoke(() =>
          emit?.({ type: "checklistComplete", checklist: view.name, snapshot: view.snapshot }),
        );
      }
    }
    for (const effect of change.effects) queue.invoke(effect);
  };

  /**
   * Runs commands in order, one at a time, each committed in full before the
   * next: state, then view and owner snapshots, then listeners, `onChange`,
   * events, and finally the command's effects on Runs. A command sent from a
   * listener or event handler joins the queue and runs once this one is over.
   * See queue.ts for how callback errors are reported.
   */
  const send = (run: (change: Change) => void, flags: Partial<Change> = {}) =>
    queue.run(() => commit(run, flags));

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

  const start = (id: string, checklists: readonly string[]) =>
    send((change) => {
      const task = named[id];
      if (task?.walkthrough === undefined) return;
      if (active?.task.id === id) {
        // Already guiding this Task: it now counts for these checklists too.
        const merged = unique([...active.checklists, ...checklists]);
        if (merged.length > active.checklists.length) active = { ...active, checklists: merged };
        return;
      }
      release(change, "stopped");
      const run: Run<any> = createRun(task.walkthrough, {
        ...runOptions,
        ui: () => boundUi?.() ?? NO_UI,
        onEvent: (event) => {
          onRunEvent(run, event);
          runOptions?.onEvent?.(event);
        },
      });
      active = { task, run, checklists };
      change.events.push({ type: "taskStarted", task });
    });

  const stop = () => send((change) => release(change, "stopped"));

  const markDone = (id: string) =>
    send((change) => {
      if (Object.hasOwn(named, id)) recordDone(change, id);
    });

  /** Record skipped in each checklist in one update and exit the Task's active Run. */
  const recordSkipped = (change: Change, id: string, checklists: readonly string[]) => {
    // A finished Run settles first, so its Task is done rather than skipped.
    if (active?.task.id === id && active.run.getSnapshot().phase === "completed") {
      release(change, "finished");
    }
    if (!Object.hasOwn(named, id) || done.has(id)) return;
    const fresh = checklists.filter((name) => !isSkipped(name, id));
    if (fresh.length === 0) return;
    // Null-prototype, so a checklist named `__proto__` is an ordinary key.
    const skipped: Record<string, readonly string[]> = Object.assign(Object.create(null), record.skipped);
    for (const name of fresh) skipped[name] = [...(record.skipped[name] ?? []), id];
    setRecord({ done: record.done, skipped });
    for (const name of fresh) {
      change.events.push({ type: "taskSkipped", task: named[id]!, checklist: name });
    }
    if (active?.task.id === id) release(change, "skipped");
  };

  const skipActive = (run: Run) =>
    send((change) => {
      if (active?.run !== run) return;
      recordSkipped(change, active.task.id, active.checklists);
    });

  /** The checklists the application names, as a list, each checked to select the Task. */
  const checklistsFor = (id: string, names: string | readonly string[] = []): readonly string[] => {
    const list = unique(typeof names === "string" ? [names] : names);
    for (const name of list) {
      if (!Object.hasOwn(selections, name)) throw new Error(`Unknown checklist "${name}".`);
      if (!selections[name]!.includes(id)) {
        throw new Error(`Checklist "${name}" does not select task "${id}".`);
      }
    }
    return list;
  };

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
      start: (id) => start(id, [view.name]),
      markDone,
      skip: (id) => send((change) => recordSkipped(change, id, [view.name])),
      getSnapshot: () => view.snapshot,
      subscribe: subscribeTo(view.listeners),
    };
  }

  const owner: Checklists<TContext, Record<string, AnyTask>, ChecklistSelections<Record<string, AnyTask>>> = {
    checklists,
    start: (id, names) => start(id, checklistsFor(id, names)),
    stop,
    markDone,
    skipActive,
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
