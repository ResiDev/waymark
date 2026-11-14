# Checklists

A checklist lists tasks for a new user. A task can carry a walkthrough, and an `isComplete` condition that ticks it when the user does the task on their own. `run.checklist(definition)` gives one checklist's state and commands.

Add this to the script from the README's [first walkthrough](../README.md#a-first-walkthrough-in-plain-dom). It uses the same `run`, and that renderer draws a task's walkthrough like any other:

```ts
import { defineChecklists } from "waymark-core";

type AppContext = { hasProject: boolean };

const onboarding = defineChecklists({
  tasks: {
    tour: { walkthrough: [{ waymark: "new-project", meta: "Every project starts here." }], meta: "Take the tour" },
    project: { isComplete: (c: AppContext) => c.hasProject, meta: "Create a project" },
  },
});

// The facts the conditions read. Pass `context` to createRun to set them from the start.
run.setContext({ hasProject: false } satisfies AppContext);

// Marked as Waymark UI, so ticking a task while a walkthrough is open isn't a click away from it.
const list = document.createElement("ul");
list.setAttribute("data-waymark-ui", "");
document.body.append(list);

const checklist = run.checklist(onboarding.checklists.main);

// One row per task, made once and updated in place, so a keyboard user's focus survives each update.
const rows = new Map(
  checklist.getSnapshot().tasks.map(({ task }) => {
    const row = document.createElement("li");
    const tick = document.createElement("button");
    tick.setAttribute("role", "checkbox");
    tick.textContent = String(task.meta);
    tick.addEventListener("click", () => checklist.toggle(task.id));
    const show = document.createElement("button");
    show.textContent = "Show me";
    show.addEventListener("click", () => checklist.start(task.id));
    row.append(tick);
    if ("walkthrough" in task) row.append(show);
    list.append(row);
    return [task.id, { tick, show }] as const;
  }),
);

const stopList = checklist.subscribe((snapshot) => {
  for (const { task, status } of snapshot.tasks) {
    const row = rows.get(task.id);
    row?.tick.setAttribute("aria-checked", String(status === "done"));
    if (row) row.show.hidden = status !== "todo";
  }
});

// When the user creates a project, give the Run the new facts, and the task ticks.
export const projectCreated = () => run.setContext({ hasProject: true } satisfies AppContext);

// Call this alongside teardown.
export function removeChecklist() {
  stopList();
  list.remove();
}
```

Style `[aria-checked="true"]` to show a ticked task.

## How a task gets done

- **With `isComplete`,** a task is done the first time its condition holds, even if the user skipped it, and stays done if the condition turns false. Finishing its walkthrough doesn't tick it.
- **Without one,** a task is done when its walkthrough finishes.
- **The user** can tick, untick and skip tasks. A task they untick stays todo until something new happens: its condition turning false and then true again, or, without one, its walkthrough running again.

## When conditions run

- **Only while the Run has a `context`,** and again on each `setContext` with a new object. Passing the same object back, changed, does nothing, so always pass a new one.
- **Only once their checklists are in use.** Subscribing to any checklist from a `defineChecklists` call, or giving it a command, brings in every task from that call for the rest of the Run's life. Until then, its conditions don't run: a checklist you only draw on one page doesn't tick while the user is elsewhere, and a condition that's only true for a moment is missed. Subscribe to it once at start-up if its tasks should tick everywhere.

Without `checklists` in the definition, every task is in one checklist, `checklists.main`. Keep task ids unique across all your `defineChecklists` calls, and don't give a task with inline steps the id of another walkthrough, since those steps take their task's id; [`defineChecklists`](api.md#definechecklistsconfig) says what happens otherwise.
