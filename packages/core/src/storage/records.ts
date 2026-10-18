import { copy } from "../checklists/record";
import type { Stored } from "../checklists/record";
import { dictionary } from "../dictionary";
import type { WalkthroughProgress } from "../walkthrough/types";

/**
 * One user's record: each walkthrough they have started, by id, and each
 * task's status. Only tasks off todo are listed; `reopened` is a task taken
 * back from done, and is stored like the others.
 */
export type StoredRecord = Readonly<{
  version: 4;
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
}>;

/**
 * What one save changes: each entry here replaces the user's stored entry
 * under the same id, and `null` removes it. Entries not listed stay as they
 * are, so a save never touches what this Run did not change.
 */
export type StoredChanges = Readonly<{
  version: 4;
  walkthroughs: Readonly<Record<string, WalkthroughProgress | null>>;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened" | null>>;
}>;

/** What a record holds once read: copies, with no prototype, so any id is an ordinary key. */
export type Read = Readonly<{
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
  tasks: Stored;
}>;

/** `null`: nothing is stored. */
export type Parsed<T> =
  | Readonly<{ ok: true; value: T | null }>
  | Readonly<{ ok: false; error: Error }>;

/** Progress part way through restores for a day after its last change. */
export const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000;

const VERSION = 4;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTaskMap = (value: unknown): value is Stored =>
  isRecord(value) &&
  Object.values(value).every(
    (status) => status === "done" || status === "skipped" || status === "reopened",
  );

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A step inside its walkthrough, changed at a real time. */
const isProgress = (value: unknown): value is WalkthroughProgress =>
  isRecord(value) &&
  (value["status"] === "running" || value["status"] === "finished" || value["status"] === "exited") &&
  isIndex(value["step"]) &&
  isIndex(value["stepCount"]) &&
  value["step"] < value["stepCount"] &&
  typeof value["collapsed"] === "boolean" &&
  Number.isFinite(value["changedAt"]);

const invalid = (value: unknown): Parsed<never> => {
  const version = isRecord(value) ? value["version"] : undefined;
  const message =
    typeof version === "number" && version > VERSION
      ? `The stored record is version ${version}; this Waymark reads up to ${VERSION}.`
      : "The stored record is not one Waymark wrote.";
  return { ok: false, error: new Error(message) };
};

const progressOf = (value: Readonly<Record<string, unknown>>): Record<string, WalkthroughProgress> | undefined => {
  const walkthroughs = dictionary<WalkthroughProgress>();
  for (const [id, progress] of Object.entries(value)) {
    if (!isProgress(progress)) return undefined;
    const { status, step, stepCount, collapsed, changedAt } = progress;
    walkthroughs[id] = { status, step, stepCount, collapsed, changedAt };
  }
  return walkthroughs;
};

/** Versions 2 and 3 are the old records of task statuses alone, with no walkthrough in them. */
export function parseRecord(value: unknown): Parsed<Read> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!isRecord(value)) return invalid(value);
  if (value["version"] === VERSION) {
    const walkthroughs = isRecord(value["walkthroughs"]) ? progressOf(value["walkthroughs"]) : undefined;
    const tasks = value["tasks"];
    if (walkthroughs !== undefined && isTaskMap(tasks)) {
      return { ok: true, value: { walkthroughs, tasks: copy(tasks) } };
    }
    return invalid(value);
  }
  const tasks = value["version"] === 3 ? value["tasks"] : value["version"] === 2 ? value["record"] : undefined;
  if (isTaskMap(tasks)) return { ok: true, value: { walkthroughs: dictionary(), tasks: copy(tasks) } };
  return invalid(value);
}

/** Progress part way through that its walkthrough cannot pick up again. Ended progress stays ended. */
export const staleness = (
  progress: WalkthroughProgress,
  stepCount: number,
  maxAge: number,
): "stepsChanged" | "expired" | undefined => {
  if (progress.status !== "running") return undefined;
  if (progress.stepCount !== stepCount) return "stepsChanged";
  return Date.now() - progress.changedAt > maxAge ? "expired" : undefined;
};

/** The entries that differ between two moments, or none. Entries are replaced, never changed in place, so identity says which. */
export const changesBetween = (
  before: Readonly<{ progress: Readonly<Record<string, WalkthroughProgress>>; statuses: Stored }>,
  after: Readonly<{ progress: Readonly<Record<string, WalkthroughProgress>>; statuses: Stored }>,
): StoredChanges | undefined => {
  const walkthroughs = dictionary<WalkthroughProgress | null>();
  const tasks = dictionary<Stored[string] | null>();
  for (const id of new Set([...Object.keys(before.progress), ...Object.keys(after.progress)])) {
    if (before.progress[id] !== after.progress[id]) walkthroughs[id] = after.progress[id] ?? null;
  }
  for (const id of new Set([...Object.keys(before.statuses), ...Object.keys(after.statuses)])) {
    if (before.statuses[id] !== after.statuses[id]) tasks[id] = after.statuses[id] ?? null;
  }
  if (Object.keys(walkthroughs).length === 0 && Object.keys(tasks).length === 0) return undefined;
  return { version: VERSION, walkthroughs, tasks };
};

/**
 * The stored record with a save's changes made to it, or `null` once nothing
 * is left, for an adapter or a server to write in its place. It throws on a
 * record it cannot read, such as one a newer Waymark wrote, rather than write
 * over it.
 */
export function applyChanges(stored: unknown, changes: StoredChanges): StoredRecord | null {
  const parsed = parseRecord(stored);
  if (!parsed.ok) throw new Error(`Waymark did not save over a record it cannot read. ${parsed.error.message}`);
  const walkthroughs = Object.assign(dictionary<WalkthroughProgress>(), parsed.value?.walkthroughs);
  const tasks = copy(parsed.value?.tasks ?? {});
  for (const [id, progress] of Object.entries(changes.walkthroughs)) {
    if (progress === null) delete walkthroughs[id];
    else walkthroughs[id] = progress;
  }
  for (const [id, status] of Object.entries(changes.tasks)) {
    if (status === null) delete tasks[id];
    else tasks[id] = status;
  }
  const next = storedRecord(walkthroughs, tasks);
  return isEmptyRecord(next) ? null : next;
}

export const storedRecord = (
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>,
  tasks: Stored,
): StoredRecord => ({ version: VERSION, walkthroughs: { ...walkthroughs }, tasks: { ...tasks } });

export const isEmptyRecord = (record: StoredRecord): boolean =>
  Object.keys(record.walkthroughs).length === 0 && Object.keys(record.tasks).length === 0;
