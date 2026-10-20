import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import { inDevelopment } from "../dev";
import { problemReporter, recordUnreadable } from "../problems";
import { createQueue } from "../queue";
import type { Asked, Change, Facts, Given, Live, Phases, Recorded, Work } from "../state";
import { adapterOf } from "../storage/adapter";
import { createLink } from "../storage/link";
import { changesBetween, parseRecord, storedRecord } from "../storage/records";
import type { Parsed, StoredRecord } from "../storage/records";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import { runChange } from "./change";
import type { Ran } from "./change";
import { createPage } from "./page";
import { heard, loaded, LOADING, READ, recordedAt, refused, replaced } from "./record";
import { conditions, eventsBetween, isComplete, markDone, markTodo, skip, startFrom, taskOf, tasksOf, toggle } from "./tasks";
import type { Run, RunOptions, RunSnapshot } from "./types";
import { checklistView, collapsedOf, runView } from "./views";
import type { View } from "./views";
import { act, openId, openOf, request, reset, start, unwait, wait } from "./walkthroughs";

type Handle = Readonly<{
  definition: ChecklistDefinition<AnyTask>;
  view: View<ChecklistSnapshot<AnyTask>>;
  listeners: Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>;
  checklist: Checklist<AnyTask>;
}>;

const toRecord =
  (write: (recorded: Recorded, change: Change, facts: Facts) => Recorded): Work =>
  (facts, change) => {
    const recorded = write(facts.recorded, change, facts);
    return recorded === facts.recorded ? facts : { ...facts, recorded };
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

  let given: Given = { walkthroughs: new Map(), groups: [], context: options.context };
  let recorded = recordedAt(adapter === undefined && options.initial === undefined ? READ : LOADING);
  let asked: Asked = { waiting: [], startedFrom: new Map() };
  let live: Live = { visit: undefined, beacons: new Map() };
  const held: Work[] = [];
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  const handles = new Map<ChecklistDefinition<AnyTask>, Handle>();

  const facts = (): Facts => ({ given, recorded, asked, live });
  const loading = () => recorded.storage.type === "loading";

  const verdicts: Change["verdicts"] = (tasks, context) => {
    try {
      return new Map(tasks.map((task) => [task.id, task.isComplete?.(context) === true]));
    } catch (error) {
      queue.fail("isComplete", error);
      return undefined;
    }
  };

  const collapsedNow = collapsedOf();
  const view = runView(collapsedNow, facts());
  const change = (phases: Phases) => queue.run(() => commit(phases));
  const page = createPage({ root, queue, facts, change, commitNow: (phases) => commit(phases), collapsedNow });

  const save = ({ savedFrom, after }: Ran) => {
    const now = after.recorded;
    const changes =
      savedFrom === "whole"
        ? { ...storedRecord(now.progress, now.statuses), replace: true as const }
        : savedFrom.progress === now.progress && savedFrom.statuses === now.statuses
          ? undefined
          : changesBetween(savedFrom, now);
    if (changes === undefined) return;
    link.save(changes);
    const { onChange } = options;
    if (onChange !== undefined) {
      const stored = storedRecord(now.progress, now.statuses);
      queue.callApp("onChange", () => onChange(stored));
    }
  };

  const announce = ({ after, announcedFrom, told }: Ran) => {
    const { onEvent } = options;
    if (onEvent === undefined) return;
    for (const event of told.events) queue.callApp("onEvent", () => onEvent(event));
    if (announcedFrom === undefined) return;
    const credit = (id: string) => told.credits.get(id);
    for (const event of eventsBetween(tasksOf(after.given.groups), announcedFrom, after.recorded, credit)) {
      queue.callApp("onEvent", () => onEvent(event));
    }
    for (const { definition, view: shown } of handles.values()) {
      if (isComplete(definition, announcedFrom.statuses) || !isComplete(definition, after.recorded.statuses)) continue;
      const snapshot = shown.current();
      queue.callApp("onEvent", () => onEvent({ type: "checklistComplete", checklist: definition.name, snapshot }));
    }
  };

  function commit(phases: Phases) {
    const ran = runChange(facts(), phases, Date.now(), verdicts);
    const { after } = ran;
    recorded = after.recorded;
    asked = after.asked;
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
    const known = given.walkthroughs.get(walkthrough.id);
    if (known === undefined) {
      given = { ...given, walkthroughs: new Map(given.walkthroughs).set(walkthrough.id, walkthrough) };
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
    change({ storage: toRecord((was, told) => replaced(was, value, told)), arrival: true, whole: true });
  };

  const takeRecord = (read: Parsed | "failed") =>
    queue.run(() =>
      commit({ storage: toRecord((was, told) => loaded(was, read, told)), arrival: true, commands: held.splice(0) }),
    );

  const link = createLink({
    adapter,
    queue,
    report,
    given: options.initial !== undefined,
    loading,
    loaded: takeRecord,
    heard: (value) => {
      const parsed = parseRecord(value);
      change({ storage: toRecord((was, told, at) => heard(was, parsed, openId(at), at.given.walkthroughs, told)) });
      if (parsed.ok) change({ arrival: true });
    },
    refused: (error) => change({ storage: toRecord((was) => refused(was, error)) }),
  });

  if (options.initial !== undefined) takeRecord(parseRecord(options.initial));
  /** What a server render shows: it cannot see the browser's storage. */
  const server = facts();
  const serverSnapshot = view.current();

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    if (given.groups.includes(group)) return;
    for (const task of group.tasks) if (task.walkthrough !== undefined) take(task.walkthrough);
    given = { ...given, groups: [...given.groups, group] };
    for (const definition of group.checklists) handleOf(definition);
    if (!loading()) change({ arrival: true });
  };

  function handleOf(definition: ChecklistDefinition<AnyTask>): Handle {
    const known = handles.get(definition);
    if (known !== undefined) return known;
    const { name, group } = definition;
    const shown = checklistView(definition, facts());
    const serverShown = checklistView(definition, server).current();
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
          const walkthrough = taskOf(given.groups, id)?.walkthrough;
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
      asked = wait(asked, taken.id);
      command(request(taken));
      return () => {
        asked = unwait(asked, taken.id);
      };
    },
    act: (action, walkthrough) => {
      if (walkthrough !== undefined) {
        command(act(action, take(walkthrough)));
      } else if (loading()) {
        command(act(action, undefined));
      } else {
        // The one open at the call, as the app saw it.
        const on = openOf(facts());
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
      if (Object.is(next, given.context)) return;
      given = { ...given, context: next };
      // Not held: only the latest context matters, and the load asks the conditions once the record is in.
      if (!loading()) change({ commands: [conditions] });
    },
    checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      handleOf(definition).checklist as Checklist<TTask>,
    skipTask: (id) => command(skip(id, undefined)),
  };
}
