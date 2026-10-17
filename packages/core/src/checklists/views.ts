import type { ChecklistSnapshot, StorageStatus, TaskStatus } from "./types";

export type View<TTask extends { readonly id: string }> = {
  readonly name: string;
  readonly tasks: readonly TTask[];
  readonly source: ViewSource;
  snapshot: ChecklistSnapshot<TTask>;
  /** The snapshot from before storage was read. */
  readonly serverSnapshot: ChecklistSnapshot<TTask>;
  readonly listeners: Set<(snapshot: ChecklistSnapshot<TTask>) => void>;
};

/** Each by Task id. */
export type ViewSource = Readonly<{
  status: (id: string) => TaskStatus;
  inProgress: (id: string) => boolean;
  isOpen: (id: string) => boolean;
  storageStatus: () => StorageStatus;
}>;

export function createView<TTask extends { readonly id: string }>(
  name: string,
  tasks: readonly TTask[],
  source: ViewSource,
  serverSource: ViewSource,
): View<TTask> {
  return {
    name,
    tasks,
    source,
    snapshot: snapshotOf(tasks, source),
    serverSnapshot: snapshotOf(tasks, serverSource),
    listeners: new Set(),
  };
}

// A view that did not change keeps its snapshot, so identity means "nothing to redraw".
export function refresh<TTask extends { readonly id: string }>(
  views: Iterable<View<TTask>>,
): Readonly<{ changed: View<TTask>[]; completed: View<TTask>[] }> {
  const changed: View<TTask>[] = [];
  const completed: View<TTask>[] = [];
  for (const view of views) {
    const next = snapshotOf(view.tasks, view.source);
    if (sameSnapshot(view.snapshot, next)) continue;
    if (!view.snapshot.complete && next.complete) completed.push(view);
    view.snapshot = next;
    changed.push(view);
  }
  return { changed, completed };
}

function snapshotOf<TTask extends { readonly id: string }>(
  tasks: readonly TTask[],
  source: ViewSource,
): ChecklistSnapshot<TTask> {
  const rows = tasks.map((task) => ({
    task,
    status: source.status(task.id),
    inProgress: source.inProgress(task.id),
  }));
  const finishedCount = rows.filter((row) => row.status !== "todo").length;
  return {
    tasks: rows,
    finishedCount,
    taskCount: rows.length,
    complete: finishedCount === rows.length,
    open: tasks.find((task) => source.isOpen(task.id)) ?? null,
    storageStatus: source.storageStatus(),
  };
}

const sameSnapshot = <TTask extends { readonly id: string }>(
  a: ChecklistSnapshot<TTask>,
  b: ChecklistSnapshot<TTask>,
): boolean =>
  a.open === b.open &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every(
    (row, index) => row.status === b.tasks[index]?.status && row.inProgress === b.tasks[index].inProgress,
  );
