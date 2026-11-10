import { EMPTY } from "../checklists/record";
import type { StoredStatus } from "../checklists/record";
import { dictionary } from "../dictionary";
import { entryDropped, recordDropped } from "../problems";
import type { Change, StoredWalkthrough, UserRecord, StorageState } from "../state";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Parsed, Read, RecordUnreadableError, Resets } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";

export type Place = Omit<WalkthroughProgress, "changedAt">;

type Progress = UserRecord["walkthroughProgressById"];

const NO_PROGRESS: Progress = Object.freeze(dictionary<WalkthroughProgress>());
const NONE_UNCHECKED: UserRecord["unverifiedWalkthroughProgressById"] = new Map();
const NO_RESETS: Resets = Object.freeze(dictionary<number>());
export const LOADING: StorageState = { type: "loading" };
export const READY: StorageState = { type: "ready" };
const ERROR: StorageState = { type: "error" };

export const userRecordAt = (storage: StorageState): UserRecord => ({
  walkthroughProgressById: NO_PROGRESS,
  walkthroughResetAt: NO_RESETS,
  taskStatusById: EMPTY,
  unverifiedWalkthroughProgressById: NONE_UNCHECKED,
  storageStatus: storage,
});

export const turnedUnreadable = (before: StorageState, after: StorageState): RecordUnreadableError | undefined =>
  after.type === "unreadable" && before.type !== "unreadable" ? after.error : undefined;

export const isUnverified = (userRecord: UserRecord, id: string): boolean => {
  const walkthroughProgress = userRecord.walkthroughProgressById[id];
  return walkthroughProgress !== undefined && userRecord.unverifiedWalkthroughProgressById.get(id) === walkthroughProgress;
};

const unreadable = (userRecord: UserRecord, error: RecordUnreadableError): UserRecord =>
  userRecord.storageStatus.type === "unreadable" ? userRecord : { ...userRecord, storageStatus: { type: "unreadable", error } };

export function loaded(userRecord: UserRecord, read: Parsed | "failed", change: Change): UserRecord {
  if (read === "failed") return { ...userRecord, storageStatus: ERROR };
  if (!read.ok) return unreadable(userRecord, read.error);
  for (const entry of read.value?.dropped ?? []) change.problems.push(entryDropped(entry));
  const walkthroughProgressById = read.value?.walkthroughs ?? NO_PROGRESS;
  return {
    walkthroughProgressById,
    walkthroughResetAt: read.value?.resets ?? NO_RESETS,
    taskStatusById: read.value?.tasks ?? EMPTY,
    unverifiedWalkthroughProgressById: new Map(Object.entries(walkthroughProgressById)),
    storageStatus: READY,
  };
}

const samePlace = (a: Place, b: Place): boolean =>
  a.status === b.status && a.step === b.step && a.stepCount === b.stepCount && a.collapsed === b.collapsed;

/** When one side last changed a walkthrough: its entry, or its reset. */
const changedAt = ({ entry, reset }: StoredWalkthrough): number => entry?.changedAt ?? reset ?? Number.NEGATIVE_INFINITY;

/** Whether `kept` wins over `other` in storage: it is newer, or an entry where `other` has only a reset at the same time. */
const winsOver = (kept: StoredWalkthrough, other: StoredWalkthrough): boolean =>
  changedAt(kept) > changedAt(other) || (changedAt(kept) === changedAt(other) && kept.entry !== undefined && other.entry === undefined && other.reset !== undefined);

/**
 * This tab's entry for a walkthrough once it hears another's: whichever is
 * newer, an entry or a reset, wins, the entry at the same time, but the one
 * open here stays, stamped as late as what was heard. A record with
 * no entry and no reset was written before this tab's entry reached it, so it
 * takes nothing away.
 */
