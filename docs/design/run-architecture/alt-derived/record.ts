// Sketch for packages/core/src/run/record.ts, about 170 lines.
//
// Owns: Recorded, the user's record as this tab holds it, and storage's last
// word on it. The only file that makes a Recorded. Pure: storage is read and
// written by the shell, and every function here takes what it said.
//
// Every entry and status is replaced, never changed in place, and every
// function hands back the same object when nothing changed. So "is there
// anything to save" is two identity checks, and a frame never gets this far.

import type { StoredStatus } from "../../../../packages/core/src/checklists/record";
import type { StorageStatus } from "../../../../packages/core/src/checklists/types";
import type { Change, Recorded, StorageState } from "../../../../packages/core/src/state";
import type { Parsed, Read, RecordUnreadableError } from "../../../../packages/core/src/storage/records";
import type { Walkthrough, WalkthroughProgress } from "../../../../packages/core/src/walkthrough/types";

/** Where an entry stands, without when it got there. A new entry is made only when one of these moves. */
export type Place = Omit<WalkthroughProgress, "changedAt">;

export const recordedAt = (storage: StorageState): Recorded => {
  throw new Error("not implemented");
};

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The public status: storage's word, with `failed` shown as `error`. The public `StorageStatus` gains `unreadable`. */
export const storageStatus = (storage: StorageState): StorageStatus => {
  throw new Error("not implemented");
};

/** Storage turned `unreadable` from anything else, so the record is reported: once, until one Waymark can read comes. */
export const turnedUnreadable = (before: StorageState, after: StorageState): RecordUnreadableError | undefined => {
  throw new Error("not implemented");
};

/** Storage gave this entry and no definition has checked it: it waits as data, neither open nor a beacon. */
export const isUnchecked = (recorded: Recorded, id: string): boolean => {
  throw new Error("not implemented");
};

/**
 * The definitions whose entries are unchecked, in the order the definitions
 * came: what the next change checks. Cached by the identity of `unchecked`
 * and the definitions, so a frame, which changes neither, costs one lookup.
 */
export function due(recorded: Recorded, walkthroughs: ReadonlyMap<string, Walkthrough>): readonly Walkthrough[] {
  throw new Error("not implemented");
}

// ─── What storage said: the `storage` phase ─────────────────────────────────

/**
 * The record read at the start, in place of the empty one held while
 * loading. Progress and statuses are taken whole, and every entry is
 * unchecked until its definition comes. A record Waymark cannot read leaves
 * both empty and says `unreadable`; a failed read says `failed`. Each entry
 * left out is a `recordDropped` problem.
 */
export function loaded(recorded: Recorded, read: Parsed | "failed", change: Change): Recorded {
  throw new Error("not implemented");
}

/**
 * A record saved elsewhere, as today's `hear` and `heardEntry`: statuses
 * taken whole; each entry kept as this tab has it when it is `openHere` or
 * changed here since, collapsed when it is open there, so only one is open
 * here; an entry whose definition has not come is unchecked, as a loaded one
 * is. One it cannot read says `unreadable` and changes no entry; one it can
 * read turns `unreadable` back to `read`.
 */
export function heard(
  recorded: Recorded,
  parsed: Parsed,
  openHere: string | undefined,
  walkthroughs: ReadonlyMap<string, Walkthrough>,
  change: Change,
): Recorded {
  throw new Error("not implemented");
}

/**
 * The app's record in place of one Waymark could not read, with what this
 * tab holds on top: what the user did since. Entries only it has are
 * unchecked. Says `read`. The change saves the whole record.
 */
export function replaced(recorded: Recorded, given: Read | null, change: Change): Recorded {
  throw new Error("not implemented");
}

/** Storage refused a save because the stored record is unreadable: the same fact a load would have told. The same object when it already said so. */
export function refused(recorded: Recorded, error: RecordUnreadableError): Recorded {
  throw new Error("not implemented");
}

// ─── Writes inside a change ─────────────────────────────────────────────────

/** One entry replaced, or gone for `undefined`. The same object when it is the entry already there. */
export function put(recorded: Recorded, id: string, entry: WalkthroughProgress | undefined): Recorded {
  throw new Error("not implemented");
}

/** Its definition has checked the entry and kept it as it is, so it is this tab's from now on. */
export function checked(recorded: Recorded, id: string): Recorded {
  throw new Error("not implemented");
}

/** `was` itself while its place has not moved; otherwise a new entry changed at `now`. Today's `record`. */
export function place(was: WalkthroughProgress | undefined, at: Place, now: number): WalkthroughProgress {
  throw new Error("not implemented");
}

/** One Task's status, or todo for `undefined`. The same object when it is already that. */
export function setStatus(recorded: Recorded, id: string, status: StoredStatus | undefined): Recorded {
  throw new Error("not implemented");
}
