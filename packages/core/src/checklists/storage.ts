import { copy, EMPTY, isEmpty } from "./record";
import type { Stored, StoredStatus } from "./record";

export type StoredRecord = Readonly<{
  load: () => Stored;
  save: (stored: Stored) => void;
}>;

const VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is StoredStatus =>
  value === "done" || value === "skipped" || value === "reopened";

const isStored = (value: unknown): value is Stored =>
  isRecord(value) && Object.values(value).every(isStatus);

const parse = (text: string | null): Stored => {
  if (text === null) return EMPTY;
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return EMPTY;
  }
  if (!isRecord(envelope) || envelope["version"] !== VERSION) return EMPTY;
  const record = envelope["record"];
  return isStored(record) ? copy(record) : EMPTY;
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
        // Private mode or a full quota; progress stays in memory.
      }
    },
  };
}
