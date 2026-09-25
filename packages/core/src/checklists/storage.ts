import { copy, EMPTY, isEmpty } from "./record";
import type { Stored, StoredStatus } from "./record";

/**
 * The optional browser persistence for a checklist record. Core never touches
 * local storage itself; it loads and saves through this:
 *
 *   createChecklists({ ..., storage: createLocalStorageRecord("study-setup") });
 *
 * Non-empty records are written as `{ version: 2, record }`. An empty record
 * removes the key. Missing, invalid, or unknown-version data loads as empty.
 * Storage errors (private mode, quota) are swallowed here and nowhere else:
 * load returns empty, save does nothing.
 */
export type StoredRecord = Readonly<{
  load: () => Stored;
  save: (stored: Stored) => void;
}>;

const VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is StoredStatus =>
  value === "done" || value === "skipped" || value === "reopened";

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
  if (!isRecord(record) || !Object.values(record).every(isStatus)) return EMPTY;
  return copy(record as Stored);
};

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
