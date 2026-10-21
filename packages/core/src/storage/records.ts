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
 * What one save changes, for an adapter's `savePartial`. Shaped unlike a
 * record on purpose: storing it as the record loses every entry it leaves
 * out, and Waymark refuses a stored one by name rather than read it as a
 * record with entries missing. Plain JSON, so it travels as a request body.
 */
export type RecordChanges = Readonly<{
  version: typeof VERSION;
  /** Entries to store, each in place of the one under its id. */
  set: Readonly<{
    walkthroughs: Readonly<Record<string, WalkthroughProgress>>;
    tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
  }>;
  /** Ids whose entries go. */
  remove: Readonly<{ walkthroughs: readonly string[]; tasks: readonly string[] }>;
  /**
   * `set` is the whole record, to store in place of whatever is stored, read
   * or not: what `replace` on a `recordUnreadable` problem saves. `remove` is
   * empty.
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

const STORED_CHANGES =
  "The stored record is a save's changes, not a record: an adapter's `savePartial` must store what applyChanges returns, not the changes it was given.";

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
  if ("set" in value && "remove" in value && !("walkthroughs" in value)) return unreadable(STORED_CHANGES);
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
): RecordChanges | undefined => {
  const set = { walkthroughs: dictionary<WalkthroughProgress>(), tasks: copy({}) };
  const remove = { walkthroughs: [] as string[], tasks: [] as string[] };
  for (const id of new Set([...Object.keys(before.progress), ...Object.keys(after.progress)])) {
    const progress = after.progress[id];
    if (before.progress[id] === progress) continue;
    if (progress === undefined) remove.walkthroughs.push(id);
    else set.walkthroughs[id] = progress;
  }
  for (const id of new Set([...Object.keys(before.statuses), ...Object.keys(after.statuses)])) {
    const status = after.statuses[id];
    if (before.statuses[id] === status) continue;
    if (status === undefined) remove.tasks.push(id);
    else set.tasks[id] = status;
  }
  const none = [set.walkthroughs, set.tasks].every((entries) => Object.keys(entries).length === 0);
  if (none && remove.walkthroughs.length === 0 && remove.tasks.length === 0) return undefined;
  return { version: VERSION, set, remove };
};

/** The whole record, as changes that store it in place of whatever is stored. */
export const replacing = (record: StoredRecord): RecordChanges => ({
  version: VERSION,
  set: { walkthroughs: record.walkthroughs, tasks: record.tasks },
  remove: { walkthroughs: [], tasks: [] },
  replace: true,
});

const NOTHING_REMOVED: RecordChanges["remove"] = { walkthroughs: [], tasks: [] };

/** Two saves' changes as one, the later's entries over the earlier's. */
export const combine = (earlier: RecordChanges, later: RecordChanges): RecordChanges => {
  if (later.replace === true) return later;
  const walkthroughs = Object.assign(dictionary<WalkthroughProgress>(), earlier.set.walkthroughs, later.set.walkthroughs);
  const tasks = Object.assign(copy({}), earlier.set.tasks, later.set.tasks);
  for (const id of later.remove.walkthroughs) delete walkthroughs[id];
  for (const id of later.remove.tasks) delete tasks[id];
  const set = { walkthroughs, tasks };
  // Whole, the record needs no removals: what it leaves out goes.
  if (earlier.replace === true) return { version: VERSION, set, remove: NOTHING_REMOVED, replace: true };
  // An id set later is no longer removed.
  const removed = (earlierIds: readonly string[], laterIds: readonly string[], setLater: Readonly<Record<string, unknown>>) => [
    ...new Set([...earlierIds.filter((id) => !Object.hasOwn(setLater, id)), ...laterIds]),
  ];
  return {
    version: VERSION,
    set,
    remove: {
      walkthroughs: removed(earlier.remove.walkthroughs, later.remove.walkthroughs, later.set.walkthroughs),
      tasks: removed(earlier.remove.tasks, later.remove.tasks, later.set.tasks),
    },
  };
};

/** What is stored, read, with `changes` made to it, or `null` once nothing is left. */
export const merge = (stored: Read | null, changes: RecordChanges): StoredRecord | null => {
  const base = changes.replace === true ? null : stored;
  const walkthroughs = Object.assign(dictionary<WalkthroughProgress>(), base?.walkthroughs, changes.set.walkthroughs);
  const tasks = Object.assign(copy(base?.tasks ?? {}), changes.set.tasks);
  for (const id of changes.remove.walkthroughs) delete walkthroughs[id];
  for (const id of changes.remove.tasks) delete tasks[id];
  const next = storedRecord(walkthroughs, tasks);
  return isEmptyRecord(next) ? null : next;
};

const NOT_CHANGES = "Waymark cannot save these changes: they are not ones a Run sent.";

const isIds = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");

/**
 * Changes as `savePartial` sent them, checked, as `parseRecord` checks a
 * record, though here one entry it cannot read refuses them all: a server
 * stores nothing it did not check.
 */
export function readChanges(value: unknown): RecordChanges {
  if (!isRecord(value)) throw new Error(NOT_CHANGES);
  if (!("set" in value) && "walkthroughs" in value && "tasks" in value) {
    throw new Error(
      "Waymark cannot save these changes: they are a whole record. An adapter's `save` gets the whole record, to store as it is, without applyChanges.",
    );
  }
  const { version, set, remove, replace } = value;
  if (isIndex(version) && version > VERSION) {
    throw new Error(`Waymark cannot save these changes: they are version ${version}, and this Waymark reads up to ${VERSION}.`);
  }
  if (version !== VERSION || !isRecord(set) || !isRecord(remove) || (replace !== undefined && replace !== true)) {
    throw new Error(NOT_CHANGES);
  }
  const { walkthroughs, tasks } = set;
  if (!isRecord(walkthroughs) || !isRecord(tasks) || !isIds(remove["walkthroughs"]) || !isIds(remove["tasks"])) {
    throw new Error(NOT_CHANGES);
  }
  const read = { walkthroughs: dictionary<WalkthroughProgress>(), tasks: copy({}) };
  for (const [id, progress] of Object.entries(walkthroughs)) {
    if (!isProgress(progress)) throw new Error(`${NOT_CHANGES} Walkthrough "${id}"'s progress cannot be read.`);
    const { status, step, stepCount, collapsed, changedAt } = progress;
    read.walkthroughs[id] = { status, step, stepCount, collapsed, changedAt };
  }
  for (const [id, status] of Object.entries(tasks)) {
    if (!isStatus(status)) throw new Error(`${NOT_CHANGES} Task "${id}"'s status cannot be read.`);
    read.tasks[id] = status;
  }
  const removed = { walkthroughs: [...remove["walkthroughs"]], tasks: [...remove["tasks"]] };
  return replace === true ? { version, set: read, remove: removed, replace } : { version, set: read, remove: removed };
}

/**
 * The stored record with a save's changes made to it, or `null` once nothing
 * is left, for a `savePartial` adapter or its server to store in its place.
 * `changes` is what `savePartial` was given, or that parsed from a request
 * body: it is checked, and anything else throws. An older record is brought
 * up to this version, and entries it cannot read are left out. It throws a
 * `RecordUnreadableError` on a record it cannot read at all, such as one a
 * newer Waymark wrote, rather than write over it, unless the changes
 * `replace` it.
 */
export function applyChanges(stored: unknown, changes: unknown): StoredRecord | null {
  const read = readChanges(changes);
  const parsed = read.replace === true ? { ok: true as const, value: null } : parseRecord(stored);
  if (!parsed.ok) {
    throw new RecordUnreadableError(`Waymark did not save over a record it cannot read. ${parsed.error.message}`, stored);
  }
  return merge(parsed.value, read);
}

export const storedRecord = (
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>,
  tasks: Stored,
): StoredRecord => ({ version: VERSION, walkthroughs: { ...walkthroughs }, tasks: { ...tasks } });

const isEmptyRecord = (record: StoredRecord): boolean =>
  Object.keys(record.walkthroughs).length === 0 && Object.keys(record.tasks).length === 0;
