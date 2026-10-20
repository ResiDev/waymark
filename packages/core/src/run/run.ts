import { groupOf } from "../checklists/checklists";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import { inDevelopment } from "../dev";
import { problemReporter, recordUnreadable } from "../problems";
import { createQueue } from "../queue";
import type { StartRequests, Change, RunState, WalkthroughsAndChecklistsInUse, Live, Phases, UserRecord, Work } from "../state";
import { adapterOf } from "../storage/adapter";
import { createLink } from "../storage/link";
import { changesBetween, parseRecord, storedRecord } from "../storage/records";
import type { Parsed, StoredRecord } from "../storage/records";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import { runChange } from "./change";
import type { Ran } from "./change";
import { createPage } from "./page";
import { heard, loaded, LOADING, READY, userRecordAt, refused, replaced } from "./record";
import { conditions, eventsBetween, isComplete, markDone, markTodo, skip, startFrom, taskOf, tasksOf, toggle } from "./tasks";
import type { Run, RunOptions, RunSnapshot } from "./types";
import { checklistView, candidatesOf, runView } from "./views";
import type { View } from "./views";
import { act, openId, openOf, request, reset, start, unwait, wait } from "./walkthroughs";

type Handle = Readonly<{
  definition: ChecklistDefinition<AnyTask>;
  view: View<ChecklistSnapshot<AnyTask>>;
  listeners: Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>;
  checklist: Checklist<AnyTask>;
}>;

