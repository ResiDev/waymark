import type { ActiveTask, ChecklistSnapshot, TaskStatus } from "./types";

/**
 * One named selection as the owner holds it: the snapshot its subscribers
 * last saw, and who they are.
 */
export type View<TTask extends { readonly id: string }> = {
  readonly name: string;
  readonly ids: readonly string[];
  snapshot: ChecklistSnapshot<TTask>;
  readonly listeners: Set<(snapshot: ChecklistSnapshot<TTask>) => void>;
};

/** Where a view's snapshot is read from: the owner's current state. */
export type ViewSource<TTask extends { readonly id: string }> = Readonly<{
  task: (id: string) => TTask;
  status: (name: string, id: string) => TaskStatus;
  active: () => ActiveTask<TTask> | null;
}>;

export function createView<TTask extends { readonly id: string }>(
  name: string,
  ids: readonly string[],
  source: ViewSource<TTask>,
): View<TTask> {
  return {
    name,
    ids,
    snapshot: snapshotOf(name, ids, source),
    listeners: new Set(),
  };
}

/**
 * Gives every view whose statuses or active Task changed a new snapshot, and
 * says which changed and which of those just became complete, in view order.
 * Any other view keeps its snapshot, so identity means "nothing to redraw".
 */
export function refresh<TTask extends { readonly id: string }>(
  views: readonly View<TTask>[],
  source: ViewSource<TTask>,
): Readonly<{ changed: View<TTask>[]; completed: View<TTask>[] }> {
  const changed: View<TTask>[] = [];
  const completed: View<TTask>[] = [];
  for (const view of views) {
    const next = snapshotOf(view.name, view.ids, source);
    if (sameSnapshot(view.snapshot, next)) continue;
    if (!view.snapshot.complete && next.complete) completed.push(view);
    view.snapshot = next;
    changed.push(view);
  }
  return { changed, completed };
}

function snapshotOf<TTask extends { readonly id: string }>(
  name: string,
  ids: readonly string[],
  source: ViewSource<TTask>,
): ChecklistSnapshot<TTask> {
  const rows = ids.map((id) => ({
    task: source.task(id),
    status: source.status(name, id),
  }));
  const finishedCount = rows.filter((row) => row.status !== "todo").length;
  const active = source.active();
  return {
    tasks: rows,
    finishedCount,
    taskCount: rows.length,
    complete: finishedCount === rows.length,
    active: active !== null && ids.includes(active.task.id) ? active : null,
  };
}

const sameSnapshot = <TTask extends { readonly id: string }>(
  a: ChecklistSnapshot<TTask>,
  b: ChecklistSnapshot<TTask>,
): boolean =>
  a.active === b.active &&
  a.tasks.every((row, index) => row.status === b.tasks[index]!.status);
