export function select<TTask>(
  named: Readonly<Record<string, TTask>>,
  selections: Readonly<Record<string, readonly string[]>>,
): (readonly [name: string, tasks: readonly TTask[]])[] {
  const taskIds = Object.keys(named);
  if (taskIds.length === 0)
    throw new Error("Checklists need at least one task.");
  if (taskIds.includes("")) throw new Error("A task id cannot be empty.");

  const entries = Object.entries(selections);
  if (entries.length === 0)
    throw new Error("Checklists need at least one checklist.");
  return entries.map(([name, ids]) => {
    if (name === "") throw new Error("A checklist name cannot be empty.");
    if (ids.length === 0)
      throw new Error(`Checklist "${name}" selects no tasks.`);
    const seen = new Set<string>();
    const tasks = ids.map((id) => {
      const task = named[id];
      if (task === undefined) {
        throw new Error(`Checklist "${name}" selects unknown task "${id}".`);
      }
      if (seen.has(id))
        throw new Error(`Checklist "${name}" repeats task "${id}".`);
      seen.add(id);
      return task;
    });
    return [name, tasks] as const;
  });
}
