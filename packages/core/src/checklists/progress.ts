import { copy, EMPTY, isEmpty, statusIn } from "./record";
import type { Stored, StoredStatus } from "./record";
import type { TaskStatus } from "./types";

/**
 * One owner's record of each Task's status, shared by every view. Ids the
 * owner does not know are kept as they arrived.
 */
export type Progress = Readonly<{
  /** A new object only after a write that changed it, so identity means "unchanged". */
  record: () => Stored;
  status: (id: string) => TaskStatus;
  isReopened: (id: string) => boolean;
  /** Undefined makes the Task plain todo. */
  set: (id: string, status: StoredStatus | undefined) => void;
  /** Authoritative replacement. */
  replace: (stored: Stored) => void;
  /** Empties the record, unknown ids included. */
  clear: () => void;
}>;

export function createProgress(initial: Stored = EMPTY): Progress {
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
    clear: () => {
      if (!isEmpty(record)) record = EMPTY;
    },
  };
}
