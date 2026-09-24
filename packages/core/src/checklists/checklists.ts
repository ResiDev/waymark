import { createQueue } from "../queue";
import { createRun } from "../run/run";
import { checkedWalkthrough } from "../walkthrough/walkthrough";
import { EMPTY, isEmpty, normalise, sameRecord, unique } from "./record";
import type { Stored } from "./record";
import type {
  Checklist,
  ChecklistSelections,
  Checklists,
  ChecklistsConfig,
  ChecklistsEvent,
  ChecklistSnapshot,
  ChecklistsSnapshot,
  DefaultChecklists,
  Task,
  TaskMap,
  TaskStatus,
} from "./types";
import { DEFAULT_CHECKLIST } from "./types";
import { validate } from "./validate";
import type { Run, RunEvent, UiElements } from "../run/types";
import type { Step, Walkthrough } from "../walkthrough/types";

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
 * `onChange` out, or a `storage` that does both, such as the local storage
 * adapter in storage.ts.
 */

const NO_UI: UiElements = { dialog: null, beacon: null };

// ---- Creation --------------------------------------------------------------

const isSteps = <TStep extends Step>(
  walkthrough: Walkthrough<TStep> | readonly TStep[],
): walkthrough is readonly TStep[] => Array.isArray(walkthrough);

type AnyTask = Task<any, any>;
type Named = Readonly<AnyTask & { id: string }>;
type Active = Readonly<{
  task: Named;
  run: Run<any>;
  checklists: readonly string[];
}>;
type Event = ChecklistsEvent<
  Record<string, AnyTask>,
  ChecklistSelections<Record<string, AnyTask>>
>;

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
 * files use `satisfies Task<AppContext>`. Without a context it is `{}`, so a condition
 * that reads a field does not compile.
 */
export function createChecklists<
  TContext = {},
  const TTasks extends TaskMap<NoInfer<TContext>> = TaskMap<TContext>,
  const TSelections extends ChecklistSelections<TTasks> =
    DefaultChecklists<TTasks>,
