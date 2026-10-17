import { copy, EMPTY, statusIn } from "./record";
import type { Stored, StoredStatus } from "./record";
import type { TaskStatus } from "./types";

export type Statuses = Readonly<{
  /** A new object only after a write that changed it, so identity means "unchanged". */
  record: () => Stored;
  status: (id: string) => TaskStatus;
  isReopened: (id: string) => boolean;
  set: (id: string, status: StoredStatus | undefined) => void;
  replace: (stored: Stored) => void;
}>;

export function createStatuses(initial: Stored = EMPTY): Statuses {
  let record: Stored = copy(initial);

  return {
    record: () => record,
    status: (id) => statusIn(record, id),
    isReopened: (id) => record[id] === "reopened",
    set: (id, status) => {
      if (record[id] === status) return;
      const next = copy(record);
      if (status === undefined) delete next[id];
      else next[id] = status;
      record = next;
    },
    replace: (stored) => {
      record = copy(stored);
    },
  };
}
