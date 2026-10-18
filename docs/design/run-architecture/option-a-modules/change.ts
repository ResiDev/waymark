// packages/core/src/run/change.ts — about 60 lines.
//
// The seams every owner shares: what one change gathers, how a module asks for
// one, and how the record reaches the modules that own its parts. Types only.
// The one function that makes a `Change` lives in `run.ts` and is not
// exported, so no module can make a change outside the pipeline.

import type { WaymarkProblem } from "../problems";
import type { Read } from "../storage/records";
import type { RunEvent } from "./types";

/**
 * The change being made. `commit` makes a fresh one for each change and hands
 * it to the work, which hands it on to every write. A write that can change
 * what a snapshot shows, or what is saved, takes one, so it cannot run
 * outside a change. Write-only: only `commit` reads what it gathered, once the
 * change is done.
 */
export type Change = Readonly<{
  /** A walkthrough's event, announced after the change's notifications. */
  event: (event: RunEvent) => void;
  /** Reported after the change's notifications, so a handler sees a renderer that has redrawn. */
  problem: (problem: WaymarkProblem) => void;
  /** The checklist a Task's status was changed from, for its event. The last credit for a Task wins. */
  credit: (task: string, checklist: string) => void;
}>;

/** What `commit` reads back from a `Change` once the work and the settling are done. */
export type Gathered = Readonly<{
  events: readonly RunEvent[];
  problems: readonly WaymarkProblem[];
  credits: ReadonlyMap<string, string>;
}>;

export type Flags = Readonly<{
  /** No checklist events: the change came from storage or a checklist arriving, not the user. */
  silent?: boolean;
  /** False: the change came from storage, so it is neither saved nor handed to `onChange`. */
  persist?: boolean;
}>;

/**
 * Makes one change and announces it. Work asked for from inside a change, or
 * from a callback it runs, waits until that change has been announced.
 */
export type MakeChange = (work: (change: Change) => void, flags?: Flags) => void;

/**
 * A module that owns part of the stored record. Storage hands it each record
 * read, whole; it takes its own part. `null`: nothing is stored.
 */
export type Durable = Readonly<{
  /** The record loaded at start, in place of what it holds. */
  restore: (change: Change, read: Read | null) => void;
  /** A record saved elsewhere, such as in another tab: it keeps what it must of its own. */
  hear: (change: Change, read: Read | null) => void;
  /** Once a record is in, in a change of its own: what has reached the Run meets it. */
  check: (change: Change, after: "loaded" | "heard") => void;
}>;

/**
 * Every part of the stored record, and the module that owns it. A part added
 * to `Read` with no owner here fails the build, in `run.ts` where the table is
 * filled in.
 */
export type RecordOwners = { readonly [K in keyof Read]: Durable };