>(
  config: ChecklistsConfig<TContext, TTasks, TSelections>,
): Checklists<TContext, TTasks, TSelections> {
  const tasks: TaskMap<TContext> = config.tasks;
  const selections: Readonly<Record<string, readonly string[]>> =
    config.checklists ?? {
      [DEFAULT_CHECKLIST]: Object.keys(tasks),
    };
  validate(tasks, selections);
  const { onChange, onEvent, run: runOptions, storage } = config;
  const emit = onEvent as ((event: Event) => void) | undefined;

  const taskIds = Object.keys(tasks);
  const named: Record<string, Named> = Object.create(null);
  for (const id of taskIds) named[id] = { ...tasks[id]!, id };
  // Snapshots keep each Task as written; Runs need a checked Walkthrough.
  const walkthroughs: Record<string, Walkthrough<any>> = Object.create(null);
  for (const id of taskIds) {
    const walkthrough = tasks[id]!.walkthrough;
    if (walkthrough === undefined) continue;
    walkthroughs[id] = isSteps(walkthrough)
      ? checkedWalkthrough(walkthrough, `Task "${id}": `)
      : walkthrough;
  }
  const viewNames = Object.keys(selections);

  // ---- state ----------------------------------------------------------------

  let record = normalise(storage?.load() ?? config.stored ?? EMPTY, taskIds, viewNames);
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
  let ownerSnapshot: ChecklistsSnapshot<Record<string, AnyTask>> = {
    active: null,
  };
  const ownerListeners = new Set<() => void>();
  let boundUi: (() => UiElements) | undefined;

  // ---- views ----------------------------------------------------------------

  const buildSnapshot = (view: View): ChecklistSnapshot<Named> => {
    const rows = view.ids.map((id) => ({
      task: named[id]!,
      status: statusOf(view.name, id),
    }));
    const finishedCount = rows.filter((row) => row.status !== "todo").length;
    return {
      tasks: rows,
      finishedCount,
      taskCount: rows.length,
      complete: finishedCount === rows.length,
      active:
        active !== null && view.ids.includes(active.task.id) ? active : null,
    };
  };

  const sameSnapshot = (
    a: ChecklistSnapshot<Named>,
    b: ChecklistSnapshot<Named>,
  ): boolean =>
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
    if (recordChanged && change.persist) {
      queue.invoke(() => storage?.save(record));
      queue.invoke(() => onChange?.(record));
    }
    if (!change.silent) {
      for (const event of change.events) queue.invoke(() => emit?.(event));
      for (const view of completedViews) {
        queue.invoke(() =>
          emit?.({
            type: "checklistComplete",
            checklist: view.name,
            snapshot: view.snapshot,
          }),
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
   * See ../queue.ts for how callback errors are reported.
   */
  const send = (run: (change: Change) => void, flags: Partial<Change> = {}) =>
    queue.run(() => commit(run, flags));

  // ---- transitions -----------------------------------------------------------

  /** Record done in one update and drop the Tasks from every skipped list. Already done ids are ignored. */
  const recordDone = (change: Change, ...ids: string[]) => {
    const fresh = ids.filter((id) => !done.has(id));
    if (fresh.length === 0) return;
    setRecord({ done: [...record.done, ...fresh], skipped: record.skipped });
    for (const id of fresh)
      change.events.push({ type: "taskComplete", task: named[id]! });
  };

  /** Settle a finished Run, or exit it once the change is committed. */
  const release = (
    change: Change,
    reason: "finished" | "skipped" | "stopped",
  ) => {
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
      const walkthrough = walkthroughs[id];
      if (task === undefined || walkthrough === undefined) return;
      if (active?.task.id === id) {
        // Already guiding this Task: it now counts for these checklists too.
        const merged = unique([...active.checklists, ...checklists]);
        if (merged.length > active.checklists.length)
          active = { ...active, checklists: merged };
        return;
      }
      release(change, "stopped");
      const run: Run<any> = createRun(walkthrough, {
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
  const recordSkipped = (
    change: Change,
    id: string,
    checklists: readonly string[],
  ) => {
    // A finished Run settles first, so its Task is done rather than skipped.
    if (
      active?.task.id === id &&
      active.run.getSnapshot().phase === "completed"
    ) {
      release(change, "finished");
    }
    if (!Object.hasOwn(named, id) || done.has(id)) return;
    const fresh = checklists.filter((name) => !isSkipped(name, id));
    if (fresh.length === 0) return;
    // Null-prototype, so a checklist named `__proto__` is an ordinary key.
    const skipped: Record<string, readonly string[]> = Object.assign(
      Object.create(null),
      record.skipped,
    );
    for (const name of fresh)
      skipped[name] = [...(record.skipped[name] ?? []), id];
    setRecord({ done: record.done, skipped });
    for (const name of fresh) {
      change.events.push({
        type: "taskSkipped",
        task: named[id]!,
        checklist: name,
      });
    }
    if (active?.task.id === id) release(change, "skipped");
  };

  const skipActive = (run: Run) =>
    send((change) => {
      if (active?.run !== run) return;
      recordSkipped(change, active.task.id, active.checklists);
    });

  /** The checklists the application names, as a list, each checked to select the Task. */
  const checklistsFor = (
    id: string,
    names: string | readonly string[] = [],
  ): readonly string[] => {
    const list = unique(typeof names === "string" ? [names] : names);
    for (const name of list) {
      if (!Object.hasOwn(selections, name))
        throw new Error(`Unknown checklist "${name}".`);
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
      return (
        !done.has(id) &&
        task.isComplete !== undefined &&
        task.isComplete(context) === true
      );
    });
    recordDone(change, ...complete);
  };

  const update = (context: TContext) =>
    send((change) => check(change, context));

  const load = (stored: Stored) =>
    send(() => setRecord(stored), { silent: true, persist: false });

  const clear = () =>
    send(
      () => {
        if (!isEmpty(record)) setRecord(EMPTY);
      },
      { silent: true },
    );

  const subscribeTo =
    (listeners: Set<() => void>) => (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

  const subscribeActive = (listener: () => void) => {
    // Wrapped, so the same listener given twice is two subscriptions to a Run.
    const onRun = () => listener();
    let followed: { run: Run<any>; unsubscribe: () => void } | undefined;
    const follow = () => {
      const run = ownerSnapshot.active?.run;
      if (followed?.run === run) return;
      followed?.unsubscribe();
      followed = run === undefined ? undefined : { run, unsubscribe: run.subscribe(onRun) };
    };
    follow();
    const unsubscribeOwner = subscribeTo(ownerListeners)(() => {
      follow();
      listener();
    });
    return () => {
      unsubscribeOwner();
      followed?.unsubscribe();
      followed = undefined;
    };
  };

  // Creation checks the initial context like `update`, saving any change but
  // announcing nothing: the owner is not assigned yet, and a reload must not
  // repeat completion for a view storage already had complete.
  send((change) => check(change, config.context ?? ({} as TContext)), {
    silent: true,
  });

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

  const owner: Checklists<
    TContext,
    Record<string, AnyTask>,
    ChecklistSelections<Record<string, AnyTask>>
  > = {
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
    subscribeActive,
    update,
    load,
    clear,
  };
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
