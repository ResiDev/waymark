import type { TaskMap } from "./types";

/** Throws for a task map or selection `createChecklists` cannot own. */
export function validate(
  tasks: TaskMap<any>,
  selections: Readonly<Record<string, readonly string[]>>,
): void {
  const taskIds = Object.keys(tasks);
  if (taskIds.length === 0)
    throw new Error("Checklists need at least one task.");
  if (taskIds.includes("")) throw new Error("A task id cannot be empty.");

  const names = Object.keys(selections);
  if (names.length === 0)
    throw new Error("Checklists need at least one checklist.");
  for (const name of names) {
    if (name === "") throw new Error("A checklist name cannot be empty.");
    const ids = selections[name]!;
    if (ids.length === 0)
      throw new Error(`Checklist "${name}" selects no tasks.`);
    const seen = new Set<string>();
    for (const id of ids) {
      if (!Object.hasOwn(tasks, id)) {
        throw new Error(`Checklist "${name}" selects unknown task "${id}".`);
      }
      if (seen.has(id))
        throw new Error(`Checklist "${name}" repeats task "${id}".`);
      seen.add(id);
    }
  }
}
