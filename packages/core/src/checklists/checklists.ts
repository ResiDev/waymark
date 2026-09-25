import { createQueue } from "../queue";
import { createRun } from "../run/run";
import { checkedWalkthrough } from "../walkthrough/walkthrough";
import { createProgress } from "./progress";
import { sameRecord, unique } from "./record";
import type { Stored } from "./record";
import { followActive, listen } from "./subscribe";
import type {
  Checklist,
  ChecklistSelections,
  Checklists,
  ChecklistsConfig,
  ChecklistsEvent,
  ChecklistsSnapshot,
  DefaultChecklists,
  Task,
  TaskMap,
} from "./types";
import { DEFAULT_CHECKLIST } from "./types";
import { validate } from "./validate";
import { createView, refresh } from "./views";
import type { ViewSource } from "./views";
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

  const progress = createProgress(
    taskIds,
    viewNames,
    storage?.load() ?? config.stored,
  );
  let active: Active | null = null;
  let ownerSnapshot: ChecklistsSnapshot<Record<string, AnyTask>> = {
    active: null,
  };
  const ownerListeners = new Set<
    (snapshot: ChecklistsSnapshot<Record<string, AnyTask>>) => void
  >();
  let boundUi: (() => UiElements) | undefined;

  // ---- views ----------------------------------------------------------------

  const source: ViewSource<Named> = {
    task: (id) => named[id]!,
    status: progress.status,
    active: () => active,
  };
  const views = viewNames.map((name) =>
    createView(name, selections[name]!, source),
  );

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
    const recordBefore = progress.record();
    const activeBefore = active;
    run(change);

    // Commit every affected snapshot before any callback sees the change.
    const { changed, completed } = refresh(views, source);
    const activeChanged = active !== activeBefore;
    if (activeChanged) ownerSnapshot = { active };
    const record = progress.record();
    const recordChanged = !sameRecord(recordBefore, record);

    for (const view of changed) queue.notify(view.listeners, view.snapshot);
    if (activeChanged) queue.notify(ownerListeners, ownerSnapshot);
    if (recordChanged && change.persist) {
      queue.invoke(() => storage?.save(record));
      queue.invoke(() => onChange?.(record));
    }
    if (!change.silent) {
      for (const event of change.events) queue.invoke(() => emit?.(event));
      for (const view of completed) {
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

  /** Record done in one update, announcing each Task that was not done already. */
  const recordDone = (change: Change, ...ids: string[]) => {
    for (const id of progress.addDone(ids))
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
    if (!Object.hasOwn(named, id)) return;
    const fresh = progress.addSkipped(id, checklists);
    if (fresh.length === 0) return;
    for (const name of fresh) {
      change.events.push({
        type: "taskSkipped",
        task: named[id]!,
        checklist: name,
      });
    }
    if (active?.task.id === id) release(change, "skipped");
  };

  /** Back to todo: from done in every view, and from skipped in each checklist. */
  const recordTodo = (
    change: Change,
    id: string,
    checklists: readonly string[],
  ) => {
    const task = named[id];
    if (task === undefined) return;
    if (progress.removeDone(id, task.isComplete !== undefined))
      change.events.push({ type: "taskReopened", task });
    for (const name of progress.removeSkipped(id, checklists))
      change.events.push({ type: "taskUnskipped", task, checklist: name });
  };

  const markTodo = (id: string) =>
    send((change) => recordTodo(change, id, viewNames));

  const toggle = (id: string, name: string) =>
    send((change) => {
      if (!Object.hasOwn(named, id)) return;
      if (progress.status(name, id) === "todo") recordDone(change, id);
      else recordTodo(change, id, [name]);
    });

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

  /**
   * Every eligible condition is checked before anything is recorded, so a
   * throwing check changes nothing. A reopened Task is left todo while its
   * condition holds, and counts again once it has been false.
   */
  const check = (change: Change, context: TContext) => {
    const complete: string[] = [];
    const settled: string[] = [];
    for (const id of taskIds) {
      const { isComplete } = named[id]!;
      if (isComplete === undefined || progress.isDone(id)) continue;
      const met = isComplete(context) === true;
      if (!progress.isReopened(id)) {
        if (met) complete.push(id);
      } else if (!met) {
        settled.push(id);
      }
    }
    progress.forgetReopened(settled);
    recordDone(change, ...complete);
  };

  const update = (context: TContext) =>
    send((change) => check(change, context));

  const load = (stored: Stored) =>
    send(() => progress.replace(stored), { silent: true, persist: false });

  const clear = () => send(() => progress.clear(), { silent: true });

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
      toggle: (id) => toggle(id, view.name),
      getSnapshot: () => view.snapshot,
      subscribe: listen(view.listeners),
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
    markTodo,
    skipActive,
    bindUi: (ui) => {
      boundUi = ui;
      return () => {
        if (boundUi === ui) boundUi = undefined;
      };
    },
    waymarkPadding: runOptions?.waymarkPadding ?? 0,
    getSnapshot: () => ownerSnapshot,
    subscribe: listen(ownerListeners),
    subscribeActive: (listener) =>
      followActive(
        listen(ownerListeners),
        () => ownerSnapshot.active,
        listener,
      ),
    update,
    load,
    clear,
  };
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
