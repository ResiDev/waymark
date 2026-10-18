import type { StorageStatus } from "./types";
import { inDevelopment } from "../dev";
import { recordDropped } from "../problems";
import type { ReportProblem, WaymarkProblem } from "../problems";
import type { Queue } from "../queue";
import { listen } from "../subscribe";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type {
  Change,
  Collapsed,
  CoreRecord,
  Flags,
  Host,
  Layer,
  Moment,
  Ports,
  Tx,
  Write,
} from "./layer";
import { arrival, collapsedIn, mergeHeard, nextSightings, recorded, withEntry } from "./progress";
import { apply, sight } from "./rules";
import type { Message, Sighting, WaymarkRead } from "./rules";
import { buildSnapshot, createSnapshotCache, NO_BEACONS } from "./snapshot";
import { opening, stepAt } from "./state";
import type { State } from "./state";
import type { Action, Ended, RunEvent, RunSnapshot, Snapshot, WaymarkEvent } from "./types";

/*
 * The Run's core: one user's walkthroughs, and the change every command
 * becomes. It knows no task, no page and no storage; those are layers
 * (`layer.ts`), which `createRun` plugs in.
 *
 * About 440 lines once filled in.
 */

/** The open walkthrough and its State, the one thing `rules.ts` works on. The same object while it stays open. */
type Machine = { readonly walkthrough: Walkthrough; state: State };

/** A slice's rules, bound to its key, so the core can hand each its part of a whole record. */
type BoundRules<TRecord> = Readonly<{
  restore: (write: Write, record: TRecord) => void;
  hear: (write: Write, record: TRecord) => void;
  reconcile: ((write: Write, after: "restored" | "heard") => void) | undefined;
}>;

export type CoreOptions<TRecord> = Readonly<{
  queue: Queue;
  report: ReportProblem;
  /** The record before anything is read: every slice empty. Its keys are every slice there must be. */
  empty: TRecord;
  /** A record is still to be read, so commands wait for it. */
  loading: boolean;
  onEvent: ((event: WaymarkEvent) => void) | undefined;
}>;

export type Core<TRecord extends CoreRecord> = Readonly<{
  host: Host<TRecord>;
  /**
   * Once, after every layer is made. Their order is the order each place in
   * a change calls them in. No change runs before, and a slice left unclaimed
   * throws here.
   */
  plug: (parts: Readonly<{ layers: readonly Layer<TRecord>[]; ports: Ports }>) => void;
  /** Takes what a server render shows. Once, after any `initial` record and before storage is read. */
  freezeServer: () => void;
  getSnapshot: () => RunSnapshot;
  getServerSnapshot: () => RunSnapshot;
  subscribe: (listener: (snapshot: RunSnapshot) => void) => () => void;
}>;

