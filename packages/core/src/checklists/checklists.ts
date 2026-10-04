import { dictionary } from "../dictionary";
import { createQueue } from "../queue";
import { createRun } from "../run/run";
import { loadFrom, reporter, saveTo } from "../storage/adapter";
import {
  DEFAULT_MAX_AGE,
  isCurrent,
  parseChecklistWalkthrough,
  parseTasks,
  storedChecklistWalkthrough,
  storedTasks,
} from "../storage/records";
import type { Parsed, StoredChecklistWalkthrough } from "../storage/records";
import { checkedWalkthrough } from "../walkthrough/walkthrough";
import { createProgress } from "./progress";
import { EMPTY, isEmpty, statusIn } from "./record";
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
  StorageStatus,
  Task,
  TaskMap,
  TaskStatus,
} from "./types";
import { DEFAULT_CHECKLIST } from "./types";
import { select } from "./validate";
import { createView, refresh } from "./views";
import type { View, ViewSource } from "./views";
import type { Run, RunEvent, RunEventType, UiElements } from "../run/types";
import type { Step, Walkthrough } from "../walkthrough/types";

const NO_UI: UiElements = { dialog: null, beacon: null };

const isSteps = <TStep extends Step>(
  walkthrough: Walkthrough<TStep> | readonly TStep[],
): walkthrough is readonly TStep[] => Array.isArray(walkthrough);

const fromView = (checklist: string | undefined) =>
  checklist === undefined ? {} : { checklist };

/** Run events that move the walkthrough to where a reload should pick it up. */
const MOVES: ReadonlySet<RunEventType> = new Set(["advance", "previous", "reset", "collapse", "resume"]);

type Moment<TTask extends { readonly id: string }> = Readonly<{
  record: Stored;
  active: ActiveTask<TTask> | null;
  startedFrom: string | undefined;
  storageStatus: StorageStatus;
}>;

const stopReason = <TTask extends { readonly id: string }>(
  { task, run }: ActiveTask<TTask>,
  before: Moment<TTask>,
  after: Moment<TTask>,
) => {
  if (run.getSnapshot().phase === "completed") return "finished";
  const skipped =
    statusIn(after.record, task.id) === "skipped" &&
    statusIn(before.record, task.id) !== "skipped";
  return skipped ? "skipped" : "stopped";
};

const statusEvent = <TTask>(
  task: TTask,
  was: TaskStatus,
  now: TaskStatus,
  checklist: string | undefined,
) => {
  if (now === "done") return { type: "taskComplete", task } as const;
  if (now === "skipped")
    return { type: "taskSkipped", task, ...fromView(checklist) } as const;
  if (was === "done") return { type: "taskReopened", task } as const;
  return { type: "taskUnskipped", task, ...fromView(checklist) } as const;
};

