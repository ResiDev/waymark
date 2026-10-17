import { dictionary } from "../dictionary";
import { checkedWalkthrough } from "../walkthrough/walkthrough";
import type { Step } from "../walkthrough/types";
import type {
  ChecklistDefinition,
  ChecklistGroup,
  ChecklistSelections,
  ChecklistsConfig,
  ChecklistsDefinition,
  DefaultChecklists,
  DefinedTask,
  NamedTask,
  Task,
  TaskMap,
} from "./types";
import { DEFAULT_CHECKLIST } from "./types";
import { select } from "./validate";

/**
 * Describes Tasks and the checklists that list them. It holds no state: a
 * Run keeps each Task's status, and takes these in the first time one of the
 * checklists is used.
 */
export function defineChecklists<
  const TTasks extends TaskMap,
  const TSelections extends ChecklistSelections<TTasks> =
    DefaultChecklists<TTasks>,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- passed by an adapter, never inferred.
  TShape = Task,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- passed by an adapter, never inferred.
  TStepShape extends Step = Step,
>(
  config: ChecklistsConfig<
    TTasks,
    TSelections,
    NoInfer<TShape>,
    NoInfer<TStepShape>
  >,
): ChecklistsDefinition<TTasks, TSelections>;
// The body works on the Tasks widened to `Task`, as TypeScript cannot follow
// each Task it hands back to the exact type the caller wrote. It checks this
// signature against the one above only loosely, so this one reuses the same
// types with each generic at its constraint.
export function defineChecklists(
  config: ChecklistsConfig<TaskMap, ChecklistSelections<TaskMap>>,
): ChecklistsDefinition<TaskMap, ChecklistSelections<TaskMap>> {
  const named = dictionary<NamedTask<TaskMap>>();
  for (const [id, task] of Object.entries(config.tasks)) named[id] = { ...task, id };
  const selected = select(named, config.checklists ?? { [DEFAULT_CHECKLIST]: Object.keys(config.tasks) });

  const tasks: DefinedTask[] = Object.values(named).map((task) => {
    const { id, walkthrough } = task;
    return {
      id,
      task,
      // Inline steps, checked here because no `defineWalkthrough` call checks them.
      walkthrough:
        walkthrough === undefined || "steps" in walkthrough
          ? walkthrough
          : checkedWalkthrough(id, walkthrough, `Task "${id}": `),
      isComplete: task.isComplete,
    };
  });
  const checklists: ChecklistDefinition<NamedTask<TaskMap>>[] = [];
  const group: ChecklistGroup = { tasks, checklists };
  const byName = dictionary<ChecklistDefinition<NamedTask<TaskMap>>>();
  for (const [name, selection] of selected) {
    const checklist = { name, tasks: selection, group };
    checklists.push(checklist);
    byName[name] = checklist;
  }
  return { checklists: byName };
}
