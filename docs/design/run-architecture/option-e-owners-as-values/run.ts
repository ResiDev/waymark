// Sketch for packages/core/src/run/run.ts, about 280 lines. Not compiled.
//
// The shell. Holds the one `let state`, the snapshots last published, the
// queue, the listeners, the adapter, the commands held while loading, and the
// context. Runs every change through `commit`, which is the one place the
// order of a change is written down. Everything that decides anything is in
// the owner files; this file wires them and talks to the outside.

import { createQueue } from "../queue";
import { adapterOf, loadFrom, saveTo } from "../storage/adapter";
import { parseRecord, storedRecord } from "../storage/records";
import type { Parsed, Read } from "../storage/records";
import { listen } from "../subscribe";
import { problemReporter, recordUnreadable, storageFailed } from "../problems";
import * as Bc from "./beacons";
import { flagsOf, openChange } from "./change";
import type { Source } from "./change";
import * as C from "./checklists";
import type { RunState, Work } from "./model";
import { changesOf, initial, seenOf, selectRun, settle } from "./model";
import { createPage } from "./page";
import type { Run, RunOptions, RunSnapshot } from "./types";
import * as W from "./walkthroughs";

export function createRun(options: RunOptions = {}): Run {
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  let state: RunState = initial(adapter !== undefined && options.initial === undefined ? "loading" : "ready");
  let snapshot: RunSnapshot = selectRun(state, { storageStatus: state.storageStatus, progress: state.walkthroughs.progress, open: null, beacons: [] });
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  /** Each checklist's handle: its listeners and the snapshots last published and served. */
  const handles = new Map(/* ChecklistDefinition → { checklist, snapshot, serverSnapshot, listeners } */);
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];
  let context = options.context;

  const page = createPage({
    root: () => options.root ?? document,
    open: () => state.walkthroughs.open,
    collapsed: () => W.collapsed(state.walkthroughs),
    send: (message) => change((s, c) => ({ ...s, walkthroughs: W.obey(s.walkthroughs, message, c) })),
    sightBeacons: (reads, now) => change((s) => ({ ...s, sightings: Bc.look(s.sightings, reads, W.collapsed(s.walkthroughs), now) })),
    attached: (attached) =>
      change((s, c) => ({
        ...s,
        walkthroughs: W.setAttached(s.walkthroughs, attached, c),
        sightings: attached ? s.sightings : Bc.detached(s.sightings),
      })),
    fail: queue.fail,
  });

  const change = (work: Work, source: Source = "command") => queue.run(() => commit(work, source));

  /**
   * One change, from its work to its announcement. The state side is pure
   * (`work`, then `settle`); everything after `state = next` talks to the
   * outside, in this order, which is load-bearing.
   */
  function commit(work: Work, source: Source): void {
    const before = state;
    const [c, gather] = openChange(Date.now(), page.attached());
    const settled = settle(work(before, c), before, c);
    const [walkthroughs, look] = W.firstLook(settled.walkthroughs);
    const next = walkthroughs === settled.walkthroughs ? settled : { ...settled, walkthroughs };
    const { events, problems, credits, scrolls } = gather();
    const flags = flagsOf(source);

    // Every snapshot is in before any callback runs, so a callback that reads another sees this change too.
    state = next;
    const previous = snapshot;
    snapshot = selectRun(next, previous);
    // TODO: when seenOf(next) has the same four objects as seenOf(before), skip the checklists:
    // no frame-loop change can move one. Else select each handle's snapshot, noting changed and completed.

    // TODO, in order:
    // for (const to of scrolls) to.scrollIntoView({ behavior: "smooth", block: "center" });
    // page.sync();                        // always: a frame that has just fired must be asked for again
    // if (look) page.look(look);          // a walkthrough just drawn: its first look, then `start`
    // if (snapshot !== previous) queue.notify(listeners, snapshot); then each changed checklist's listeners
    // if (flags.persist) save(changesOf(before, next))
    // for (const problem of problems) queue.invoke(() => report(problem));   // after notify
    // onEvent: events; then, unless flags.silent, C.eventsOf(...) and each checklistComplete
    throw new Error("not implemented");
  }

  /** While the record loads, a command waits, so it acts on the user's progress rather than none. */
  const later = (command: () => void) => (state.storageStatus === "loading" ? held.push(command) : command());

  /** The Run's definition for this id. Taken at the call, so a clash throws where it was handed over. */
  const take = (walkthrough: Parameters<Run["start"]>[0]) => {
    const { walkthroughs, taken, clash } = W.take(state.walkthroughs, walkthrough);
    // TODO: clash && inDevelopment() → throw the two-definitions error.
    state = { ...state, walkthroughs };
    return taken;
  };

  /** The app's conditions, asked here so no author code runs inside a change. A throw is reported, and nothing is recorded. */
  const verdicts = (s: RunState): C.Verdicts => {
    throw new Error("not implemented");
  };

  const conditions = (source: Source) =>
    change((s) => ({ ...s, checklists: C.settleConditions(s.checklists, verdicts(s)) }), source);

  // Loading and hearing: storage's half, here because it is all talking to the outside.

  const load = (read: Parsed<Read> | "failed") => {
    change((s, c) => {
      if (read !== "failed" && read.ok) {
        return {
          ...s,
          walkthroughs: W.restore(s.walkthroughs, read.value?.walkthroughs ?? {}),
          checklists: C.restore(s.checklists, read.value?.tasks ?? {}),
          storageStatus: "ready",
        };
      }
      if (read !== "failed") c.problem(recordUnreadable(read.error));
      return { ...s, storageStatus: "error" };
    }, "storage");
    change((s, c) => {
      let walkthroughs = s.walkthroughs;
      for (const walkthrough of walkthroughs.definitions.values()) walkthroughs = W.arrive(walkthroughs, walkthrough, c);
      return { ...s, walkthroughs, checklists: C.settleConditions(s.checklists, verdicts(s)) };
    }, "arrival");
  };

  const hear = (value: unknown) => {
    // TODO: parse; unreadable → report. Else one "storage" change with W.hear and C.restore,
    // then conditions("arrival"): a Task held done by its condition stays done.
  };

  // TODO: initial record, server snapshot before the adapter is read, loadFrom(adapter, …), adapter.subscribe(hear),
  // then run every held command in order.

  return {
    start: (walkthrough) => {
      const taken = take(walkthrough);
      later(() => change((s, c) => ({ ...s, walkthroughs: W.start(W.arrive(s.walkthroughs, taken, c), taken, c) })));
    },
    requestStart: (walkthrough) => {
      const taken = take(walkthrough);
      let withdrawn = false;
      later(() => {
        if (!withdrawn) change((s, c) => ({ ...s, walkthroughs: W.request(W.arrive(s.walkthroughs, taken, c), taken, c) }));
      });
      return () => {
        withdrawn = true;
        state = { ...state, walkthroughs: W.withdraw(state.walkthroughs, taken) };
      };
    },
    act: (action, walkthrough) => {
      const given = walkthrough === undefined ? undefined : take(walkthrough);
      later(() => {
        // The one open as the command runs, so a command held while loading acts on what loaded.
        const target = given ?? state.walkthroughs.open?.walkthrough;
        if (target !== undefined) change((s, c) => ({ ...s, walkthroughs: W.act(s.walkthroughs, target, action, c) }));
      });
    },
    reset: (walkthrough) => {
      const taken = take(walkthrough);
      later(() => change((s, c) => ({ ...s, walkthroughs: W.act(s.walkthroughs, taken, "reset", c) })));
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => {
      throw new Error("not implemented");
    },
    subscribe: listen(queue, listeners, () => snapshot),
    attach: page.attach,
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (state.storageStatus !== "loading") conditions("command");
    },
    checklist: (definition) => {
      // TODO: the handle for this definition, made once. Its commands are `later(() => change(...))`
      // over C's transitions; its `start` composes W.start with C.startedFrom.
      throw new Error("not implemented");
    },
    // Two owners in one change: the Task's status, and its walkthrough's exit.
    skipTask: (id) =>
      later(() =>
        change((s, c) => {
          const walkthrough = s.checklists.tasks.get(id)?.walkthrough;
          const known = walkthrough === undefined ? undefined : s.walkthroughs.definitions.get(walkthrough.id);
          return {
            ...s,
            checklists: C.skip(s.checklists, id, undefined, c),
            walkthroughs: known === undefined ? s.walkthroughs : W.act(s.walkthroughs, known, "exit", c),
          };
        }),
      ),
  };
}
