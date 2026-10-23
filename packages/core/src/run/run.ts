import { groupOf } from "../checklists/checklists";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import { inDevelopment } from "../dev";
import { problemReporter, recordUnreadable } from "../problems";
import { createQueue } from "../queue";
import type { Change, Command, Effect, Given, Model, Msg } from "../state";
import { adapterOf } from "../storage/adapter";
import { createLink } from "../storage/link";
import { parseRecord } from "../storage/records";
import type { StoredRecord } from "../storage/records";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import { createPage } from "./page";
import { LOADING, READY, userRecordAt } from "./record";
import { taskOf } from "./tasks";
import type { Run, RunOptions, RunSnapshot } from "./types";
import { initialModel, runStateOf, update } from "./update";
import { viewChecklist } from "./views";
import { openOf } from "./walkthroughs";

/** What the app holds of one checklist: who listens, and the object `run.checklist` hands back. */
type Handle = Readonly<{
  listeners: Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>;
  checklist: Checklist<AnyTask>;
}>;

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

  // Written only by the calls below that hand something over.
  let given: Given = {
    walkthroughsAndChecklistsInUse: { walkthroughsById: new Map(), checklistDefinitions: [] },
    checklistContext: options.context,
    checklistsAsked: new Map(),
  };
  // Written only by `step`.
  let model: Model = initialModel(given, userRecordAt(adapter === undefined && options.initial === undefined ? READY : LOADING));
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  const handles = new Map<ChecklistDefinition<AnyTask>, Handle>();

  const runState = () => runStateOf(model, given);
  const loading = () => model.userRecord.storageStatus.type === "loading";
  const getSnapshot = () => model.views.run.snapshot.value;

  const verdicts: Change["verdicts"] = (tasks, context) => {
    try {
      return new Map(tasks.map((task) => [task.id, task.isComplete?.(context) === true]));
    } catch (error) {
      queue.fail("isComplete", error);
      return undefined;
    }
  };

  /** Through the queue, so a Msg sent from a callback waits until the change that called it has finished. */
  const send = (msg: Msg) => queue.run(() => step(msg));

  const page = createPage({ root, queue, runState, candidates: () => model.views.run.candidates.value, send, sendNow: step });

  const link = createLink({
    adapter,
    queue,
    report,
    hasInitial: options.initial !== undefined,
    loading,
    loaded: (read) => send({ _tag: "loaded", read }),
    heard: (value) => {
      const read = parseRecord(value);
      send({ _tag: "heard", read });
      if (read.ok) send({ _tag: "arrived" });
    },
    refused: (error) => send({ _tag: "refused", error }),
  });

  /** The app's record in place of one Waymark could not read, with what this tab holds on top, saved whole. */
  const replace = (replacement: StoredRecord | null) => {
    const parsed = parseRecord(replacement);
    if (!parsed.ok) throw new Error(`Waymark cannot take the record given to replace. ${parsed.error.message}`);
    send({ _tag: "replaced", read: parsed.value });
  };

  /** One Msg: the next model, then its effects, in the order `update` gives them. */
  function step(msg: Msg) {
    const next = update(model, given, msg, { now: Date.now(), verdicts });
    model = next.model;
    perform(next.effects);
  }

  function perform(effects: readonly Effect[]) {
    for (const effect of effects) {
      switch (effect._tag) {
        case "scroll":
          effect.element.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        case "syncPage":
          page.sync();
          break;
        case "notifyRun":
          queue.notify(listeners, effect.snapshot);
          break;
        case "notifyChecklist": {
          const handle = handles.get(effect.checklist);
          if (handle !== undefined) queue.notify(handle.listeners, effect.snapshot);
          break;
        }
        case "save":
          link.save(effect.changes);
          break;
        case "saved": {
          const { onChange } = options;
          const { record } = effect;
          if (onChange !== undefined) queue.callApp("onChange", () => onChange(record));
          break;
        }
        case "recordUnreadable": {
          const { error } = effect;
          queue.invoke(() => report(recordUnreadable(error, error.stored, replace)));
          break;
        }
        case "problem": {
          const { problem } = effect;
          queue.invoke(() => report(problem));
          break;
        }
        case "event": {
          const { onEvent } = options;
          const { event } = effect;
          if (onEvent !== undefined) queue.callApp("onEvent", () => onEvent(event));
          break;
        }
      }
    }
  }

  if (options.initial !== undefined) send({ _tag: "loaded", read: parseRecord(options.initial) });
  /** What a server render shows: it cannot see the browser's storage. */
  const server = runState();
  const serverSnapshot = getSnapshot();

  /** The Run's definition for this id; another under an id already taken is a mistake. */
  const take = (walkthrough: Walkthrough): Walkthrough => {
    const inUse = given.walkthroughsAndChecklistsInUse;
    const known = inUse.walkthroughsById.get(walkthrough.id);
    if (known === undefined) {
      const walkthroughsById = new Map(inUse.walkthroughsById).set(walkthrough.id, walkthrough);
      given = { ...given, walkthroughsAndChecklistsInUse: { ...inUse, walkthroughsById } };
      return walkthrough;
    }
    if (known !== walkthrough && inDevelopment()) {
      throw new Error(
        `Walkthrough "${walkthrough.id}" was handed to the Run by two different definitions. Define each walkthrough once, outside render, and give each its own id.`,
      );
    }
    return known;
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    if (given.walkthroughsAndChecklistsInUse.checklistDefinitions.includes(group)) return;
    for (const task of group.tasks) if (task.walkthrough !== undefined) take(task.walkthrough);
    const inUse = given.walkthroughsAndChecklistsInUse;
    given = { ...given, walkthroughsAndChecklistsInUse: { ...inUse, checklistDefinitions: [...inUse.checklistDefinitions, group] } };
    for (const definition of group.checklists) handleOf(definition);
    send({ _tag: "arrived" });
  };

  function handleOf(definition: ChecklistDefinition<AnyTask>): Handle {
    const known = handles.get(definition);
    if (known !== undefined) return known;
    const { name } = definition;
    const group = groupOf(definition);
    const first = viewChecklist(definition, group, undefined, runState());
    const serverShown = viewChecklist(definition, group, undefined, server).value;
    given = { ...given, checklistsAsked: new Map(given.checklistsAsked).set(definition, { group, first }) };
    const current = () => (model.views.checklists.get(definition) ?? first).value;
    const listening = new Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>();
    const on = (command: (task: string) => Command) => (task: string) => {
      join(group);
      send(command(task));
    };
    const handle: Handle = {
      listeners: listening,
      checklist: {
        getSnapshot: current,
        getServerSnapshot: () => serverShown,
        subscribe: (listener) => {
          join(group);
          return listen(queue, listening, current)(listener);
        },
        start: (task) => {
          join(group);
          const walkthrough = taskOf(given.walkthroughsAndChecklistsInUse.checklistDefinitions, task)?.walkthrough;
          if (walkthrough !== undefined) send({ _tag: "start", walkthrough: take(walkthrough), fromChecklist: name });
        },
        markDone: on((task) => ({ _tag: "markDone", task })),
        markTodo: on((task) => ({ _tag: "markTodo", task, checklist: name })),
        skip: on((task) => ({ _tag: "skip", task, checklist: name })),
        toggle: on((task) => ({ _tag: "toggle", task, checklist: name })),
      },
    };
    handles.set(definition, handle);
    return handle;
  }

  return {
    start: (walkthrough) => send({ _tag: "start", walkthrough: take(walkthrough), fromChecklist: undefined }),
    requestStart: (walkthrough) => {
      const taken = take(walkthrough);
      send({ _tag: "requestStart", walkthrough: taken });
      return () => send({ _tag: "withdrawRequest", walkthrough: taken.id });
    },
    act: (action, walkthrough) => {
      if (walkthrough !== undefined) {
        send({ _tag: "act", action, walkthrough: take(walkthrough) });
      } else if (loading()) {
        send({ _tag: "act", action, walkthrough: undefined });
      } else {
        // The one open at the call, as the caller saw it.
        const on = openOf(runState());
        if (on !== undefined) send({ _tag: "act", action, walkthrough: on.walkthrough });
      }
    },
    reset: (walkthrough) => send({ _tag: "reset", walkthrough: take(walkthrough) }),
    getSnapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: listen(queue, listeners, getSnapshot),
    attach: page.attach,
    connect: link.connect,
    setContext: (next) => {
      if (Object.is(next, given.checklistContext)) return;
      given = { ...given, checklistContext: next };
      send({ _tag: "contextChanged" });
    },
    checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      handleOf(definition).checklist as Checklist<TTask>,
    skipTask: (task) => send({ _tag: "skip", task, checklist: undefined }),
  };
}