// A skip from inside guidance counts toward the view whose `start` began it.
const skipCredit = <TTask extends { readonly id: string }>(
  task: TTask,
  before: Moment<TTask>,
  from: string | undefined,
) =>
  from ?? (before.active?.task.id === task.id ? before.startedFrom : undefined);

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

  type State = Moment<Named>;

  type Flags = Readonly<{
    from?: string | undefined;
    silent?: boolean;
    /** False: write neither record, nor call `onChange`. */
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
  const { onChange, onEvent, onStorageError, run: runOptions, storage = {} } = config;
  const { tasks: tasksStorage, walkthrough: walkthroughStorage } = storage;
  const maxAge = storage.maxAge ?? DEFAULT_MAX_AGE;
  const reportTasks = reporter("tasks", onStorageError && ((error) => onStorageError(error, "tasks")));
  const reportWalkthrough = reporter(
    "walkthrough",
    onStorageError && ((error) => onStorageError(error, "walkthrough")),
  );
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

  // Statuses handed in as `initial` are not read again.
  const readsTasks = tasksStorage !== undefined && config.initial === undefined;
  const progress = createProgress();
  let storageStatus: StorageStatus = readsTasks ? "loading" : "ready";
  let active: Active | null = null;
  let startedFrom: string | undefined;
  let lastContext = config.context;
  /** A walkthrough was started or stopped here, so a stored one read later is out of date. */
  let activeChanged = false;
  /**
   * The stored statuses could not be read. They may be fine, as with a newer
   * version, so a condition does not save over them; a change by the user does.
   */
  let storedUnread = false;
  let ownerSnapshot: ChecklistsSnapshot<Tasks> = { active: null, storageStatus };
  const ownerListeners = new Set<
    (snapshot: ChecklistsSnapshot<Tasks>) => void
  >();
  let boundUi: (() => UiElements) | undefined;
  /** Commands given while the statuses load, run in order once they are in. */
  const held: (() => void)[] = [];
  let resolveReady = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const source: ViewSource<Named> = {
    status: progress.status,
    active: () => active,
    storageStatus: () => storageStatus,
  };
  const views = selected.map(([name, viewTasks]) =>
    createView(name, viewTasks, source),
  );

  const queue = createQueue("Checklist callbacks failed.");

  const current = (): State => ({
    record: progress.record(),
    active,
    startedFrom,
    storageStatus,
  });

  const commit = (run: () => void, flags: Flags) => {
    const before = current();
    run();
    const after = current();
    const moved = after.active !== before.active;
    if (moved) activeChanged = true;
    const ownerChanged = moved || after.storageStatus !== before.storageStatus;

    // Every snapshot is updated before any callback runs, so a callback that
    // reads another view sees this change too.
    const { changed, completed } = refresh(views, source);
    if (ownerChanged) ownerSnapshot = { active: after.active, storageStatus: after.storageStatus };
    // Exited last, once `subscribeActive` listeners have moved off it, so they
    // never see it exit.
    const stopped = moved ? before.active : null;
    const exit =
      stopped !== null && stopped.run.getSnapshot().phase !== "completed";

    for (const view of changed) queue.notify(view.listeners, view.snapshot);
    if (ownerChanged) queue.notify(ownerListeners, ownerSnapshot);
    if (flags.persist !== false) {
      if (after.record !== before.record) saveTasks(after.record);
      if (moved) saveWalkthrough(after.active, after.startedFrom);
    }
    if (flags.silent !== true) announce(before, after, flags.from, completed);
    if (exit) queue.invoke(() => stopped.run.act("exit"));
  };

  const send = (run: () => void, flags: Flags = {}) =>
    queue.run(() => commit(run, flags));

  const saveTasks = (record: Stored) => {
    storedUnread = false;
    const stored = storedTasks(record);
    if (tasksStorage) {
      const saved = isEmpty(record) ? null : stored;
      queue.invoke(() => saveTo(tasksStorage, saved, reportTasks));
    }
    queue.invoke(() => onChange?.(stored));
  };

  const saveWalkthrough = (saving: Active | null, from: string | undefined) => {
    if (walkthroughStorage === undefined) return;
    const saved =
      saving && storedChecklistWalkthrough(saving.task.id, from, saving.run.getSnapshot());
    queue.invoke(() => saveTo(walkthroughStorage, saved, reportWalkthrough));
  };

  const announce = (
    before: State,
    after: State,
    from: string | undefined,
    completed: readonly View<Named>[],
  ) => {
    for (const event of eventsBetween(before, after, from))
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
  };

  const eventsBetween = (
    before: State,
    after: State,
    from: string | undefined,
  ): Event[] => {
    const moved = before.active !== after.active;
    const events: Event[] = [];
    if (moved && before.active !== null) {
      const reason = stopReason(before.active, before, after);
      events.push({ type: "taskStopped", task: before.active.task, reason });
    }
    for (const task of taskList) {
      const was = statusIn(before.record, task.id);
      const now = statusIn(after.record, task.id);
      if (was === now) continue;
      const credit = now === "skipped" ? skipCredit(task, before, from) : from;
      events.push(statusEvent(task, was, now, credit));
    }
    if (moved && after.active !== null)
      events.push({ type: "taskStarted", task: after.active.task });
    return events;
  };

  /**
   * While the statuses load, a command waits: run against the empty record, a
   * skip of a Task stored done would undo it.
   */
  const whenLoaded =
    <TArgs extends unknown[]>(command: (...args: TArgs) => void) =>
    (...args: TArgs): void => {
      if (storageStatus === "loading") held.push(() => command(...args));
      else command(...args);
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
    if (event.type === "finish" || event.type === "exit") {
      send(() => {
        if (active?.run === run) release();
      });
      return;
    }
    const moving = active;
    if (moving?.run === run && MOVES.has(event.type) && event.snapshot.phase === "running") {
      queue.run(() => saveWalkthrough(moving, startedFrom));
    }
  };

  const createActiveRun = (
    walkthrough: Walkthrough,
    at?: Readonly<{ step: number; collapsed: boolean }>,
  ) => {
    const run = createRun(walkthrough, {
      ...runOptions,
      startAt: at?.step ?? 0,
      collapsed: at?.collapsed ?? false,
      resumed: at !== undefined,
      ui: () => boundUi?.() ?? NO_UI,
      onEvent: (event) => {
        onRunEvent(run, event);
        onRunEventOption?.(event);
      },
    });
    return run;
  };

  const start = whenLoaded((id: string, from?: string) =>
    send(() => {
      const task = named[id];
      const walkthrough = walkthroughs[id];
      if (task === undefined || walkthrough === undefined) return;
      if (active?.task.id === id) return;
      release();
      active = { task, run: createActiveRun(walkthrough) };
      startedFrom = from;
    }),
  );

  const stop = whenLoaded(() => send(release));

  const markDone = whenLoaded((id: string) =>
    send(() => {
      if (Object.hasOwn(named, id)) progress.set(id, "done");
    }),
  );

  const skip = whenLoaded((id: string, from?: string) =>
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
    ),
  );

  const reopen = (id: string) => {
    const task = named[id];
    const taskStatus = progress.status(id);
    if (task === undefined || taskStatus === "todo") return;
    // A condition that is likely still true would tick the Task straight back.
    const reopened = taskStatus === "done" && task.isComplete !== undefined;
    progress.set(id, reopened ? "reopened" : undefined);
  };

  const markTodo = whenLoaded((id: string) => send(() => reopen(id)));

  const toggle = whenLoaded((id: string, from: string) =>
    send(
      () => {
        if (!Object.hasOwn(named, id)) return;
        if (progress.status(id) === "todo") progress.set(id, "done");
        else reopen(id);
      },
      { from },
    ),
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

  // Not held: only the latest context matters, and it is checked once the
  // statuses are in. Against the empty record, a met condition would be undone.
  const update = (context: TContext) => {
    lastContext = context;
    if (storageStatus !== "loading") send(() => checkConditions(context), { persist: !storedUnread });
  };

  /** Statuses from storage, put in place silently and not saved back. */
  const replace = (record: Stored, read: StorageStatus) =>
    send(
      () => {
        progress.replace(record);
        storageStatus = read;
        storedUnread = read === "error";
      },
      { silent: true, persist: false },
    );

  /** Statuses changed elsewhere. One that cannot be read changes nothing. */
  const hear = (value: unknown) => {
    const parsed = parseTasks(value);
    if (parsed.ok) replace(parsed.value ?? EMPTY, "ready");
    else reportTasks(parsed.error);
  };

  const load = whenLoaded(hear);

  const clear = whenLoaded(() => send(() => progress.clear(), { silent: true }));

  /** The Task of a stored walkthrough, if it can be picked up where it was left. */
  const resumable = (saved: StoredChecklistWalkthrough) => {
    const task = named[saved.task];
    const walkthrough = walkthroughs[saved.task];
    if (task === undefined || walkthrough === undefined) return undefined;
    if (progress.status(task.id) !== "todo") return undefined;
    return isCurrent(saved, walkthrough.steps.length, maxAge) ? { task, walkthrough } : undefined;
  };

  /** The walkthrough record, once read, until the statuses are in to check it against. */
  let unrestored: { value: unknown } | undefined;

  // A walkthrough started or stopped first wins: the record is from before it.
  // One that cannot be picked up again is wiped, so it is not read again.
  const restore = () => {
    if (storageStatus === "loading" || unrestored === undefined) return;
    const parsed = parseChecklistWalkthrough(unrestored.value);
    unrestored = undefined;
    if (activeChanged || (parsed.ok && parsed.value === null)) return;
    if (!parsed.ok) reportWalkthrough(parsed.error);
    const saved = parsed.ok ? parsed.value : null;
    const resumed = saved && resumable(saved);
    if (!saved || !resumed) {
      queue.run(() => saveWalkthrough(null, undefined));
      return;
    }
    const from = views.some((view) => view.name === saved.from) ? saved.from : undefined;
    // Silent: a reload does not start the Task again, it picks it up.
    send(
      () => {
        active = { task: resumed.task, run: createActiveRun(resumed.walkthrough, saved) };
        startedFrom = from;
      },
      { silent: true, persist: false },
    );
  };

  /** The statuses are in: read, or not. A failure starts every Task todo. */
  const settleTasks = (parsed: Parsed<Stored>) => {
    if (!parsed.ok) reportTasks(parsed.error);
    // `ready` settles even if a listener throws on hearing the statuses.
    try {
      if (parsed.ok) replace(parsed.value ?? EMPTY, "ready");
      else replace(EMPTY, "error");
      // Silent: a reload must not announce completion storage already had,
      // and at creation an `onEvent` handler cannot use the owner yet.
      const context = lastContext;
      if (context !== undefined)
        send(() => checkConditions(context), { silent: true, persist: !storedUnread });
      for (const command of held.splice(0)) command();
      restore();
    } finally {
      tasksStorage?.subscribe?.(hear);
      resolveReady();
    }
  };

  if (!readsTasks) settleTasks(parseTasks(config.initial));
  // What a server render shows: it cannot see the browser's storage.
  for (const view of views) view.serverSnapshot = view.snapshot;
  const serverSnapshot = ownerSnapshot;
  if (readsTasks) {
    loadFrom(
      tasksStorage,
      (value) => settleTasks(parseTasks(value)),
      (error) => settleTasks({ ok: false, error }),
    );
  }
  if (walkthroughStorage) {
    loadFrom(
      walkthroughStorage,
      (value) => {
        unrestored = { value };
        restore();
      },
      reportWalkthrough,
    );
  }

  const checklists = dictionary<Checklist<Named>>();
  for (const view of views) {
    checklists[view.name] = {
      start: (id) => start(id, view.name),
      markDone,
      skip: (id) => skip(id, view.name),
      toggle: (id) => toggle(id, view.name),
      getSnapshot: () => view.snapshot,
      getServerSnapshot: () => view.serverSnapshot,
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
    getServerSnapshot: () => serverSnapshot,
    subscribe,
    subscribeActive: (listener) =>
      followActive(subscribe, () => ownerSnapshot.active, listener),
    ready,
    update,
    load,
    clear,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the owner is built against its Tasks widened to `Task<TContext>`; these are the exact Tasks and selections it was given.
  return owner as unknown as Checklists<TContext, TTasks, TSelections>;
}
