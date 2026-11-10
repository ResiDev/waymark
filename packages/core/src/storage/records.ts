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
  /**
   * When each walkthrough was last reset, epoch ms, for one with no entry
   * since. Whichever is newer, a walkthrough's entry or its reset, wins, and
   * at the same time the entry. Left
   * out when there are none, and an older Waymark leaves it out when it saves.
   */
  resets?: Readonly<Record<string, number>>;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
}>;

/** When each walkthrough was reset, by id. */
export type Resets = Readonly<Record<string, number>>;

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
    /** Resets, each in place of the walkthrough's entry unless that changed later. Its id is in `remove` too, for an older server. */
    resets?: Resets;
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
  resets: Resets;
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

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Each reset that can be read, and each whose walkthrough has no entry changed since. */
function readResets(value: unknown, walkthroughs: Readonly<Record<string, WalkthroughProgress>>): Resets {
  const resets = dictionary<number>();
  if (!isRecord(value)) return resets;
  for (const [id, at] of Object.entries(value)) {
    const entry = walkthroughs[id];
    if (isTime(at) && (entry === undefined || at > entry.changedAt)) resets[id] = at;
  }
  return resets;
}

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
  // A reset no newer than its walkthrough's entry is spent; the entry wins.
  const resets = readResets(current["resets"], progress);
  for (const id of Object.keys(resets)) delete progress[id];
  return { ok: true, value: { walkthroughs: progress, resets, tasks: statuses, dropped } };
}

/** Progress part way through that its walkthrough cannot pick up again. Ended progress stays ended. */
export const staleness = (
  progress: WalkthroughProgress,
  stepCount: number,
  maxAge: number,
  now: number,
): "stepsChanged" | "expired" | undefined => {
  if (progress.status !== "running") return undefined;
  if (progress.stepCount !== stepCount) return "stepsChanged";
  return now - progress.changedAt > maxAge ? "expired" : undefined;
};

/** The entries that differ between two moments, or none. Entries are replaced, never changed in place, so identity says which. */
export const changesBetween = (
  before: Readonly<{ progress: Readonly<Record<string, WalkthroughProgress>>; resets: Resets; statuses: Stored }>,
  after: Readonly<{ progress: Readonly<Record<string, WalkthroughProgress>>; resets: Resets; statuses: Stored }>,
): RecordChanges | undefined => {
  const set = { walkthroughs: dictionary<WalkthroughProgress>(), tasks: copy({}) };
  // A reset gone is not sent: it went because an entry newer than it came, and that entry is sent.
  const resets = dictionary<number>();
  for (const [id, at] of Object.entries(after.resets)) if (before.resets[id] !== at) resets[id] = at;
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
  const none = [set.walkthroughs, resets, set.tasks].every((entries) => Object.keys(entries).length === 0);
  if (none && remove.walkthroughs.length === 0 && remove.tasks.length === 0) return undefined;
  return { version: VERSION, set: withResets(set, resets), remove };
};

/** `set` with `resets`, left out when there are none, so changes without a reset are shaped as before. */
const withResets = <T extends object>(set: T, resets: Resets | undefined): T & { resets?: Resets } =>
  resets === undefined || Object.keys(resets).length === 0 ? set : { ...set, resets };

/** The whole record, as changes that store it in place of whatever is stored. */
export const replacing = (record: StoredRecord): RecordChanges => ({
  version: VERSION,
  set: withResets({ walkthroughs: record.walkthroughs, tasks: record.tasks }, record.resets),
  remove: { walkthroughs: [], tasks: [] },
  replace: true,
});

const NOTHING_REMOVED: RecordChanges["remove"] = { walkthroughs: [], tasks: [] };

/** The ids of the entries `changes` sets or removes, walkthroughs and tasks apart. */
export type ChangedIds = Readonly<{ walkthroughs: Set<string>; tasks: Set<string> }>;

/** Adds the ids `changes` sets or removes to `ids`. */
export const noteIds = (ids: ChangedIds, changes: RecordChanges): void => {
  for (const id of [...Object.keys(changes.set.walkthroughs), ...Object.keys(changes.set.resets ?? {}), ...changes.remove.walkthroughs]) ids.walkthroughs.add(id);
  for (const id of [...Object.keys(changes.set.tasks), ...changes.remove.tasks]) ids.tasks.add(id);
};

