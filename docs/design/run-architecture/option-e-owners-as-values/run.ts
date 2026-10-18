// Sketch for packages/core/src/run/run.ts, about 280 lines. Not compiled.
//
// The shell. Holds the one `let state`, the state a server render sees, what
// the Run and each checklist last published, the commands held while loading,
// the context, and whether an unreadable record was reported (STATE.md has
// each). The connection to storage is the link's; the DOM is the page's. Runs every change through `commit`, which is the one place the
// order of a change is written down. Everything that decides anything is in
// the owner files; this file wires them and talks to the outside.

import { createQueue } from "../queue";
import { adapterOf, saveTo } from "../storage/adapter";
import { parseRecord, storedRecord } from "../storage/records";
import type { Parsed, Read, RecordUnreadableError, StoredRecord } from "../storage/records";
import type { WaymarkProblem } from "../problems";
import { listen } from "../subscribe";
import { entryDropped, problemReporter, recordUnreadable, storageFailed } from "../problems";
import * as Bc from "./beacons";
import { flagsOf, openChange } from "./change";
import type { Source } from "./change";
import * as C from "./checklists";
import type { RunState, Work } from "./model";
import { changesOf, initial, seenOf, selectRun, settle } from "./model";
import { createPage } from "./page";
import type { Run, RunOptions, RunSnapshot } from "./types";
import * as W from "./walkthroughs";
import { createStorageLink } from "../storage/link";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistSnapshot } from "../checklists/types";

/** What the Run and each checklist last published, and who listens. The same shape for both. */
type Published<T> = {
  snapshot: T;
  readonly serverSnapshot: T;
  readonly listeners: Set<(snapshot: T) => void>;
};

export function createRun(options: RunOptions = {}): Run {
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  let state: RunState = initial(adapter !== undefined && options.initial === undefined ? "loading" : "ready");
  /** The state a server render sees: before storage was read. Every server snapshot is selected from it. */
  let server: RunState = state; // set once, after options.initial is in, below
  const run: Published<RunSnapshot> = published(selectRun(state, EMPTY_SNAPSHOT));
  /** Each checklist the app asked for, with the object `run.checklist(definition)` hands back, made once. */
  const checklists = new Map<
    ChecklistDefinition<AnyTask>,
    Published<ChecklistSnapshot<AnyTask>> & { readonly checklist: Checklist<AnyTask> }
  >();
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];
  /** The app's facts, which completion conditions read. Asked here, so no app code runs inside a change. */
  let context = options.context;
  /** A record Waymark cannot read has been reported, which it is once, until one it can read comes. */
  let unreadable = false;

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
    const previous = run.snapshot;
    run.snapshot = selectRun(next, previous);
    // TODO: when seenOf(next) has the same four objects as seenOf(before), skip the checklists:
    // no frame-loop change can move one. Else select each checklist's snapshot, noting changed and completed.

    // TODO, in order:
    // for (const to of scrolls) to.scrollIntoView({ behavior: "smooth", block: "center" });
    // page.sync();                        // always: a frame that has just fired must be asked for again
    // if (look) page.look(look);          // a walkthrough just drawn: its first look, then `start`
    // if (run.snapshot !== previous) queue.notify(run.listeners, run.snapshot); then each changed checklist's listeners
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

  // Loading and hearing: storage's half. The link owns the connection; this owns what the record does to the state.

  /** An unreadable record is reported once, with `replace`, until one Waymark can read comes. */
  const found = (error: RecordUnreadableError, deliver: (problem: WaymarkProblem) => void) => {
    if (unreadable) return;
    unreadable = true;
    deliver(recordUnreadable(error, error.stored, replace));
  };

  const load = (read: Parsed<Read> | { failed: unknown }) => {
    if ("failed" in read) report(storageFailed(read.failed));
    change((s, c) => {
      if ("failed" in read) return { ...s, storageStatus: "error" };
      if (!read.ok) {
        found(read.error, c.problem);
        return { ...s, storageStatus: "error" };
      }
      unreadable = false;
      for (const entry of read.value?.dropped ?? []) c.problem(entryDropped(entry));
      return {
        ...s,
        walkthroughs: W.restore(s.walkthroughs, read.value?.walkthroughs ?? {}),
        checklists: C.restore(s.checklists, read.value?.tasks ?? {}),
        storageStatus: "ready",
      };
    }, "storage");
    change((s, c) => {
      let walkthroughs = s.walkthroughs;
      for (const walkthrough of walkthroughs.definitions.values()) walkthroughs = W.arrive(walkthroughs, walkthrough, c);
      return { ...s, walkthroughs, checklists: C.settleConditions(s.checklists, verdicts(s)) };
    }, "arrival");
    for (const command of held.splice(0)) command();
  };

  const hear = (value: unknown) => {
    // TODO: parse; unreadable → found(error, report). Else unreadable = false, then one "storage" change
    // with W.hear (today's heardEntry loop) and C.restore, then conditions("arrival"):
    // a Task held done by its condition stays done.
  };

  /** The app's record in place of one Waymark could not read: it, with what this Run holds on top, saved whole. */
  const replace = (replacement: StoredRecord | null) => {
    // TODO: parse, throw if unreadable; unreadable = false; one change that merges it under the held progress
    // and statuses (W.replace, C.restore), arrives every definition and asks the conditions, saved whole.
  };

  const link = adapter === undefined ? undefined : createStorageLink(adapter, { record: load, heard: hear });
  if (options.initial !== undefined) load(parseRecord(options.initial));
  server = state;

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
    getSnapshot: () => run.snapshot,
    getServerSnapshot: () => run.serverSnapshot,
    subscribe: listen(queue, run.listeners, () => run.snapshot),
    attach: page.attach,
    /** Storage is the renderer's to start, in the browser: until then the Run reads and hears none. */
    connect: () => link?.connect() ?? (() => {}),
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (state.storageStatus !== "loading") conditions("command");
    },
    checklist: (definition) => {
      // TODO: this definition's entry in `checklists`, made once. Its commands are `later(() => change(...))`
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