const heardWalkthroughProgress = (ourSide: StoredWalkthrough, theirSide: StoredWalkthrough, openHere: boolean): WalkthroughProgress | undefined => {
  const ours = ourSide.entry;
  const theirs = theirSide.entry;
  // Stamped no earlier than what was heard, so its next write here wins over that in storage.
  if (openHere) return ours === undefined || ours.changedAt >= changedAt(theirSide) ? ours : { ...ours, changedAt: changedAt(theirSide) };
  if (theirs === undefined) return theirSide.reset !== undefined && theirSide.reset > (ours?.changedAt ?? Number.NEGATIVE_INFINITY) ? undefined : ours;
  if (ours === undefined && ourSide.reset !== undefined && ourSide.reset > theirs.changedAt) return undefined;
  if (ours !== undefined && ours.changedAt > theirs.changedAt) return ours;
  const closedHere: WalkthroughProgress = theirs.status === "running" && !theirs.collapsed ? { ...theirs, collapsed: true } : theirs;
  // The same write heard again, such as the record this tab restored: what this tab made of it stands.
  const again = ours !== undefined && ours.changedAt === theirs.changedAt && (samePlace(ours, theirs) || samePlace(ours, closedHere));
  return again ? ours : closedHere;
};

export function heard(
  userRecord: UserRecord,
  parsed: Parsed,
  openHere: string | undefined,
  walkthroughs: ReadonlyMap<string, Walkthrough>,
  change: Change,
): UserRecord {
  if (!parsed.ok) return unreadable(userRecord, parsed.error);
  for (const entry of parsed.value?.dropped ?? []) change.problems.push(entryDropped(entry));
  const theirs = parsed.value?.walkthroughs ?? NO_PROGRESS;
  const theirResets = parsed.value?.resets ?? NO_RESETS;
  const { walkthroughProgressById, walkthroughResetAt } = userRecord;
  let next: Record<string, WalkthroughProgress> | undefined;
  let resets: Record<string, number> | undefined;
  let unverified: Map<string, WalkthroughProgress> | undefined;
  const ids = [walkthroughProgressById, walkthroughResetAt, theirs, theirResets].flatMap((byId) => Object.keys(byId));
  for (const id of new Set(ids)) {
    const ourSide = { entry: walkthroughProgressById[id], reset: walkthroughResetAt[id] };
    const theirSide = { entry: theirs[id], reset: theirResets[id] };
    const walkthroughProgress = heardWalkthroughProgress(ourSide, theirSide, id === openHere);
    // A reset stands only while there is no entry: the newer of the two sides' resets.
    const reset = walkthroughProgress === undefined ? Math.max(ourSide.reset ?? -1, theirSide.reset ?? -1) : -1;
    const kept = reset === -1 ? undefined : reset;
    if (kept !== ourSide.reset) {
      resets ??= Object.assign(dictionary<number>(), walkthroughResetAt);
      if (kept === undefined) delete resets[id];
      else resets[id] = kept;
    }
    // What this tab holds is newer than what was heard: saved again, or nothing would ever bring storage up to it.
    if (winsOver({ entry: walkthroughProgress, reset: kept }, theirSide)) change.storedOlder.set(id, theirSide);
    if (walkthroughProgress === ourSide.entry) continue;
    next ??= Object.assign(dictionary<WalkthroughProgress>(), walkthroughProgressById);
    if (walkthroughProgress === undefined) {
      delete next[id];
      continue;
    }
    const walkthrough = walkthroughs.get(id);
    const reason = walkthrough && staleness(walkthroughProgress, walkthrough.steps.length, walkthrough.maxAge ?? DEFAULT_MAX_AGE, change.now);
    if (reason !== undefined) {
      change.problems.push(recordDropped(id, reason));
      delete next[id];
      continue;
    }
    next[id] = walkthroughProgress;
    if (walkthrough === undefined) (unverified ??= new Map(userRecord.unverifiedWalkthroughProgressById)).set(id, walkthroughProgress);
  }
  return {
    walkthroughProgressById: next ?? walkthroughProgressById,
    walkthroughResetAt: resets ?? walkthroughResetAt,
    taskStatusById: parsed.value?.tasks ?? EMPTY,
    unverifiedWalkthroughProgressById: unverified ?? userRecord.unverifiedWalkthroughProgressById,
    storageStatus: userRecord.storageStatus.type === "unreadable" ? READY : userRecord.storageStatus,
  };
}