const toRecord =
  (write: (userRecord: UserRecord, change: Change, runState: RunState) => UserRecord): Work =>
  (runState, change) => {
    const userRecord = write(runState.userRecord, change, runState);
    return userRecord === runState.userRecord ? runState : { ...runState, userRecord };
  };

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
// The body works on any walkthrough, as one Run holds walkthroughs of many
// step types. TypeScript checks this signature against the one above only
// loosely.
export function createRun(options: RunOptions = {}): Run {
  // Read as late as possible, so a Run can be made on a server, where there is no document.
  const root = () => options.root ?? document;
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  let walkthroughsAndChecklistsInUse: WalkthroughsAndChecklistsInUse = { walkthroughsById: new Map(), checklistDefinitions: [] };
  let checklistContext: unknown = options.context;
  let userRecord = userRecordAt(adapter === undefined && options.initial === undefined ? READY : LOADING);
  let startRequests: StartRequests = { waitingToStart: [], startedFromChecklist: new Map() };
  let live: Live = { openStep: undefined, beaconWaymarks: new Map() };
  const held: Work[] = [];
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  const handles = new Map<ChecklistDefinition<AnyTask>, Handle>();

  const runState = (): RunState => ({ walkthroughsAndChecklistsInUse, checklistContext, userRecord, startRequests, live });
  const loading = () => userRecord.storageStatus.type === "loading";

  const verdicts: Change["verdicts"] = (tasks, context) => {
    try {
      return new Map(tasks.map((task) => [task.id, task.isComplete?.(context) === true]));
    } catch (error) {
      queue.fail("isComplete", error);
      return undefined;
    }
  };

  const candidatesNow = candidatesOf();
  const view = runView(candidatesNow, runState());
  const change = (phases: Phases) => queue.run(() => commit(phases));
  const page = createPage({ root, queue, runState, change, commitNow: (phases) => commit(phases), candidatesNow });

  const save = ({ savedFrom, after }: Ran) => {
    const now = after.userRecord;
    const changes =
      savedFrom === "whole"
        ? { ...storedRecord(now.walkthroughProgressById, now.taskStatusById), replace: true as const }
        : savedFrom.walkthroughProgressById === now.walkthroughProgressById && savedFrom.taskStatusById === now.taskStatusById
          ? undefined
          : changesBetween(
              { progress: savedFrom.walkthroughProgressById, statuses: savedFrom.taskStatusById },
              { progress: now.walkthroughProgressById, statuses: now.taskStatusById },
            );
    if (changes === undefined) return;
    link.save(changes);
    const { onChange } = options;
    if (onChange !== undefined) {
      const stored = storedRecord(now.walkthroughProgressById, now.taskStatusById);
      queue.callApp("onChange", () => onChange(stored));
    }
  };

  const announce = ({ after, announcedFrom, told }: Ran) => {
    const { onEvent } = options;
    if (onEvent === undefined) return;
    for (const event of told.events) queue.callApp("onEvent", () => onEvent(event));
    if (announcedFrom === undefined) return;
    const credit = (id: string) => told.credits.get(id);
    for (const event of eventsBetween(tasksOf(after.walkthroughsAndChecklistsInUse.checklistDefinitions), announcedFrom, after.userRecord, credit)) {
      queue.callApp("onEvent", () => onEvent(event));
    }
    for (const { definition, view: shown } of handles.values()) {
      if (isComplete(definition, announcedFrom.taskStatusById) || !isComplete(definition, after.userRecord.taskStatusById)) continue;
      const snapshot = shown.current();
      queue.callApp("onEvent", () => onEvent({ type: "checklistComplete", checklist: definition.name, snapshot }));
    }
  };

  function commit(phases: Phases) {
    const ran = runChange(runState(), phases, Date.now(), verdicts);
    const { after } = ran;
    userRecord = after.userRecord;
    startRequests = after.startRequests;
    live = after.live;
    for (const element of ran.told.scrolls) element.scrollIntoView({ behavior: "smooth", block: "center" });

    // Every snapshot is up to date before any callback runs, so a callback that reads another sees this change too.
    const was = view.current();
    const snapshot = view.update(after);
    let changed: Handle[] | undefined;
    for (const handle of handles.values()) {
      const last = handle.view.current();
      if (handle.view.update(after) !== last) (changed ??= []).push(handle);
    }
    page.afterChange(after);

    if (snapshot !== was) queue.notify(listeners, snapshot);
    for (const handle of changed ?? []) queue.notify(handle.listeners, handle.view.current());
    save(ran);
    const { unreadable } = ran;
    if (unreadable !== undefined) queue.invoke(() => report(recordUnreadable(unreadable, unreadable.stored, replace)));
    for (const problem of ran.told.problems) queue.invoke(() => report(problem));
    announce(ran);
  }

  /** While the record loads, a command waits, so it acts on the user's progress rather than none. */
  const command = (work: Work) => {
    if (loading()) held.push(work);
    else change({ commands: [work] });
  };

  /** The Run's definition for this id; another under an id already taken is a mistake. */
  const take = (walkthrough: Walkthrough): Walkthrough => {
    const known = walkthroughsAndChecklistsInUse.walkthroughsById.get(walkthrough.id);
    if (known === undefined) {
      const walkthroughsById = new Map(walkthroughsAndChecklistsInUse.walkthroughsById).set(walkthrough.id, walkthrough);
      walkthroughsAndChecklistsInUse = { ...walkthroughsAndChecklistsInUse, walkthroughsById };
      return walkthrough;
    }
    if (known !== walkthrough && inDevelopment()) {
      throw new Error(
        `Walkthrough "${walkthrough.id}" was handed to the Run by two different definitions. Define each walkthrough once, outside render, and give each its own id.`,
      );
    }
    return known;
  };

  /** The app's record in place of one Waymark could not read, with what this tab holds on top, saved whole. */
  const replace = (replacement: StoredRecord | null) => {
    const parsed = parseRecord(replacement);
    if (!parsed.ok) throw new Error(`Waymark cannot take the record given to replace. ${parsed.error.message}`);
    const { value } = parsed;
    change({ storage: toRecord((was, told) => replaced(was, value, told)), arrival: true, replace: true });
  };

  const takeRecord = (read: Parsed | "failed") =>
    queue.run(() =>
      commit({ storage: toRecord((was, told) => loaded(was, read, told)), arrival: true, commands: held.splice(0) }),
    );

  const link = createLink({
    adapter,
    queue,
    report,
    hasInitial: options.initial !== undefined,
    loading,
    loaded: takeRecord,
    heard: (value) => {
      const parsed = parseRecord(value);
      change({ storage: toRecord((was, told, at) => heard(was, parsed, openId(at), at.walkthroughsAndChecklistsInUse.walkthroughsById, told)) });
      if (parsed.ok) change({ arrival: true });
    },
    refused: (error) => change({ storage: toRecord((was) => refused(was, error)) }),
  });

  if (options.initial !== undefined) takeRecord(parseRecord(options.initial));
  /** What a server render shows: it cannot see the browser's storage. */
  const server = runState();
  const serverSnapshot = view.current();

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    if (walkthroughsAndChecklistsInUse.checklistDefinitions.includes(group)) return;
    for (const task of group.tasks) if (task.walkthrough !== undefined) take(task.walkthrough);
    walkthroughsAndChecklistsInUse = { ...walkthroughsAndChecklistsInUse, checklistDefinitions: [...walkthroughsAndChecklistsInUse.checklistDefinitions, group] };
    for (const definition of group.checklists) handleOf(definition);
    if (!loading()) change({ arrival: true });
  };

  function handleOf(definition: ChecklistDefinition<AnyTask>): Handle {
    const known = handles.get(definition);
    if (known !== undefined) return known;
    const { name } = definition;
    const group = groupOf(definition);
    const shown = checklistView(definition, group, runState());
    const serverShown = checklistView(definition, group, server).current();
    const listening = new Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>();
    const on = (work: (id: string) => Work) => (id: string) => {
      join(group);
      command(work(id));
    };
    const handle: Handle = {
      definition,
      view: shown,
      listeners: listening,
      checklist: {
        getSnapshot: shown.current,
        getServerSnapshot: () => serverShown,
        subscribe: (listener) => {
          join(group);
          return listen(queue, listening, shown.current)(listener);
        },
        start: (id) => {
          join(group);
          const walkthrough = taskOf(walkthroughsAndChecklistsInUse.checklistDefinitions, id)?.walkthrough;
          if (walkthrough !== undefined) command(startFrom(take(walkthrough), name));
        },
        markDone: on(markDone),
        markTodo: on((id) => markTodo(id, name)),
        skip: on((id) => skip(id, name)),
        toggle: on((id) => toggle(id, name)),
      },
    };
    handles.set(definition, handle);
    return handle;
  }

  return {
    start: (walkthrough) => command(start(take(walkthrough))),
    requestStart: (walkthrough) => {
      const taken = take(walkthrough);
      startRequests = wait(startRequests, taken.id);
      command(request(taken));
      return () => {
        startRequests = unwait(startRequests, taken.id);
      };
    },
    act: (action, walkthrough) => {
      if (walkthrough !== undefined) {
        command(act(action, take(walkthrough)));
      } else if (loading()) {
        command(act(action, undefined));
      } else {
        const on = openOf(runState());
        if (on !== undefined) command(act(action, on.walkthrough));
      }
    },
    reset: (walkthrough) => command(reset(take(walkthrough))),
    getSnapshot: view.current,
    getServerSnapshot: () => serverSnapshot,
    subscribe: listen(queue, listeners, view.current),
    attach: page.attach,
    connect: link.connect,
    setContext: (next) => {
      if (Object.is(next, checklistContext)) return;
      checklistContext = next;
      // Not held: only the latest context matters, and the load asks the conditions once the record is in.
      if (!loading()) change({ commands: [conditions] });
    },
    checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      handleOf(definition).checklist as Checklist<TTask>,
    skipTask: (id) => command(skip(id, undefined)),
  };
}
