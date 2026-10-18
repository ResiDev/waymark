import type { Slice, Write } from "../run/layer";
import { copy, statusIn } from "./record";
import type { Stored, StoredStatus } from "./record";
import type { TaskStatus } from "./types";

/*
 * Changed from today: the statuses no longer hold their own record. They are
 * the checklists layer's slice of the Run's record, so this is a change's view
 * of that slice: reads come from it, writes go through the change's Write.
 * `replace` goes: a record restored or heard sets the slice whole. About 35 lines.
 */

export type Statuses = Readonly<{
  /** A new object only after a write that changed it, so identity means "unchanged". */
  record: () => Stored;
  status: (id: string) => TaskStatus;
  isReopened: (id: string) => boolean;
  set: (id: string, status: StoredStatus | undefined) => void;
}>;

export function statusesIn(slice: Slice<Stored>, write: Write): Statuses {
  return {
    record: slice.get,
    status: (id) => statusIn(slice.get(), id),
    isReopened: (id) => slice.get()[id] === "reopened",
    set: (id, status) => {
      const record = slice.get();
      if (record[id] === status) return;
      const next = copy(record);
      if (status === undefined) delete next[id];
      else next[id] = status;
      write.set(slice, next);
    },
  };
}
