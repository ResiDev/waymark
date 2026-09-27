import { dictionary } from "../dictionary";
import type { TaskStatus } from "./types";

/**
 * The persisted record: one entry per Task that is not plain todo, the same
 * in every view. The active Run is not stored. No version field: storage
 * adapters wrap the record in their own envelope.
 *
 * `reopened` is todo, taken back from done, for a Task whose condition does
 * not complete it again until it has been false.
 */
export type Stored = Readonly<Record<string, "done" | "skipped" | "reopened">>;

export type StoredStatus = Stored[string];

/** A copy with a null prototype, so ids such as `toString` or `__proto__` are ordinary keys. */
export const copy = (record: Stored): Record<string, StoredStatus> =>
  Object.assign(dictionary<StoredStatus>(), record);

export const EMPTY: Stored = Object.freeze(copy({}));

export const isEmpty = (record: Stored): boolean =>
  Object.keys(record).length === 0;

/** A Task's status in a record. No entry, or `reopened`, is todo. */
export const statusIn = (record: Stored, id: string): TaskStatus => {
  const status = record[id];
  return status === "done" || status === "skipped" ? status : "todo";
};
