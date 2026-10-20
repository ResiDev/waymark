import { EMPTY } from "../checklists/record";
import type { StoredStatus } from "../checklists/record";
import { dictionary } from "../dictionary";
import { entryDropped } from "../problems";
import type { Change, Recorded, StorageState } from "../state";
import type { Parsed, Read, RecordUnreadableError } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";

export type Place = Omit<WalkthroughProgress, "changedAt">;

type Progress = Recorded["progress"];

const NO_PROGRESS: Progress = Object.freeze(dictionary<WalkthroughProgress>());
const NONE_UNCHECKED: Recorded["unchecked"] = new Map();
export const LOADING: StorageState = { type: "loading" };
export const READY: StorageState = { type: "ready" };
const ERROR: StorageState = { type: "error" };

export const recordedAt = (storage: StorageState): Recorded => ({
  progress: NO_PROGRESS,
  statuses: EMPTY,
  unchecked: NONE_UNCHECKED,
  storage,
});

export const turnedUnreadable = (before: StorageState, after: StorageState): RecordUnreadableError | undefined =>
  after.type === "unreadable" && before.type !== "unreadable" ? after.error : undefined;

export const isUnchecked = (recorded: Recorded, id: string): boolean => {
  const entry = recorded.progress[id];
  return entry !== undefined && recorded.unchecked.get(id) === entry;
};

const unreadable = (recorded: Recorded, error: RecordUnreadableError): Recorded =>
  recorded.storage.type === "unreadable" ? recorded : { ...recorded, storage: { type: "unreadable", error } };

export function loaded(recorded: Recorded, read: Parsed | "failed", change: Change): Recorded {
  if (read === "failed") return { ...recorded, storage: ERROR };
  if (!read.ok) return unreadable(recorded, read.error);
  for (const entry of read.value?.dropped ?? []) change.problems.push(entryDropped(entry));
  const progress = read.value?.walkthroughs ?? NO_PROGRESS;
  return { progress, statuses: read.value?.tasks ?? EMPTY, unchecked: new Map(Object.entries(progress)), storage: READY };
}

const samePlace = (a: Place, b: Place): boolean =>
  a.status === b.status && a.step === b.step && a.stepCount === b.stepCount && a.collapsed === b.collapsed;

const heardEntry = (
  ours: WalkthroughProgress | undefined,
  theirs: WalkthroughProgress | undefined,
  openHere: boolean,
): WalkthroughProgress | undefined => {
  if (openHere) return ours;
  if (theirs === undefined) return undefined;
  if (ours !== undefined && ours.changedAt > theirs.changedAt) return ours;
  const closedHere = theirs.status === "running" && !theirs.collapsed ? { ...theirs, collapsed: true } : theirs;
  return ours !== undefined && samePlace(ours, closedHere) && ours.changedAt === closedHere.changedAt ? ours : closedHere;
};

export function heard(
  recorded: Recorded,
  parsed: Parsed,
  openHere: string | undefined,
  walkthroughs: ReadonlyMap<string, Walkthrough>,
  change: Change,
): Recorded {
  if (!parsed.ok) return unreadable(recorded, parsed.error);
  for (const entry of parsed.value?.dropped ?? []) change.problems.push(entryDropped(entry));
  const theirs = parsed.value?.walkthroughs ?? NO_PROGRESS;
  const { progress } = recorded;
  let next: Record<string, WalkthroughProgress> | undefined;
  let unchecked: Map<string, WalkthroughProgress> | undefined;
  for (const id of new Set([...Object.keys(progress), ...Object.keys(theirs)])) {
    const entry = heardEntry(progress[id], theirs[id], id === openHere);
    if (entry === progress[id]) continue;
    next ??= Object.assign(dictionary<WalkthroughProgress>(), progress);
    if (entry === undefined) {
      delete next[id];
      continue;
    }
    next[id] = entry;
    if (!walkthroughs.has(id)) (unchecked ??= new Map(recorded.unchecked)).set(id, entry);
  }
  return {
    progress: next ?? progress,
    statuses: parsed.value?.tasks ?? EMPTY,
    unchecked: unchecked ?? recorded.unchecked,
    storage: recorded.storage.type === "unreadable" ? READY : recorded.storage,
  };
}

export function replaced(recorded: Recorded, given: Read | null, change: Change): Recorded {
  for (const entry of given?.dropped ?? []) change.problems.push(entryDropped(entry));
  const theirs = given?.walkthroughs ?? NO_PROGRESS;
  const unchecked = new Map(recorded.unchecked);
  for (const [id, entry] of Object.entries(theirs)) if (recorded.progress[id] === undefined) unchecked.set(id, entry);
  return {
    progress: Object.assign(dictionary<WalkthroughProgress>(), theirs, recorded.progress),
    statuses: Object.assign(dictionary<StoredStatus>(), given?.tasks, recorded.statuses),
    unchecked,
    storage: READY,
  };
}

export const refused = unreadable;

export function put(recorded: Recorded, id: string, entry: WalkthroughProgress | undefined): Recorded {
  if (recorded.progress[id] === entry) return recorded;
  const progress = Object.assign(dictionary<WalkthroughProgress>(), recorded.progress);
  if (entry === undefined) delete progress[id];
  else progress[id] = entry;
  return { ...recorded, progress };
}

export function checked(recorded: Recorded, id: string): Recorded {
  if (!recorded.unchecked.has(id)) return recorded;
  const unchecked = new Map(recorded.unchecked);
  unchecked.delete(id);
  return { ...recorded, unchecked };
}

export const place = (was: WalkthroughProgress | undefined, at: Place, now: number): WalkthroughProgress =>
  was !== undefined && (was === at || samePlace(was, at))
    ? was
    : { status: at.status, step: at.step, stepCount: at.stepCount, collapsed: at.collapsed, changedAt: now };

export function setStatus(recorded: Recorded, id: string, status: StoredStatus | undefined): Recorded {
  if (recorded.statuses[id] === status) return recorded;
  const statuses = Object.assign(dictionary<StoredStatus>(), recorded.statuses);
  if (status === undefined) delete statuses[id];
  else statuses[id] = status;
  return { ...recorded, statuses };
}
