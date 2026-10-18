import type { StorageStatus } from "./types";
import type { CallbackName, WaymarkProblem } from "../problems";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { Message, Sighting, WaymarkRead } from "./rules";
import type { State } from "./state";
import type { Action, WaymarkEvent } from "./types";

/*
 * How a layer plugs into the Run's core.
 *
 * The core knows walkthroughs: their definitions and progress, the open one,
 * the waiting requests, the beacons, and the change every command becomes.
 * Checklists, the page and storage are layers. Each hands the core a `Layer`,
 * whose hooks the core calls at fixed places in every change, and gets a
 * `Host`, through which it reads the core and gives it commands. A layer that
 * keeps part of the user's record claims it as a `Slice`, so the core holds
 * the whole record as one value, and every change has one `before` and one
 * `after` of all of it.
 *
 * Internal: nothing here leaves the package. `createRun` composes the three
 * layers once, in a fixed order; an app cannot add one.
 */

// The record

/** The core's own part of the record. Whatever record the core keeps has it. */
export type CoreRecord = Readonly<{
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
}>;

/**
 * What a layer may compare, at one moment. `saved` is the whole record, every
 * slice in one value, and a new object after any write to it, so identity
 * says whether anything saved changed.
 */
export type Moment<TRecord> = Readonly<{
  saved: TRecord;
  /** The open walkthrough's id. */
  open: string | undefined;
  /** `loading` until the record is in; `error` when it could not be read. */
  recordStatus: StorageStatus;
}>;

/**
 * A layer's part of the record, under its key in it. Read anywhere; written
 * only through a `Write`, so no write can fall outside a change's diff.
 */
export type Slice<T> = Readonly<{
  key: string;
  get: () => T;
}>;

/** How a slice takes a record that comes from outside the Run. Its owner's rules, as only it knows them. */
export type SliceRules<T> = Readonly<{
  /** The record read as the Run starts: it replaces the slice. */
  restore: (write: Write, stored: T) => void;
  /** A record saved elsewhere, such as in another tab: the slice keeps what it should of it. */
  hear: (write: Write, heard: T) => void;
  /**
   * In a change of its own, once a record is restored or heard, which is
   * saved but announces nothing: what follows from the record, such as a
   * completion condition that now holds.
   */
  reconcile?: (write: Write, after: "restored" | "heard") => void;
}>;

// Changes

declare const work: unique symbol;

/**
 * Held only while a change runs, and handed to whatever may write in it. One
 * kept past its change throws when used: a write there would be in no diff,
 * so never saved and never announced.
 */
export type Write = Readonly<{
  set: <T>(slice: Slice<T>, value: T) => void;
  /** Reported once the change is announced: after its listeners and its save. */
  problem: (problem: WaymarkProblem) => void;
}>;

/**
 * A change's own work, which may also move walkthroughs. A layer's `settle`
 * gets only a `Write`: by then the core has settled which walkthrough is open,
 * and moving one again would undo it.
 */
export type Tx = Write & Readonly<{ [work]: true }>;

export type Flags = Readonly<{
  /** No layer announces events: the change came from storage or a checklist arriving, not the user. */
  silent?: boolean;
  /** False: the change came from storage, which already holds it, so no layer's `persist` hears it. */
  persist?: boolean;
}>;

/** A change once its writes are done. */
export type Change<TRecord> = Readonly<{
  before: Moment<TRecord>;
  after: Moment<TRecord>;
}>;

/** A change still being made. `now` has every write so far, the core's settling and earlier layers' too. */
export type Settling<TRecord> = Readonly<{
  before: Moment<TRecord>;
  now: Moment<TRecord>;
}>;

type Notify = <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => void;

/** Listeners and the snapshot they are to hear, which the core calls in its turn. */
export type Notice = Readonly<{ deliver: (notify: Notify) => void }>;

export const notice = <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T): Notice => ({
  deliver: (notify) => notify(listeners, snapshot),
});

/** What a layer has to tell once its snapshots are up to date. Data, not calls: the core calls. */
export type Publication = Readonly<{
  notices: readonly Notice[];
  /** Worked out only if they are announced: not on a silent change, nor without `onEvent`. */
  events?: () => readonly WaymarkEvent[];
}>;

/**
 * A layer's hooks, each called by the core at one place in every change, for
 * every layer in turn, before the next place begins. The order is the core's,
 * written once in its `commit`; a layer only says what it does at each.
 */
export type Layer<TRecord> = Readonly<{
  /** A change begins: drop what the last one gathered. */
  begin?: () => void;
  /**
   * Inside the change, once its work is done and the core has settled which
   * walkthrough is open: the layer writes what follows from the change to its
   * own slices. Before any snapshot is made.
   */
  settle?: (change: Settling<TRecord>, write: Write) => void;
  /**
   * Once every write is done: the layer brings its snapshots up to date and
   * says whom to tell. Every layer publishes before anything is told.
   */
  publish?: (change: Change<TRecord>) => Publication;
  /**
   * After every snapshot is up to date, before any listener: the layer makes
   * the world match the state. It may queue a change, which runs once this
   * one is announced.
   */
  effect?: () => void;
  /** After every listener has heard, unless the change came from storage. */
  persist?: (change: Change<TRecord>) => void;
}>;

