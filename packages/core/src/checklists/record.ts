import { dictionary } from "../dictionary";
import type { TaskStatus } from "./types";

/**
 * Each Task's status, as the stored record keeps it. `reopened` is todo for a
 * Task taken back from done. Its condition may still hold, so it stays todo
 * until the condition has been false.
 */
export type Stored = Readonly<Record<string, "done" | "skipped" | "reopened">>;

export type StoredStatus = Stored[string];

export const copy = (record: Stored): Record<string, StoredStatus> =>
  Object.assign(dictionary<StoredStatus>(), record);

export const EMPTY: Stored = Object.freeze(copy({}));

export const statusIn = (record: Stored, id: string): TaskStatus => {
  const status = record[id];
  return status === "done" || status === "skipped" ? status : "todo";
};