/** `changes` but for the entries named in `ids`, or `undefined` once none is left. A replace stays whole: it is one record. */
export const without = (changes: RecordChanges, ids: ChangedIds): RecordChanges | undefined => {
  if (changes.replace === true) return changes;
  const walkthroughs = dictionary<WalkthroughProgress>();
  for (const [id, progress] of Object.entries(changes.set.walkthroughs)) if (!ids.walkthroughs.has(id)) walkthroughs[id] = progress;
  const resets = dictionary<number>();
  for (const [id, at] of Object.entries(changes.set.resets ?? {})) if (!ids.walkthroughs.has(id)) resets[id] = at;
  const tasks = copy({});
  for (const [id, status] of Object.entries(changes.set.tasks)) if (!ids.tasks.has(id)) tasks[id] = status;
  const remove = {
    walkthroughs: changes.remove.walkthroughs.filter((id) => !ids.walkthroughs.has(id)),
    tasks: changes.remove.tasks.filter((id) => !ids.tasks.has(id)),
  };
  const none = [walkthroughs, resets, tasks].every((entries) => Object.keys(entries).length === 0);
  if (none && remove.walkthroughs.length === 0 && remove.tasks.length === 0) return undefined;
  return { version: VERSION, set: withResets({ walkthroughs, tasks }, resets), remove };
};

/** Two saves' changes as one, the later's entries over the earlier's. */
export const combine = (earlier: RecordChanges, later: RecordChanges): RecordChanges => {
  if (later.replace === true) return later;
  const walkthroughs = Object.assign(dictionary<WalkthroughProgress>(), earlier.set.walkthroughs, later.set.walkthroughs);
  const resets = Object.assign(dictionary<number>(), earlier.set.resets, later.set.resets);
  const tasks = Object.assign(copy({}), earlier.set.tasks, later.set.tasks);
  for (const id of later.remove.walkthroughs) delete walkthroughs[id];
  for (const id of later.remove.tasks) delete tasks[id];
  // An entry set later is newer than an earlier reset of it.
  for (const id of Object.keys(later.set.walkthroughs)) delete resets[id];
  const set = withResets({ walkthroughs, tasks }, resets);
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

/**
 * What is stored, read, with `changes` made to it, or `null` once nothing is
 * left. For each walkthrough the newest wins, of its stored entry, its stored
 * reset, and what `changes` sets: so an older save that lands last does not
 * take the place of a newer entry, nor bring back one reset since. At the same
 * time the change wins over an entry, and an entry over a reset. A removal
 * with no reset always goes through, and a replace stores its record whole.
 */
export const merge = (stored: Read | null, changes: RecordChanges): StoredRecord | null => {
  const base = changes.replace === true ? null : stored;
  const walkthroughs = Object.assign(dictionary<WalkthroughProgress>(), base?.walkthroughs);
  const resets = Object.assign(dictionary<number>(), base?.resets);
  for (const [id, progress] of Object.entries(changes.set.walkthroughs)) {
    const kept = walkthroughs[id];
    const reset = resets[id];
    if ((kept !== undefined && kept.changedAt > progress.changedAt) || (reset !== undefined && reset > progress.changedAt)) continue;
    walkthroughs[id] = progress;
    delete resets[id];
  }
  const resetNow = changes.set.resets ?? {};
  for (const [id, at] of Object.entries(resetNow)) {
    const kept = walkthroughs[id];
    if (kept !== undefined && kept.changedAt >= at) continue;
    delete walkthroughs[id];
    resets[id] = Math.max(at, resets[id] ?? at);
  }
  const tasks = Object.assign(copy(base?.tasks ?? {}), changes.set.tasks);
  // A reset's removal is the reset's, decided above; it is in `remove` for an older server.
  for (const id of changes.remove.walkthroughs) if (!Object.hasOwn(resetNow, id)) delete walkthroughs[id];
  for (const id of changes.remove.tasks) delete tasks[id];
  const next = storedRecord(walkthroughs, tasks, resets);
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
  const resets = dictionary<number>();
  if (set["resets"] !== undefined) {
    if (!isRecord(set["resets"])) throw new Error(NOT_CHANGES);
    for (const [id, at] of Object.entries(set["resets"])) {
      if (!isTime(at)) throw new Error(`${NOT_CHANGES} Walkthrough "${id}"'s reset cannot be read.`);
      resets[id] = at;
    }
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
  const setRead = withResets(read, resets);
  return replace === true ? { version, set: setRead, remove: removed, replace } : { version, set: setRead, remove: removed };
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

/** `resets` is left out when there are none, so a record without one is shaped as before. */
export const storedRecord = (
  walkthroughs: Readonly<Record<string, WalkthroughProgress>>,
  tasks: Stored,
  resets: Resets = {},
): StoredRecord =>
  Object.keys(resets).length === 0
    ? { version: VERSION, walkthroughs: { ...walkthroughs }, tasks: { ...tasks } }
    : { version: VERSION, walkthroughs: { ...walkthroughs }, resets: { ...resets }, tasks: { ...tasks } };

const isEmptyRecord = (record: StoredRecord): boolean =>
  Object.keys(record.walkthroughs).length === 0 && Object.keys(record.resets ?? {}).length === 0 && Object.keys(record.tasks).length === 0;