/** What the core asks of one layer each, read as it needs it, never kept. */
export type Ports = Readonly<{
  /** Whether a renderer draws the Run now. A walkthrough opening takes it. The page answers. */
  attached: () => boolean;
  /** The task a walkthrough guides, for the open walkthrough's snapshot. Checklists answer. */
  taskOf: (walkthroughId: string) => string | null;
}>;

// What the core gives

/** The open walkthrough: the same object while it stays open, its state as the rules last left it. Not a snapshot: read it fresh. */
export type Opened = Readonly<{ walkthrough: Walkthrough; state: State }>;

/** A collapsed walkthrough the Run can draw as a beacon, and where its Waymark was last seen. */
export type Collapsed = Readonly<{
  walkthrough: Walkthrough;
  progress: WalkthroughProgress;
  sighting: Sighting | undefined;
}>;

/**
 * The core, as a layer sees it. Every command that moves state takes the
 * running change's `Tx`, so it can only be given inside a change. Each layer
 * takes the `Pick` of this it uses, which is the list of what it depends on.
 */
export type Host<TRecord extends CoreRecord> = Readonly<{
  // Changes

  /** Runs `work` as one change: now, or after the current change if one is running. */
  change: (work: (tx: Tx) => void, flags?: Flags) => void;
  /** A command from the app or the user. While the record loads it waits, so it acts on the user's progress rather than none. */
  later: (command: () => void) => void;

  // The record

  /** Claims a part of the record, once, before the core is plugged in. The core's own part cannot be claimed. */
  slice: <K extends Exclude<keyof TRecord, keyof CoreRecord> & string>(
    key: K,
    rules: SliceRules<TRecord[K]>,
  ) => Slice<TRecord[K]>;
  moment: () => Moment<TRecord>;
  /** What a server render shows: the moment before storage was read. */
  server: () => Moment<TRecord>;
  /** The record read as the Run starts, slice by slice, or that it could not be read. The record is in either way. */
  restore: (tx: Tx, stored: TRecord | "unreadable") => void;
  /** A record saved elsewhere, slice by slice, as each slice's rules say. */
  hear: (tx: Tx, heard: TRecord) => void;
  /** What follows from a record restored or heard: the core's arrivals, then each slice's `reconcile`. */
  reconcile: (tx: Tx, after: "restored" | "heard") => void;
  /** Runs the commands held while the record loaded, in order. */
  runHeld: () => void;

  // Walkthroughs

  /** The Run's definition for this id; another under an id already taken is a mistake. Not a change: nothing compares definitions. */
  take: (walkthrough: Walkthrough) => Walkthrough;
  definition: (id: string) => Walkthrough | undefined;
  /** Shows a walkthrough the user asked for, as `Run.start` says. */
  start: (tx: Tx, walkthrough: Walkthrough) => void;
  /** As `Run.requestStart` says. */
  request: (tx: Tx, walkthrough: Walkthrough) => void;
  /** Drops a request while it waits. Not a change: a waiting request is neither saved nor shown. */
  withdraw: (walkthrough: Walkthrough) => void;
  /** As `Run.act` says, for this walkthrough. */
  act: (tx: Tx, walkthrough: Walkthrough, action: Action) => void;
  /** As `Run.reset` says. */
  reset: (tx: Tx, walkthrough: Walkthrough) => void;
  /** A definition meets its restored progress: dropped if stale, opened again or set aside if it was open. */
  arrive: (tx: Tx, walkthrough: Walkthrough) => void;

  // The page

  open: () => Opened | undefined;
  /** None while a walkthrough is open. */
  collapsed: () => readonly Collapsed[];
  /** Hands the open walkthrough's rules a message. Returns the element the rules ask to have scrolled into view. */
  obey: (tx: Tx, message: Message) => Element | undefined;
  /** Each beacon's Waymark as measured, by walkthrough id. */
  sight: (tx: Tx, reads: ReadonlyMap<string, WaymarkRead>, now: number) => void;
  /** A renderer starts or stops drawing the Run: the open walkthrough hears it, and time detached does not count towards a beacon's Waymark going missing. */
  setAttached: (tx: Tx, attached: boolean) => void;

  // Calls out

  /** Reports what one of the app's functions threw. */
  fail: (callback: CallbackName, error: unknown) => void;
  /** A `subscribe` over these listeners: called at once, then on each notice. */
  listen: <T>(listeners: Set<(snapshot: T) => void>, get: () => T) => (listener: (snapshot: T) => void) => () => void;
}>;
