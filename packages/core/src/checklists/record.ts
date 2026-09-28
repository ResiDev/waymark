import { dictionary } from "../dictionary";
import type { TaskStatus } from "./types";

/**
 * No version field: a storage adapter wraps the record in its own envelope.
 *
 * `reopened` is todo for a Task taken back from done. Its condition may still
 * hold, so it stays todo until the condition has been false.
 */
export type Stored = Readonly<Record<string, "done" | "skipped" | "reopened">>;

export type StoredStatus = Stored[string];

export const copy = (record: Stored): Record<string, StoredStatus> =>
  Object.assign(dictionary<StoredStatus>(), record);

export const EMPTY: Stored = Object.freeze(copy({}));

export const isEmpty = (record: Stored): boolean =>
  Object.keys(record).length === 0;

export const statusIn = (record: Stored, id: string): TaskStatus => {
  const status = record[id];
  return status === "done" || status === "skipped" ? status : "todo";
};
