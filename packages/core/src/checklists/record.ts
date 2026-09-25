/**
 * The persisted record, and the pure functions that keep it in one canonical
 * form whichever way it arrives: from storage, `load`, or a command.
 */

/**
 * One persisted record per owner. Done is shared by every view; skipped is
 * per checklist. The active Run is not stored. No version field: storage
 * adapters wrap the record in their own envelope.
 */
export type Stored = Readonly<{
  done: readonly string[];
  skipped: Readonly<Record<string, readonly string[]>>;
  /**
   * Tasks with a condition taken back from done, which the condition does not
   * complete again until it has been false. Omitted when empty.
   */
  reopened?: readonly string[];
}>;

export const EMPTY: Stored = { done: [], skipped: {} };

export const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const sameRecord = (a: Stored, b: Stored): boolean => {
  if (!sameList(a.done, b.done)) return false;
  if (!sameList(a.reopened ?? [], b.reopened ?? [])) return false;
  const names = Object.keys(a.skipped);
  return (
    sameList(names, Object.keys(b.skipped)) &&
    names.every((name) => sameList(a.skipped[name]!, b.skipped[name] ?? []))
  );
};

export const isEmpty = (record: Stored): boolean =>
  record.done.length === 0 &&
  Object.keys(record.skipped).length === 0 &&
  (record.reopened ?? []).length === 0;

/**
 * Deduplicate; done removes a Task from every skipped list and from
 * reopened; known ids come first in task map order and known names first in
 * declaration order, with unknown ones after in input order. Empty lists are
 * dropped.
 */
export function normalise(
  stored: Stored,
  taskIds: readonly string[],
  viewNames: readonly string[],
): Stored {
  const known = new Set(taskIds);
  const orderIds = (ids: readonly string[]): string[] => {
    const wanted = new Set(ids);
    return [
      ...taskIds.filter((id) => wanted.has(id)),
      ...unique(ids).filter((id) => !known.has(id)),
    ];
  };

  const done = orderIds(stored.done);
  const doneSet = new Set(done);
  const names = [
    ...viewNames.filter((name) => Object.hasOwn(stored.skipped, name)),
    ...Object.keys(stored.skipped).filter((name) => !viewNames.includes(name)),
  ];
  const skipped: Record<string, readonly string[]> = Object.create(null);
  for (const name of names) {
    const ids = orderIds(stored.skipped[name] ?? []).filter(
      (id) => !doneSet.has(id),
    );
    if (ids.length > 0) skipped[name] = ids;
  }
  const reopened = orderIds(stored.reopened ?? []).filter((id) => !doneSet.has(id));
  return reopened.length > 0 ? { done, skipped, reopened } : { done, skipped };
}
