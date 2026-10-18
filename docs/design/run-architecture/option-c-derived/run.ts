// Sketch for packages/core/src/run/run.ts. Not compiled.
//
// `createRun`: the order every change is announced in, the public Run, and
// the checklists' handles. It holds what is neither the Model nor the page:
// the context, held commands, listeners, the checklists that reached it, and
// what it last showed.

import { statusIn } from "../checklists/record";
import { eventsBetween } from "../checklists/tasks";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup } from "../checklists/types";
import { createView, refresh } from "../checklists/views";
import type { View, ViewSource } from "../checklists/views";
import { problemReporter, recordUnreadable, storageFailed } from "../problems";
import { createQueue } from "../queue";
import { adapterOf, loadFrom, saveTo } from "../storage/adapter";
import { changesBetween, parseRecord, storedRecord } from "../storage/records";
import type { Parsed, Read, StoredChanges } from "../storage/records";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import {
  actOn,
  begin,
  conditions,
  createModel,
  hear,
  load,
  markDone,
  markTodo,
  meetGroup,
  obey,
  request,
  resetOne,
  seeBeacons,
  setAttached,
  settle,
  skip,
  startTask,
  toggle,
  withdraw,
} from "./change";
import type { Change } from "./change";
import { canonical, momentOf, openWalkthrough, show } from "./model";
import type { Model, Seen, Shown } from "./model";
import { createPage } from "./page";
import type { Message } from "./rules";
import type { Run, RunOptions, RunSnapshot } from "./types";

