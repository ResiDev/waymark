import { EMPTY, isEmpty, normalise } from "./record";
import type { Stored } from "./record";
import type { TaskStatus } from "./types";

/**
 * One owner's record of what is done and what each checklist has skipped.
 *
 * Every write goes through `normalise`, so the record is always in its one
 * canonical form: done drops a Task from every skipped list, and ids and names
 * keep task map and declaration order. The adding writes return what they
 * actually changed, so the owner announces just that.
 */
export type Progress = Readonly<{
  /** A new object after every write; compare with `sameRecord`. */
  record: () => Stored;
  isDone: (id: string) => boolean;
  status: (name: string, id: string) => TaskStatus;
  /** Records done. Returns the ids that were not done already. */
  addDone: (ids: readonly string[]) => readonly string[];
  /**
   * Records skipped in each checklist. Returns the ones it was not skipped in
   * already; none for a done Task.
   */
  addSkipped: (id: string, names: readonly string[]) => readonly string[];
  /**
   * Done back to todo, in every checklist. `reopen` keeps the Task's condition
   * from completing it again until the condition has been false. Returns
   * whether it was done.
   */
  removeDone: (id: string, reopen: boolean) => boolean;
  /** Skipped back to todo in each checklist. Returns the ones it was skipped in. */
  removeSkipped: (id: string, names: readonly string[]) => readonly string[];
  isReopened: (id: string) => boolean;
  /** Lets these Tasks' conditions complete them again. */
  forgetReopened: (ids: readonly string[]) => void;
  /** Authoritative replacement. */
  replace: (stored: Stored) => void;
  /** Empties the record, unknown ids included. */
  clear: () => void;
}>;

export function createProgress(
  taskIds: readonly string[],
  viewNames: readonly string[],
  initial: Stored = EMPTY,
): Progress {
  let record = normalise(initial, taskIds, viewNames);
  let done = new Set(record.done);

  const replace = (next: Stored) => {
    record = normalise(next, taskIds, viewNames);
    done = new Set(record.done);
  };

  const isSkipped = (name: string, id: string): boolean =>
    record.skipped[name]?.includes(id) ?? false;

  // Null-prototype, so a checklist named `__proto__` is an ordinary key.
  const copySkipped = (): Record<string, readonly string[]> =>
    Object.assign(Object.create(null), record.skipped);

  return {
    record: () => record,
    isDone: (id) => done.has(id),
    status: (name, id) =>
      done.has(id) ? "done" : isSkipped(name, id) ? "skipped" : "todo",
    addDone: (ids) => {
      const fresh = ids.filter((id) => !done.has(id));
      if (fresh.length > 0) {
        replace({ ...record, done: [...record.done, ...fresh] });
      }
      return fresh;
    },
    addSkipped: (id, names) => {
      if (done.has(id)) return [];
      const fresh = names.filter((name) => !isSkipped(name, id));
      if (fresh.length === 0) return fresh;
      const skipped = copySkipped();
      for (const name of fresh)
        skipped[name] = [...(record.skipped[name] ?? []), id];
      replace({ ...record, skipped });
      return fresh;
    },
    removeDone: (id, reopen) => {
      if (!done.has(id)) return false;
      replace({
        ...record,
        done: record.done.filter((doneId) => doneId !== id),
        reopened: reopen ? [...(record.reopened ?? []), id] : (record.reopened ?? []),
      });
      return true;
    },
    removeSkipped: (id, names) => {
      const removed = names.filter((name) => isSkipped(name, id));
      if (removed.length === 0) return removed;
      const skipped = copySkipped();
      for (const name of removed)
        skipped[name] = record.skipped[name]!.filter((skippedId) => skippedId !== id);
      replace({ ...record, skipped });
      return removed;
    },
    isReopened: (id) => record.reopened?.includes(id) ?? false,
    forgetReopened: (ids) => {
      if (!ids.some((id) => record.reopened?.includes(id))) return;
      replace({ ...record, reopened: record.reopened!.filter((id) => !ids.includes(id)) });
    },
    replace,
    clear: () => {
      if (!isEmpty(record)) replace(EMPTY);
    },
  };
}
