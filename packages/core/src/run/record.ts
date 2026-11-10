import { EMPTY } from "../checklists/record";
import type { StoredStatus } from "../checklists/record";
import { dictionary } from "../dictionary";
import { entryDropped, recordDropped } from "../problems";
import type { Change, UserRecord, StorageState } from "../state";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Parsed, Read, RecordUnreadableError } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";

export type Place = Omit<WalkthroughProgress, "changedAt">;

type Progress = UserRecord["walkthroughProgressById"];

const NO_PROGRESS: Progress = Object.freeze(dictionary<WalkthroughProgress>());
const NONE_UNCHECKED: UserRecord["unverifiedWalkthroughProgressById"] = new Map();
export const LOADING: StorageState = { type: "loading" };
export const READY: StorageState = { type: "ready" };
const ERROR: StorageState = { type: "error" };

export const userRecordAt = (storage: StorageState): UserRecord => ({
  walkthroughProgressById: NO_PROGRESS,
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
    taskStatusById: read.value?.tasks ?? EMPTY,
    unverifiedWalkthroughProgressById: new Map(Object.entries(walkthroughProgressById)),
    storageStatus: READY,
  };
}

const samePlace = (a: Place, b: Place): boolean =>
  a.status === b.status && a.step === b.step && a.stepCount === b.stepCount && a.collapsed === b.collapsed;

const heardWalkthroughProgress = (
  ours: WalkthroughProgress | undefined,
  theirs: WalkthroughProgress | undefined,
  openHere: boolean,
): WalkthroughProgress | undefined => {
  if (openHere) return ours;
  if (theirs === undefined) return undefined;
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
  const { walkthroughProgressById } = userRecord;
  let next: Record<string, WalkthroughProgress> | undefined;
  let unverified: Map<string, WalkthroughProgress> | undefined;
  for (const id of new Set([...Object.keys(walkthroughProgressById), ...Object.keys(theirs)])) {
    const ours = walkthroughProgressById[id];
    const heardEntry = theirs[id];
    const walkthroughProgress = heardWalkthroughProgress(ours, heardEntry, id === openHere);
    // Storage holds an older entry than this one: saved again, or nothing would ever bring storage up to it.
    if (ours !== undefined && heardEntry !== undefined && ours.changedAt > heardEntry.changedAt) change.storedOlder.set(id, heardEntry);
    if (walkthroughProgress === ours) continue;
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
  return {
    walkthroughProgressById: Object.assign(dictionary<WalkthroughProgress>(), theirs, userRecord.walkthroughProgressById),
    taskStatusById: Object.assign(dictionary<StoredStatus>(), given?.tasks, userRecord.taskStatusById),
    unverifiedWalkthroughProgressById: unverified,
    storageStatus: READY,
  };
}

export const refused = unreadable;

export function put(userRecord: UserRecord, id: string, walkthroughProgress: WalkthroughProgress | undefined): UserRecord {
  if (userRecord.walkthroughProgressById[id] === walkthroughProgress) return userRecord;
  const walkthroughProgressById = Object.assign(dictionary<WalkthroughProgress>(), userRecord.walkthroughProgressById);
  if (walkthroughProgress === undefined) delete walkthroughProgressById[id];
  else walkthroughProgressById[id] = walkthroughProgress;
  return { ...userRecord, walkthroughProgressById };
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
