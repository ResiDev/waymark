import { createQueue } from "../queue";
import { createRun } from "../run/run";
import { checkedWalkthrough } from "../walkthrough/walkthrough";
import { createProgress } from "./progress";
import { statusIn } from "./record";
import type { Stored } from "./record";
import { followActive, listen } from "./subscribe";
import type {
  ActiveTask,
  Checklist,
  ChecklistSelections,
  Checklists,
  ChecklistsConfig,
  ChecklistsEvent,
  ChecklistsSnapshot,
  DefaultChecklists,
  NamedTask,
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
 * done and what is skipped, and holds the Run of whichever Task's
 * walkthrough is currently being followed. Views and the owner are stores on
 * the same terms as a Run: `getSnapshot` is stable until something observable
 * changes; `subscribe` calls the listener at once with the current snapshot,
 * then with each new one, and returns an unsubscribe. That is Svelte's store
 * contract, which React's `useSyncExternalStore` also accepts.
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
  // Inside, the owner sees its tasks only as a map of `Task<TContext>`; the
  // exact TTasks and TSelections are restored by the cast at the end.
  type Tasks = TaskMap<TContext>;
  type Selections = ChecklistSelections<Tasks>;
  type Named = NamedTask<Tasks>;
  type Active = ActiveTask<Named>;
  type Event = ChecklistsEvent<Tasks, Selections>;

  type StopReason = Extract<Event, { type: "taskStopped" }>["reason"];

  /** The owner's state on either side of a command, which its events are read from. */
  type State = Readonly<{
    record: Stored;
    active: Active | null;
    startedFrom: string | undefined;
  }>;

  /** What a command says about itself; everything else is read from state. */
  type Flags = Readonly<{
    /** The view the command came from, which skip and unskip events name. */
    from?: string | undefined;
    /** `load`, `clear` and creation announce nothing. */
    silent?: boolean;
    /** `load` never saves or calls `onChange`. */
    persist?: boolean;
  }>;

  const tasks: Tasks = config.tasks;
  const selections: Readonly<Record<string, readonly string[]>> =
    config.checklists ?? {
      [DEFAULT_CHECKLIST]: Object.keys(tasks),
    };
  validate(tasks, selections);
  const { onChange, onEvent, run: runOptions, storage } = config;
  const emit = onEvent as ((event: Event) => void) | undefined;
  // Every Run's steps come from these tasks, so its events carry the steps
  // the application's handler is typed for.
  const onRunEventOption = runOptions?.onEvent as
    | ((event: RunEvent) => void)
    | undefined;

  const taskIds = Object.keys(tasks);
  const named: Record<string, Named> = Object.create(null);
  for (const id of taskIds) named[id] = { ...tasks[id]!, id };
  // Snapshots keep each Task as written; Runs need a checked Walkthrough.
  const walkthroughs: Record<string, Walkthrough> = Object.create(null);
  for (const id of taskIds) {
    const walkthrough = tasks[id]!.walkthrough;
    if (walkthrough === undefined) continue;
    walkthroughs[id] = isSteps(walkthrough)
      ? checkedWalkthrough(walkthrough, `Task "${id}": `)
      : walkthrough;
  }

  // ---- state ----------------------------------------------------------------

  const progress = createProgress(storage?.load() ?? config.stored);
  let active: Active | null = null;
  /** The view whose `start` began the active Run, if one did. */
  let startedFrom: string | undefined;
  let ownerSnapshot: ChecklistsSnapshot<Tasks> = {
    active: null,
  };
  const ownerListeners = new Set<
    (snapshot: ChecklistsSnapshot<Tasks>) => void
  >();
  let boundUi: (() => UiElements) | undefined;

  // ---- views ----------------------------------------------------------------

  const source: ViewSource<Named> = {
    task: (id) => named[id]!,
    status: progress.status,
    active: () => active,
  };
  const views = Object.keys(selections).map((name) =>
    createView(name, selections[name]!, source),
  );

  // ---- the one place state changes -------------------------------------------

  const queue = createQueue("Checklist callbacks failed.");

  const current = (): State => ({ record: progress.record(), active, startedFrom });

  /** Run one command and commit it in full; see `send`. */
  const commit = (run: () => void, flags: Flags) => {
    const before = current();
    run();
    const after = current();

    // Commit every affected snapshot before any callback sees the change.
    const { changed, completed } = refresh(views, source);
    const activeChanged = after.active !== before.active;
    if (activeChanged) ownerSnapshot = { active: after.active };
    // A Run let go of before it finished is exited once the change is announced.
    const stopped = activeChanged ? before.active : null;
    const exit =
      stopped !== null && stopped.run.getSnapshot().phase !== "completed";

    for (const view of changed) queue.notify(view.listeners, view.snapshot);
    if (activeChanged) queue.notify(ownerListeners, ownerSnapshot);
    if (after.record !== before.record && flags.persist !== false) {
      queue.invoke(() => storage?.save(after.record));
      queue.invoke(() => onChange?.(after.record));
    }
    if (!flags.silent) {
      for (const event of eventsBetween(before, after, flags.from))
        queue.invoke(() => emit?.(event));
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
    if (exit) queue.invoke(() => stopped.run.act("exit"));
  };

  /**
   * Runs commands in order, one at a time, each committed in full before the
   * next: state, then view and owner snapshots, then listeners, `onChange`,
   * events, and finally exiting a Run the command let go of. A command sent
   * from a listener or event handler joins the queue and runs once this one
   * is over. See ../queue.ts for how callback errors are reported.
   */
  const send = (run: () => void, flags: Flags = {}) =>
    queue.run(() => commit(run, flags));

  // ---- events ----------------------------------------------------------------

  /** The `checklist` of a skip event: the view it came from, if any. */
  const fromView = (checklist: string | undefined) =>
    checklist === undefined ? {} : { checklist };

  /** Why the Run active in `before` is not active in `after`. */
  const stopReason = (
    { task, run }: Active,
    before: State,
    after: State,
  ): StopReason => {
    if (run.getSnapshot().phase === "completed") return "finished";
    const skipped =
      statusIn(after.record, task.id) === "skipped" &&
      statusIn(before.record, task.id) !== "skipped";
    return skipped ? "skipped" : "stopped";
  };

  /**
   * What a command did, read from the state on either side of it: the Run it
   * let go of, each Task whose status changed in task map order, then the Run
   * it started. Commands only change state and never announce anything.
   */
  const eventsBetween = (
    before: State,
    after: State,
    from: string | undefined,
  ): Event[] => {
    const events: Event[] = [];
    if (before.active !== null && before.active !== after.active) {
      const reason = stopReason(before.active, before, after);
      events.push({ type: "taskStopped", task: before.active.task, reason });
    }
    for (const id of taskIds) {
      const was = statusIn(before.record, id);
      const now = statusIn(after.record, id);
      if (was === now) continue;
      const task = named[id]!;
      if (now === "done") {
        events.push({ type: "taskComplete", task });
      } else if (now === "skipped") {
        // Skipped from guidance: from the view that started it.
        const guided = before.active?.task.id === id;
        const view = from ?? (guided ? before.startedFrom : undefined);
        events.push({ type: "taskSkipped", task, ...fromView(view) });
      } else if (was === "done") {
        events.push({ type: "taskReopened", task });
      } else {
        events.push({ type: "taskUnskipped", task, ...fromView(from) });
      }
    }
    if (after.active !== null && after.active !== before.active)
      events.push({ type: "taskStarted", task: after.active.task });
    return events;
  };

  // ---- commands --------------------------------------------------------------

  /**
   * Let go of the active Run. A finished one records its Task done unless the
   * Task has a condition; any other is exited by `commit`.
   */
  const release = () => {
    if (active === null) return;
    const { task, run } = active;
    // A subscriber may release the Run before its finish event reaches us.
    if (run.getSnapshot().phase === "completed" && task.isComplete === undefined)
      progress.set(task.id, "done");
    active = null;
    startedFrom = undefined;
  };

  /**
   * Finish and exit are observed here, never through `subscribe`, since
   * subscribing switches on page watching. A Run the owner has already let go
   * of is not its concern any more.
   */
  const onRunEvent = (run: Run, event: RunEvent) => {
    if (event.type !== "finish" && event.type !== "exit") return;
    send(() => {
      if (active?.run === run) release();
    });
  };

  const start = (id: string, from?: string) =>
    send(() => {
      const task = named[id];
      const walkthrough = walkthroughs[id];
      if (task === undefined || walkthrough === undefined) return;
      if (active?.task.id === id) return;
      release();
      const run = createRun(walkthrough, {
        ...runOptions,
        ui: () => boundUi?.() ?? NO_UI,
        onEvent: (event) => {
          onRunEvent(run, event);
          onRunEventOption?.(event);
        },
      });
      active = { task, run };
      startedFrom = from;
    });

  const stop = () => send(release);

  const markDone = (id: string) =>
    send(() => {
      if (Object.hasOwn(named, id)) progress.set(id, "done");
    });

  /** Todo to skipped, letting go of the Task's active Run. */
  const skip = (id: string, from?: string) =>
    send(
      () => {
        // A finished Run settles first, so its Task is done rather than skipped.
        if (
          active?.task.id === id &&
          active.run.getSnapshot().phase === "completed"
        ) {
          release();
        }
        if (!Object.hasOwn(named, id) || progress.status(id) !== "todo") return;
        progress.set(id, "skipped");
        if (active?.task.id === id) release();
      },
      { from },
    );

  /**
   * Back to todo. A Task with a condition, taken back from done, is held
   * until the condition has been false.
   */
  const reopen = (id: string) => {
    const task = named[id];
    const status = progress.status(id);
    if (task === undefined || status === "todo") return;
    // A condition that is likely still true would tick the Task straight back.
    const reopened = status === "done" && task.isComplete !== undefined;
    progress.set(id, reopened ? "reopened" : undefined);
  };

  const markTodo = (id: string) => send(() => reopen(id));

  const toggle = (id: string, from: string) =>
    send(
      () => {
        if (!Object.hasOwn(named, id)) return;
        if (progress.status(id) === "todo") progress.set(id, "done");
        else reopen(id);
      },
      { from },
    );

  /**
   * Every eligible condition is checked before anything is recorded, so a
   * throwing check changes nothing. A reopened Task is left todo while its
   * condition holds, and counts again once it has been false.
   */
  const checkConditions = (context: TContext) => {
    const complete: string[] = [];
    const settled: string[] = [];
    for (const id of taskIds) {
      const { isComplete } = named[id]!;
      if (isComplete === undefined || progress.status(id) === "done") continue;
      const met = isComplete(context) === true;
      if (!progress.isReopened(id)) {
        if (met) complete.push(id);
      } else if (!met) {
        settled.push(id);
      }
    }
    for (const id of settled) progress.set(id, undefined);
    for (const id of complete) progress.set(id, "done");
  };

  const update = (context: TContext) => send(() => checkConditions(context));

  const load = (stored: Stored) =>
    send(() => progress.replace(stored), { silent: true, persist: false });

  const clear = () => send(() => progress.clear(), { silent: true });

  // Creation checks the initial context like `update`, saving any change but
  // announcing nothing: the owner is not assigned yet, and a reload must not
  // repeat completion for a view storage already had complete. Without a
  // context there is nothing to check a condition against.
  const initial = config.context;
  if (initial !== undefined) {
    send(() => checkConditions(initial), { silent: true });
  }

  const checklists: Record<string, Checklist<Named>> = Object.create(null);
  for (const view of views) {
    checklists[view.name] = {
      start: (id) => start(id, view.name),
      markDone,
      skip: (id) => skip(id, view.name),
      toggle: (id) => toggle(id, view.name),
      getSnapshot: () => view.snapshot,
      subscribe: listen(queue, view.listeners, () => view.snapshot),
    };
  }

  const subscribe = listen(queue, ownerListeners, () => ownerSnapshot);
  const owner: Checklists<TContext, Tasks, Selections> = {
    checklists,
    start: (id) => start(id),
    stop,
    markDone,
    markTodo,
    skip: (id) => skip(id),
    bindUi: (ui) => {
      boundUi = ui;
      return () => {
        if (boundUi === ui) boundUi = undefined;
      };
    },
    waymarkPadding: runOptions?.waymarkPadding ?? 0,
    getSnapshot: () => ownerSnapshot,
    subscribe,
    subscribeActive: (listener) =>
      followActive(subscribe, () => ownerSnapshot.active, listener),
    update,
    load,
    clear,
  };
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
