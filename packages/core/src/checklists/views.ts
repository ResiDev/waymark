import type { ActiveTask, ChecklistSnapshot, StorageStatus, TaskStatus } from "./types";

export type View<TTask extends { readonly id: string }> = {
  readonly name: string;
  readonly tasks: readonly TTask[];
  snapshot: ChecklistSnapshot<TTask>;
  /** The snapshot from before storage was read. */
  serverSnapshot: ChecklistSnapshot<TTask>;
  readonly listeners: Set<(snapshot: ChecklistSnapshot<TTask>) => void>;
};

export type ViewSource<TTask extends { readonly id: string }> = Readonly<{
  status: (id: string) => TaskStatus;
  active: () => ActiveTask<TTask> | null;
  storageStatus: () => StorageStatus;
}>;

export function createView<TTask extends { readonly id: string }>(
  name: string,
  tasks: readonly TTask[],
  source: ViewSource<TTask>,
): View<TTask> {
  const snapshot = snapshotOf(tasks, source);
  return { name, tasks, snapshot, serverSnapshot: snapshot, listeners: new Set() };
}

// A view that did not change keeps its snapshot, so identity means "nothing to redraw".
export function refresh<TTask extends { readonly id: string }>(
  views: readonly View<TTask>[],
  source: ViewSource<TTask>,
): Readonly<{ changed: View<TTask>[]; completed: View<TTask>[] }> {
  const changed: View<TTask>[] = [];
  const completed: View<TTask>[] = [];
  for (const view of views) {
    const next = snapshotOf(view.tasks, source);
    if (sameSnapshot(view.snapshot, next)) continue;
    if (!view.snapshot.complete && next.complete) completed.push(view);
    view.snapshot = next;
    changed.push(view);
  }
  return { changed, completed };
}

function snapshotOf<TTask extends { readonly id: string }>(
  tasks: readonly TTask[],
  source: ViewSource<TTask>,
): ChecklistSnapshot<TTask> {
  const rows = tasks.map((task) => ({
    task,
    status: source.status(task.id),
  }));
  const finishedCount = rows.filter((row) => row.status !== "todo").length;
  const active = source.active();
  return {
    tasks: rows,
    finishedCount,
    taskCount: rows.length,
    complete: finishedCount === rows.length,
    active:
      active !== null && tasks.some((task) => task.id === active.task.id)
        ? active
        : null,
    storageStatus: source.storageStatus(),
  };
}

const sameSnapshot = <TTask extends { readonly id: string }>(
  a: ChecklistSnapshot<TTask>,
  b: ChecklistSnapshot<TTask>,
): boolean =>
  a.active === b.active &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every((row, index) => row.status === b.tasks[index]?.status);
