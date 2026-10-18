import { copy } from "../checklists/record";
import type { Stored } from "../checklists/record";
import { dictionary } from "../dictionary";
import type { WalkthroughProgress } from "../walkthrough/types";
import { migrate, VERSION } from "./migrations";

/**
 * One user's record: each walkthrough they have started, by id, and each
 * task's status. Only tasks off todo are listed; `reopened` is a task taken
 * back from done, and is stored like the others.
 */
export type StoredRecord = Readonly<{
  version: typeof VERSION;
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
}>;

/**
 * What one save changes: each entry here replaces the user's stored entry
 * under the same id, and `null` removes it. Entries not listed stay as they
 * are, so a save never touches what this Run did not change.
 */
export type StoredChanges = Readonly<{
  version: typeof VERSION;
  walkthroughs: Readonly<Record<string, WalkthroughProgress | null>>;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened" | null>>;
  /**
   * The whole record, written in place of whatever is stored, read or not:
   * what `replace` on a `recordUnreadable` problem saves.
   */
  replace?: true;
}>;

/** An entry left out of a record because Waymark could not read it. */
export type DroppedEntry = Readonly<{ walkthrough: string }> | Readonly<{ task: string }>;

/** What a record holds once read: copies, with no prototype, so any id is an ordinary key. */
export type Read = Readonly<{
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
  tasks: Stored;
  dropped: readonly DroppedEntry[];
}>;

/** `null`: nothing is stored. */
export type Parsed =
  | Readonly<{ ok: true; value: Read | null }>
  | Readonly<{ ok: false; error: RecordUnreadableError }>;

/**
 * A stored record Waymark cannot read: one a newer Waymark wrote, or not
 * Waymark's. `applyChanges` throws it rather than save over the record, and a
 * server's adapter can throw it too, so the Run reports `recordUnreadable`
 * rather than `storageFailed`. `stored` is the record, when it is known.
 */
export class RecordUnreadableError extends Error {
  override readonly name = "RecordUnreadableError";
  readonly stored: unknown;

  constructor(message: string, stored?: unknown) {
    super(message);
    this.stored = stored;
  }
}

/** By name, not `instanceof`, so an error from another copy of Waymark, such as a server's, counts. */
export const isRecordUnreadable = (error: unknown): error is RecordUnreadableError =>
  error instanceof Error && error.name === "RecordUnreadableError";

/** Progress part way through restores for a day after its last change. */
export const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is Stored[string] =>
  value === "done" || value === "skipped" || value === "reopened";

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

const NOT_OURS = "The stored record is not one Waymark wrote.";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Brought up to this version, then read entry by entry: an entry that cannot
 * be read is left out and named in `dropped`, and the rest are kept. Only a
 * record that is not Waymark's, or that a newer Waymark wrote, cannot be read.
 */
export function parseRecord(value: unknown): Parsed {
  if (value === null || value === undefined) return { ok: true, value: null };
  const unreadable = (why: string): Parsed => ({ ok: false, error: new RecordUnreadableError(why, value) });
  if (!isRecord(value)) return unreadable(NOT_OURS);
  const version = value["version"];
  if (!isIndex(version) || version === 0) return unreadable(NOT_OURS);
  if (version > VERSION) return unreadable(`The stored record is version ${version}; this Waymark reads up to ${VERSION}.`);
  let current: Readonly<Record<string, unknown>>;
  try {
    current = migrate(value);
  } catch (error) {
    return unreadable(message(error));
  }
  const walkthroughs = current["walkthroughs"];
  const tasks = current["tasks"];
  if (!isRecord(walkthroughs) || !isRecord(tasks)) return unreadable(NOT_OURS);

  const dropped: DroppedEntry[] = [];
  const progress = dictionary<WalkthroughProgress>();
  for (const [id, entry] of Object.entries(walkthroughs)) {
    if (!isProgress(entry)) {
      dropped.push({ walkthrough: id });
      continue;
    }
    const { status, step, stepCount, collapsed, changedAt } = entry;
    progress[id] = { status, step, stepCount, collapsed, changedAt };
  }
  const statuses = copy({});
  for (const [id, status] of Object.entries(tasks)) {
    if (isStatus(status)) statuses[id] = status;
    else dropped.push({ task: id });
  }
  return { ok: true, value: { walkthroughs: progress, tasks: statuses, dropped } };
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
 * is left, for an adapter or a server to write in its place. An older record
 * is brought up to this version, and entries it cannot read are left out. It
 * throws a `RecordUnreadableError` on a record it cannot read at all, such as
 * one a newer Waymark wrote, rather than write over it, unless the changes
 * `replace` it.
 */
export function applyChanges(stored: unknown, changes: StoredChanges): StoredRecord | null {
  const parsed = changes.replace === true ? { ok: true as const, value: null } : parseRecord(stored);
  if (!parsed.ok) {
    throw new RecordUnreadableError(`Waymark did not save over a record it cannot read. ${parsed.error.message}`, stored);
  }
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
