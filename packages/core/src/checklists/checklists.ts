import { dictionary } from "../dictionary";
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
  Task,
  TaskMap,
} from "./types";
import { DEFAULT_CHECKLIST } from "./types";
import { select } from "./validate";
import { createView, refresh } from "./views";
import type { ViewSource } from "./views";
import type { Run, RunEvent, UiElements } from "../run/types";
import type { Step, Walkthrough } from "../walkthrough/types";

const NO_UI: UiElements = { dialog: null, beacon: null };

const isSteps = <TStep extends Step>(
  walkthrough: Walkthrough<TStep> | readonly TStep[],
): walkthrough is readonly TStep[] => Array.isArray(walkthrough);

export function createChecklists<
  TContext = {},
  const TTasks extends TaskMap<NoInfer<TContext>> = TaskMap<TContext>,
  const TSelections extends ChecklistSelections<TTasks> =
    DefaultChecklists<TTasks>,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- passed by an adapter, never inferred.
  TShape = Task<TContext>,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- passed by an adapter, never inferred.
  TStepShape extends Step = Step,
>(
  config: ChecklistsConfig<
    TContext,
    TTasks,
    TSelections,
    NoInfer<TShape>,
    NoInfer<TStepShape>
  >,
): Checklists<TContext, TTasks, TSelections> {
  type Tasks = TaskMap<TContext>;
  type Selections = ChecklistSelections<Tasks>;
  type Named = NamedTask<Tasks>;
  type Active = ActiveTask<Named>;
  type Event = ChecklistsEvent<Tasks, Selections>;

  type StopReason = Extract<Event, { type: "taskStopped" }>["reason"];

  type State = Readonly<{
    record: Stored;
    active: Active | null;
    startedFrom: string | undefined;
  }>;

  type Flags = Readonly<{
    from?: string | undefined;
    silent?: boolean;
    persist?: boolean;
  }>;

  const tasks: Tasks = config.tasks;
  const named = dictionary<Named>();
  for (const [id, task] of Object.entries(tasks)) named[id] = { ...task, id };
  const taskList = Object.values(named);
  const selected = select(
    named,
    config.checklists ?? { [DEFAULT_CHECKLIST]: Object.keys(tasks) },
  );
  const { onChange, onEvent, run: runOptions, storage } = config;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every event carries one of these Tasks, so it is the event the handler is typed for.
  const emit = onEvent as ((event: Event) => void) | undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every Run's steps come from these Tasks, so its events carry the steps the handler is typed for.
  const onRunEventOption = runOptions?.onEvent as
    | ((event: RunEvent) => void)
    | undefined;

  // Snapshots hand back each Task as written, so checked Walkthroughs live apart.
  const walkthroughs = dictionary<Walkthrough>();
  for (const [id, { walkthrough }] of Object.entries(tasks)) {
    if (walkthrough === undefined) continue;
    walkthroughs[id] = isSteps(walkthrough)
      ? checkedWalkthrough(walkthrough, `Task "${id}": `)
      : walkthrough;
  }

  const progress = createProgress(storage?.load() ?? config.stored);
  let active: Active | null = null;
  let startedFrom: string | undefined;
  let ownerSnapshot: ChecklistsSnapshot<Tasks> = {
    active: null,
  };
  const ownerListeners = new Set<
    (snapshot: ChecklistsSnapshot<Tasks>) => void
  >();
  let boundUi: (() => UiElements) | undefined;

  const source: ViewSource<Named> = {
    status: progress.status,
    active: () => active,
  };
  const views = selected.map(([name, viewTasks]) =>
    createView(name, viewTasks, source),
  );

  const queue = createQueue("Checklist callbacks failed.");

  const current = (): State => ({ record: progress.record(), active, startedFrom });

  const commit = (run: () => void, flags: Flags) => {
    const before = current();
    run();
    const after = current();

    // Every snapshot is updated before any callback runs, so a callback that
    // reads another view sees this change too.
    const { changed, completed } = refresh(views, source);
    const activeChanged = after.active !== before.active;
    if (activeChanged) ownerSnapshot = { active: after.active };
    // Exited last, once `subscribeActive` listeners have moved off it, so they
    // never see it exit.
    const stopped = activeChanged ? before.active : null;
    const exit =
      stopped !== null && stopped.run.getSnapshot().phase !== "completed";

    for (const view of changed) queue.notify(view.listeners, view.snapshot);
    if (activeChanged) queue.notify(ownerListeners, ownerSnapshot);
    if (after.record !== before.record && flags.persist !== false) {
      queue.invoke(() => storage?.save(after.record));
      queue.invoke(() => onChange?.(after.record));
    }
    if (flags.silent !== true) {
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

  const send = (run: () => void, flags: Flags = {}) =>
    queue.run(() => commit(run, flags));

  const fromView = (checklist: string | undefined) =>
    checklist === undefined ? {} : { checklist };

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
    for (const task of taskList) {
      const was = statusIn(before.record, task.id);
      const now = statusIn(after.record, task.id);
      if (was === now) continue;
      if (now === "done") {
        events.push({ type: "taskComplete", task });
      } else if (now === "skipped") {
        const guided = before.active?.task.id === task.id;
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

  const release = () => {
    if (active === null) return;
    const { task, run } = active;
    // A subscriber may release the Run before its finish event reaches us.
    if (run.getSnapshot().phase === "completed" && task.isComplete === undefined)
      progress.set(task.id, "done");
    active = null;
    startedFrom = undefined;
  };

  // Not through `subscribe`: subscribing switches on page watching.
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

  // Every condition is checked before anything is recorded, so a throwing
  // check changes nothing.
  const checkConditions = (context: TContext) => {
    const complete: string[] = [];
    const settled: string[] = [];
    for (const { id, isComplete } of taskList) {
      if (isComplete === undefined || progress.status(id) === "done") continue;
      const met = isComplete(context);
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

  // Silent: an `onEvent` handler cannot use the owner before this returns, and
  // a reload must not announce completion that storage already had.
  const initial = config.context;
  if (initial !== undefined) {
    send(() => checkConditions(initial), { silent: true });
  }

  const checklists = dictionary<Checklist<Named>>();
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the owner is built against its Tasks widened to `Task<TContext>`; these are the exact Tasks and selections it was given.
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
