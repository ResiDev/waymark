import type { Stored } from "./checklists";

/**
 * The optional browser persistence for a checklist record. Core never touches
 * local storage itself; this pairs with `stored` and `onChange`:
 *
 *   const record = createLocalStorageRecord("study-setup");
 *   createChecklists({ ..., stored: record.load(), onChange: record.save });
 *
 * Non-empty records are written as `{ version: 1, record }`. An empty record
 * removes the key. Missing, invalid, or unknown-version data loads as empty.
 * Storage errors (private mode, quota) are swallowed here and nowhere else:
 * load returns empty, save does nothing.
 */
export type StoredRecord = Readonly<{
  load: () => Stored;
  save: (stored: Stored) => void;
}>;

const VERSION = 1;
const EMPTY: Stored = { done: [], skipped: {} };

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A Stored value with exactly the shape core writes, and nothing else believed. */
const parse = (text: string | null): Stored => {
  if (text === null) return EMPTY;
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return EMPTY;
  }
  if (!isRecord(envelope) || envelope.version !== VERSION) return EMPTY;
  const record = envelope.record;
  if (!isRecord(record) || !isStringList(record.done) || !isRecord(record.skipped)) {
    return EMPTY;
  }
  const skipped: Record<string, readonly string[]> = Object.create(null);
  for (const [name, ids] of Object.entries(record.skipped)) {
    if (!isStringList(ids)) return EMPTY;
    skipped[name] = [...ids];
  }
  return { done: [...record.done], skipped };
};

const isEmpty = (stored: Stored): boolean =>
  stored.done.length === 0 && Object.values(stored.skipped).every((ids) => ids.length === 0);

export function createLocalStorageRecord(key: string): StoredRecord {
  return {
    load: () => {
      try {
        return parse(localStorage.getItem(key));
      } catch {
        return EMPTY;
      }
    },
    save: (stored) => {
      try {
        if (isEmpty(stored)) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ version: VERSION, record: stored }));
      } catch {
        // Storage is unavailable or full; progress stays in memory.
      }
    },
  };
}