export function replaced(userRecord: UserRecord, given: Read | null, change: Change): UserRecord {
  for (const entry of given?.dropped ?? []) change.problems.push(entryDropped(entry));
  const theirs = given?.walkthroughs ?? NO_PROGRESS;
  const unverified = new Map(userRecord.unverifiedWalkthroughProgressById);
  for (const [id, walkthroughProgress] of Object.entries(theirs)) if (userRecord.walkthroughProgressById[id] === undefined) unverified.set(id, walkthroughProgress);
  const walkthroughProgressById = Object.assign(dictionary<WalkthroughProgress>(), theirs, userRecord.walkthroughProgressById);
  // The app's resets and this tab's, but for a walkthrough with an entry.
  const resets = Object.assign(dictionary<number>(), given?.resets, userRecord.walkthroughResetAt);
  for (const id of Object.keys(walkthroughProgressById)) delete resets[id];
  return {
    walkthroughProgressById,
    walkthroughResetAt: resets,
    taskStatusById: Object.assign(dictionary<StoredStatus>(), given?.tasks, userRecord.taskStatusById),
    unverifiedWalkthroughProgressById: unverified,
    storageStatus: READY,
  };
}

export const refused = unreadable;

/** An entry written here is newer than any reset of its walkthrough, so the reset goes. */
/**
 * An entry is stamped no earlier than what this tab last held of the
 * walkthrough, its entry or its reset: so its write wins over that one in
 * storage and in other tabs, even in the same millisecond.
 */
export function put(userRecord: UserRecord, id: string, walkthroughProgress: WalkthroughProgress | undefined): UserRecord {
  const was = userRecord.walkthroughProgressById[id];
  if (was === walkthroughProgress) return userRecord;
  const floor = Math.max(was?.changedAt ?? Number.NEGATIVE_INFINITY, userRecord.walkthroughResetAt[id] ?? Number.NEGATIVE_INFINITY);
  const walkthroughProgressById = Object.assign(dictionary<WalkthroughProgress>(), userRecord.walkthroughProgressById);
  if (walkthroughProgress === undefined) delete walkthroughProgressById[id];
  else walkthroughProgressById[id] = walkthroughProgress.changedAt >= floor ? walkthroughProgress : { ...walkthroughProgress, changedAt: floor };
  if (walkthroughProgress === undefined || userRecord.walkthroughResetAt[id] === undefined) return { ...userRecord, walkthroughProgressById };
  const walkthroughResetAt = Object.assign(dictionary<number>(), userRecord.walkthroughResetAt);
  delete walkthroughResetAt[id];
  return { ...userRecord, walkthroughProgressById, walkthroughResetAt };
}

/**
 * The walkthrough's entry goes, and the reset is kept with its time, so other
 * tabs hear it as a reset. Stamped after the entry it removes, which wins a
 * tie, so the reset wins even in the millisecond the entry was written.
 */
export function resetIn(userRecord: UserRecord, id: string, at: number): UserRecord {
  const entry = userRecord.walkthroughProgressById[id];
  if (entry === undefined) return userRecord;
  const walkthroughResetAt = Object.assign(dictionary<number>(), userRecord.walkthroughResetAt);
  walkthroughResetAt[id] = Math.max(at, entry.changedAt + 1);
  return { ...put(userRecord, id, undefined), walkthroughResetAt };
}

export function verified(userRecord: UserRecord, id: string): UserRecord {
  if (!userRecord.unverifiedWalkthroughProgressById.has(id)) return userRecord;
  const unverified = new Map(userRecord.unverifiedWalkthroughProgressById);
  unverified.delete(id);
  return { ...userRecord, unverifiedWalkthroughProgressById: unverified };
}

export const place = (was: WalkthroughProgress | undefined, at: Place, now: number): WalkthroughProgress =>
  was !== undefined && (was === at || samePlace(was, at))
    ? was
    : { status: at.status, step: at.step, stepCount: at.stepCount, collapsed: at.collapsed, changedAt: now };

export function setStatus(userRecord: UserRecord, id: string, status: StoredStatus | undefined): UserRecord {
  if (userRecord.taskStatusById[id] === status) return userRecord;
  const taskStatusById = Object.assign(dictionary<StoredStatus>(), userRecord.taskStatusById);
  if (status === undefined) delete taskStatusById[id];
  else taskStatusById[id] = status;
  return { ...userRecord, taskStatusById };
}