export function createCore<TRecord extends CoreRecord>(options: CoreOptions<TRecord>): Core<TRecord> {
  const { queue, report } = options;

  // Walkthroughs

  /** Handed over as each walkthrough is used, and never saved. */
  const definitions = new Map<string, Walkthrough>();
  /** Progress from storage not yet checked against its definition. Until then it waits as data. */
  const unchecked = new Set<string>();
  /** From `requestStart`, oldest first. */
  const waiting: Walkthrough[] = [];
  let machine: Machine | undefined;
  /** The step generation of the last step shown, which the next walkthrough's steps follow. */
  let lastGeneration = -1;
  /** Where each collapsed walkthrough's Waymark is, while none is open. */
  const sightings = new Map<string, Sighting>();

  // The record

  /** Every slice in one value, replaced on each write. The core's own slice is `walkthroughs`. */
  let saved: TRecord = options.empty;
  /** Each slice's rules, by key, the core's own first, then in the order claimed. */
  const rules = new Map<string, BoundRules<TRecord>>();
  let recordStatus: StorageStatus = options.loading ? "loading" : "ready";
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];

  // Changes

  let plugged: Readonly<{ layers: readonly Layer<TRecord>[]; ports: Ports }> | undefined;
  /** The running change's Write. Undefined between changes, and once a change's writes are done. */
  let live: Tx | undefined;
  // Gathered while a change is made, and announced once it is done.
  let events: RunEvent[] = [];
  let problems: WaymarkProblem[] = [];

  // Snapshots

  let snapshot: RunSnapshot = { storageStatus: recordStatus, progress: saved.walkthroughs, open: null, beacons: NO_BEACONS };
  const cache = createSnapshotCache();
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  let server: Readonly<{ moment: Moment<TRecord>; snapshot: RunSnapshot }> | undefined;

  // Writing

  const assertLive = (tx: Write) => {
    if (tx !== live) throw new Error("A Waymark change's write was used after the change ended.");
  };

  const setProgress = (id: string, value: WalkthroughProgress | undefined) => {
    // TODO: saved = { ...saved, walkthroughs: withEntry(saved.walkthroughs, id, value) }
    throw new Error("not implemented");
  };

  /** A new entry only when the step, the phase or whether it is collapsed changed. */
  const record = (id: string, shown: Snapshot) => {
    // TODO: const next = recorded(saved.walkthroughs[id], shown, Date.now()); if (next !== saved.walkthroughs[id]) setProgress(id, next)
    throw new Error("not implemented");
  };

  // Walkthroughs: each as run.ts has it today, over the state above.

  /** Collapsed walkthroughs the Run can draw as beacons: none while one is open. */
  const collapsedNow = (): readonly Collapsed[] =>
    machine === undefined ? collapsedIn(saved.walkthroughs, definitions, unchecked, sightings) : [];

  /** A walkthrough already part way through opens as it was, and sends no `start` when drawn. */
  const open = (walkthrough: Walkthrough, index: number, how: "fresh" | "resume" | "restore") => {
    // TODO: as today, with `attached: plugged.ports.attached()` in place of `attachments.length > 0`.
    throw new Error("not implemented");
  };

  /** Brings progress up to the open walkthrough's state, and lets go of it once it is no longer open. */
  const release = () => {
    // TODO: as today: record; if collapsed keep its sighting; carry lastGeneration; machine = undefined.
    throw new Error("not implemented");
  };

  /** When nothing is open, a waiting request goes before the beacons show. */
  const settle = () => {
    // TODO: release(); open the first waiting request with no progress, dropping those passed over;
    // then replace `sightings` with nextSightings(collapsedNow()): each beacon's Waymark looked for afresh.
    throw new Error("not implemented");
  };

  const obey = (message: Message): Element | undefined => {
    // TODO: as today, but hand `outcome.scrollTo` back instead of scrolling: the core does not touch the page.
    // Pushes `waymarkLost`/`waymarkMissing` to `problems` and the outcome's events to `events`.
    throw new Error("not implemented");
  };

  /** Sets the open walkthrough aside as its `dismiss` says, for the one started over it. */
  const interrupt = (by: string) => {
    throw new Error("not implemented");
  };

  /**
   * A walkthrough's definition meets its restored progress: dropped if it
   * cannot be picked up again, and, if it was open, open again, or set aside
   * as if interrupted when another is.
   */
  const arrive = (walkthrough: Walkthrough) => {
    // TODO: if (!unchecked.delete(id)) return; const saved = progress[id]; if none return;
    // switch (arrival(saved, walkthrough, machine !== undefined, Date.now())):
    //   "drop":     setProgress(id, undefined); problems.push(recordDropped(id, reason))  -- before the handler hears
    //   "open":     open(walkthrough, step, "restore")
    //   "setAside": setProgress(id, progress)
    //   "keep":     nothing
    throw new Error("not implemented");
  };

  const begin = (walkthrough: Walkthrough) => {
    throw new Error("not implemented");
  };

  const request = (walkthrough: Walkthrough) => {
    throw new Error("not implemented");
  };

  const resetOne = (walkthrough: Walkthrough) => {
    throw new Error("not implemented");
  };

  const actOn = (walkthrough: Walkthrough, action: Action) => {
    // TODO: as today. A collapsed walkthrough's `exit` records `Ended` and pushes its `exit` event.
    throw new Error("not implemented");
  };

  const take = (walkthrough: Walkthrough): Walkthrough => {
    // TODO: as today, throwing in development for a second definition under one id.
    throw new Error("not implemented");
  };

  // The core's own slice. Its rules are the core's, as only it knows which walkthrough is open here.

  const progressRules: BoundRules<TRecord> = {
    restore: (_write, stored) => {
      // TODO: setProgress wholesale to stored.walkthroughs; every id in it goes to `unchecked`.
      throw new Error("not implemented");
    },
    hear: (_write, heard) => {
      // TODO: const merged = mergeHeard(saved.walkthroughs, heard.walkthroughs, machine?.walkthrough.id, (id) => definitions.has(id));
      // if (merged.progress !== saved.walkthroughs) set it; delete merged.forgotten from `unchecked`, add merged.unchecked.
      throw new Error("not implemented");
    },
    reconcile: (_write, after) => {
      // Only a record restored can hold progress whose definition has already arrived; one heard waits for its own.
      if (after === "restored") for (const walkthrough of definitions.values()) arrive(walkthrough);
    },
  };
  rules.set("walkthroughs", progressRules);

  const moment = (): Moment<TRecord> => ({ saved, open: machine?.walkthrough.id, recordStatus });

  const build = (previous: RunSnapshot): RunSnapshot => {
    const ports = plugged?.ports;
    if (ports === undefined) return previous;
    const opened = machine;
    return buildSnapshot(
      previous,
      {
        recordStatus,
        progress: saved.walkthroughs,
        open: opened,
        task: opened === undefined ? null : ports.taskOf(opened.walkthrough.id),
        collapsed: collapsedNow(),
      },
      cache,
    );
  };

  // The change pipeline. Written out: its order is the contract every layer relies on.

  const openWrite = (): Tx => {
    // TODO: a fresh object each change, so one kept past its change is told apart:
    // { set: (slice, value) => { assertLive(tx); if (slice.get() !== value) saved = { ...saved, [slice.key]: value } },
    //   problem: (problem) => { assertLive(tx); problems.push(problem) } }, branded as a Tx (the one cast).
    throw new Error("not implemented");
  };

  const commit = (work: (tx: Tx) => void, flags: Flags) => {
    if (plugged === undefined) throw new Error("The Run's core ran a change before its layers were plugged in.");
    const { layers } = plugged;

    // 1. Before, and nothing left over from the last change.
    const before = moment();
    events = [];
    problems = [];
    for (const layer of layers) layer.begin?.();

    // 2-5. The writes: the work, then the core settles which walkthrough is open, then each layer what follows.
    const tx = openWrite();
    live = tx;
    try {
      work(tx);
      settle();
      for (const layer of layers) layer.settle?.({ before, now: moment() }, tx);
    } finally {
      live = undefined;
    }
    const after = moment();
    const change: Change<TRecord> = { before, after };
    const announced = { events, problems };

    // 6. Every snapshot is up to date before any callback runs, so a callback that reads another sees this change too.
    const next = build(snapshot);
    const changed = next !== snapshot;
    snapshot = next;
    const published = layers.map((layer) => layer.publish?.(change));

    // 7. Always, not only on change: a frame that has just fired must be re-requested even when its look found nothing new.
    for (const layer of layers) layer.effect?.();

    // 8. The Run's listeners, then each layer's.
    if (changed) queue.notify(listeners, snapshot);
    for (const publication of published) {
      for (const each of publication?.notices ?? []) each.deliver(queue.notify);
    }

    // 9. Storage gets only what changed; a change from storage gives it nothing.
    if (flags.persist !== false) for (const layer of layers) layer.persist?.(change);

    // 10. After notify, so a handler sees a renderer that has already redrawn.
    for (const problem of announced.problems) queue.invoke(() => report(problem));

    // 11. The walkthroughs' events, then each layer's, worked out only now.
    const onEvent = options.onEvent;
    if (onEvent === undefined) return;
    for (const event of announced.events) queue.callApp("onEvent", () => onEvent(event));
    if (flags.silent === true) return;
    for (const publication of published) {
      for (const event of publication?.events?.() ?? []) queue.callApp("onEvent", () => onEvent(event));
    }
  };

  const change = (work: (tx: Tx) => void, flags: Flags = {}) => queue.run(() => commit(work, flags));

  /** A command the core runs inside a change, given that change's Tx. */
  const inChange =
    <TArgs extends unknown[], TResult>(command: (...args: TArgs) => TResult) =>
    (tx: Tx, ...args: TArgs): TResult => {
      assertLive(tx);
      return command(...args);
    };

  const host: Host<TRecord> = {
    change,
    later: (command) => {
      if (recordStatus === "loading") held.push(command);
      else command();
    },

    slice: (key, sliceRules) => {
      // TODO: throw if plugged, or if `key` is already claimed or is not a key of `options.empty`.
      // rules.set(key, { restore: (w, r) => sliceRules.restore(w, r[key]), hear: (w, r) => sliceRules.hear(w, r[key]), reconcile: sliceRules.reconcile });
      // return { key, get: () => saved[key] };
      throw new Error("not implemented");
    },
    moment,
    server: () => {
      if (server === undefined) throw new Error("The Run's server moment is read before it was taken.");
      return server.moment;
    },
    // Each slice in `rules` order, the core's own first: the record is handed out whole, and each takes its part.
    restore: (tx, stored) => {
      assertLive(tx);
      // Either way the record is in: commands stop waiting once `runHeld` has run.
      if (stored === "unreadable") {
        recordStatus = "error";
        return;
      }
      for (const each of rules.values()) each.restore(tx, stored);
      recordStatus = "ready";
    },
    hear: (tx, heard) => {
      assertLive(tx);
      for (const each of rules.values()) each.hear(tx, heard);
    },
    reconcile: (tx, after) => {
      assertLive(tx);
      for (const each of rules.values()) each.reconcile?.(tx, after);
    },
    runHeld: () => {
      for (const command of held.splice(0)) command();
    },

    take,
    definition: (id) => definitions.get(id),
    start: inChange((walkthrough: Walkthrough) => {
      arrive(walkthrough);
      begin(walkthrough);
    }),
    request: inChange((walkthrough: Walkthrough) => {
      arrive(walkthrough);
      request(walkthrough);
    }),
    withdraw: (walkthrough) => {
      const at = waiting.indexOf(walkthrough);
      if (at !== -1) waiting.splice(at, 1);
    },
    act: inChange(actOn),
    reset: inChange(resetOne),
    arrive: inChange(arrive),

    open: () => machine,
    collapsed: collapsedNow,
    obey: inChange(obey),
    sight: inChange((reads: ReadonlyMap<string, WaymarkRead>, now: number) => {
      // TODO: for each collapsed walkthrough with a read: sightings.set(id, sight(previous, read, now, step)).
      throw new Error("not implemented");
    }),
    setAttached: inChange((attached: boolean) => {
      // TODO: obey({ kind: attached ? "attached" : "detached" }); once detached, nobody looked,
      // so every sighting's `unseenSince` goes, and that time does not count towards missing or lost.
      throw new Error("not implemented");
    }),

    fail: queue.fail,
    listen: (set, get) => listen(queue, set, get),
  };

  return {
    host,
    plug: (parts) => {
      // TODO: throw if already plugged; in development, throw for any key of `options.empty` with no rules.
      plugged = parts;
    },
    freezeServer: () => {
      snapshot = build(snapshot);
      server = { moment: moment(), snapshot };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => {
      if (server === undefined) throw new Error("The Run's server snapshot is read before it was taken.");
      return server.snapshot;
    },
    subscribe: listen(queue, listeners, () => snapshot),
  };
}