/** A checklist definition's view and handle, made together, so one map serves both. */
type Handle = Readonly<{ view: View<AnyTask>; checklist: Checklist<AnyTask> }>;

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
export function createRun(options: RunOptions = {}): Run {
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);
  const { model, open } = createModel(
    adapter !== undefined && options.initial === undefined ? "loading" : "ready",
    (error) => queue.fail("isComplete", error),
  );

  let context = options.context;
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  /** The checklists that have reached the Run, each with every Task and checklist defined beside it. */
  const groups = new Set<ChecklistGroup>();
  const handles = new Map<ChecklistDefinition<AnyTask>, Handle>();
  let shown: Shown = show(undefined, model);

  const page = createPage({
    root: () => options.root ?? document,
    model: () => model,
    send,
    seeBeacons: (reads, now) => change((c) => seeBeacons(c, reads, now)),
    setAttached: (attached) => change((c) => setAttached(c, attached)),
    fail: queue.fail,
  });

  /**
   * Makes one change and announces it. The order is load-bearing:
   *  1. open the change (`before`, and its own events, problems and credits);
   *  2. the work;
   *  3. `settle`: a waiting request, the open walkthrough's machine, finished Tasks, credits pruned;
   *  4. snapshots: the Run's, then every checklist view's, all before any callback runs;
   *  5. the page: scroll, watchers, the first look (queued, so it runs as its own change);
   *  6. notify Run listeners, then view listeners;
   *  7. save what differs from `savedFrom`, and hand the record to `onChange`;
   *  8. problems, after notify, so a handler sees a renderer that has redrawn;
   *  9. `onEvent`: the walkthroughs' events, then, unless `silent`, the checklists'.
   * `silent`: the change came from storage or a checklist arriving, not the user.
   */
  function commit(work: (change: Change) => void, silent = false): void {
    // TODO
    // const c = open({ attached: page.attached(), context });
    // work(c); settle(c);
    // const after = momentOf(model);
    // const previous = shown.snapshot; shown = show(shown, model);
    // const refreshed = refresh(views());
    // page.afterChange(c);
    // if (shown.snapshot !== previous) queue.notify(listeners, shown.snapshot);
    // for view of refreshed.changed: queue.notify(view.listeners, view.snapshot);
    // const changes = changesBetween(c.savedFrom, after); if (changes) save(changes);
    // for problem of c.problems: queue.invoke(() => report(problem));
    // onEvent: c.events; unless silent: eventsBetween(model.tasks.values(), c.before, after, id => c.credits.get(id)),
    //   then checklistComplete for refreshed.completed.
    // (No `persist` flag: a change that came from storage says so with `inStorage`.)
    throw new Error("not implemented");
  }

  function change(work: (change: Change) => void, silent?: boolean): void {
    queue.run(() => commit(work, silent));
  }

  function send(...messages: Message[]): void {
    change((c) => {
      for (const message of messages) obey(c, message);
    });
  }

  /** While the record loads, a command waits, so it acts on the user's progress rather than none. */
  const later = (command: () => void) => {
    // TODO: model.storageStatus === "loading" ? held.push(command) : command()
    throw new Error("not implemented");
  };

  /**
   * Checks a definition as it is handed over, so a clash throws at the call.
   * The Run only takes it in inside the change (`meet`), where its restored
   * progress is checked against it in the same breath.
   */
  const known = (walkthrough: Walkthrough) => canonical(model, walkthrough);

  // Checklists

  const sourceFor = (definition: ChecklistDefinition<AnyTask>, seen: () => Seen): ViewSource => {
    // TODO, as today's `sourceFor`.
    throw new Error("not implemented");
  };

  const handleOf = (definition: ChecklistDefinition<AnyTask>): Handle => {
    // TODO
    // known handle → it. Otherwise the view, from sourceFor(definition, () => shown.seen) and
    // sourceFor(definition, () => server), and the Checklist whose commands each `join(group)` then
    // later(() => change((c) => startTask / markDone / markTodo / skip / toggle (c, id, definition.name))).
    // `subscribe` joins, then listens.
    throw new Error("not implemented");
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    // TODO
    // if (groups.has(group)) return; groups.add(group);
    // for task with a walkthrough: known(task.walkthrough)          // a clash throws now
    // for definition of group.checklists: handleOf(definition)      // every view refreshes from now on
    // Silent: a checklist reaching the Run must not announce what the user did before.
    // While loading, `load` takes the group in instead.
    // if (model.storageStatus !== "loading") change((c) => meetGroup(c, group), true);
    throw new Error("not implemented");
  };

  const checklist = <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
    handleOf(definition).checklist as Checklist<TTask>;

  // Storage

  /** Storage gets only what changed, so a save never writes over what this Run doesn't know. */
  const save = (changes: StoredChanges) => {
    // TODO, as today: saveTo(adapter, changes, …storageFailed); onChange(storedRecord(model.progress, model.statuses)).
    throw new Error("not implemented");
  };

  /** One change, not two: the record and the definitions already here meet in it, so none is ever shown unchecked. */
  const loaded = (read: Parsed<Read> | "failed") => {
    // TODO
    // try { change((c) => load(c, read, groups), true); for (const command of held.splice(0)) command(); }
    // finally { adapter?.subscribe?.(heard); }
    throw new Error("not implemented");
  };

  const heard = (value: unknown) => {
    // TODO
    // const parsed = parseRecord(value); if (!parsed.ok) return report(recordUnreadable(parsed.error));
    // change((c) => hear(c, parsed.value), true);
    throw new Error("not implemented");
  };

  // TODO, in this order, as today:
  // if (options.initial !== undefined) loaded(parseRecord(options.initial));
  // shown = show(shown, model);
  /** What a server render shows: it cannot see the browser's storage. */
  const server: Seen = shown.seen;
  const serverSnapshot = shown.snapshot;
  // if (adapter !== undefined && options.initial === undefined) loadFrom(adapter, (v) => loaded(parseRecord(v)), …);

  return {
    start: (walkthrough) => {
      known(walkthrough);
      later(() => change((c) => begin(c, walkthrough)));
    },
    requestStart: (walkthrough) => {
      known(walkthrough);
      let withdrawn = false;
      later(() => {
        if (!withdrawn) change((c) => request(c, walkthrough));
      });
      return () => {
        withdrawn = true;
        // A change, not a splice beside one: queued behind a request still waiting
        // to run, it lands after it, so the request cannot come back.
        change((c) => withdraw(c, walkthrough.id), true);
      };
    },
    act: (action, walkthrough) => {
      if (walkthrough !== undefined) known(walkthrough);
      later(() => {
        const target = walkthrough ?? openWalkthrough(model);
        if (target !== undefined) change((c) => actOn(c, target, action));
      });
    },
    reset: (walkthrough) => {
      known(walkthrough);
      later(() => change((c) => resetOne(c, walkthrough)));
    },
    getSnapshot: () => shown.snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: listen(queue, listeners, () => shown.snapshot),
    attach: page.attach,
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (model.storageStatus !== "loading") change(conditions);
    },
    checklist,
    skipTask: (id) => later(() => change((c) => skip(c, id, undefined))),
  };
}
