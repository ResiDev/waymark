# Checklists

A checklist is a list of tasks for a new user, such as "Create a project" or "Invite a teammate". Each task can carry a walkthrough that shows the user how.

```tsx
import { Checklist, defineChecklists } from "react-waymark";
import { invite } from "./walkthroughs";

export const onboarding = defineChecklists({
  tasks: {
    project: {
      title: "Create a project",
      walkthrough: [
        { waymark: "new-project", advance: "click", content: "Every project starts here." },
        { waymark: "create-project", advance: "click", content: "Name it and create it." },
      ],
    },
    invite: { title: "Invite a teammate", description: "Projects work better with everyone in.", walkthrough: invite },
  },
});

export function GetStarted() {
  return <Checklist checklist={onboarding.checklists.main} title="Get started" />;
}
```

Render `<GetStarted />` anywhere inside `<WaymarkRoot>`. `<Checklist>` draws the list, with a progress bar, a checkbox for each task, a "Show me" button that starts the task's walkthrough, and a Skip button. The user can tick a task by hand, and finishing its walkthrough ticks it too, unless it has a condition ([below](#tick-tasks-from-your-apps-state)). Task statuses are saved with walkthrough progress, in the root's [`storage`](storage.md#save-progress-for-each-user).

While a walkthrough is open, a click on an inline `<Checklist>` counts as clicking away from it. To stop that, put `data-waymark-ui` on an element around the checklist; Show me then interrupts the open walkthrough instead.

A task's walkthrough gets a Skip task button in its popover, which skips the task and exits the walkthrough. It only works while the task is todo: on the walkthrough of a done or skipped task, such as one opened with Show me again, it does nothing.

A task's `walkthrough` can be one from `defineWalkthrough`, such as `invite` from [Steps](walkthroughs.md#steps), or steps written inline, which get the task's id as their walkthrough id.

## Tick tasks from your app's state

A task can also tick itself when the user does it on their own, without the walkthrough. Give it an `isComplete` condition, and give `<WaymarkRoot>` the facts it reads as `context`:

```tsx
import type { ReactNode } from "react";
import { Checklist, WaymarkRoot, defaultBeacon, defaultPopover, defineChecklists } from "react-waymark";

type AppContext = { hasProject: boolean; invited: boolean };

export const firstSteps = defineChecklists({
  tasks: {
    project: { title: "Create a project", isComplete: (c: AppContext) => c.hasProject },
    invite: { title: "Invite a teammate", isComplete: (c: AppContext) => c.invited },
  },
});

export function App({ context, children }: { context: AppContext; children: ReactNode }) {
  return (
    <WaymarkRoot context={context} renderPopover={defaultPopover} renderBeacon={defaultBeacon}>
      <Checklist checklist={firstSteps.checklists.main} />
      {children}
    </WaymarkRoot>
  );
}
```

- **Conditions are checked again when `context` changes** to a new object. Put everything your conditions read into it, so a change to any of it is noticed. Without a `context`, conditions don't run.
- **Type it on each condition**, as in `(c: AppContext) => c.invited`, since `<WaymarkRoot>` can't know your context's type. For a task written in a module of its own, write `satisfies ReactTask<AppContext>` after it.
- **Conditions run once their checklists are in use.** As soon as you render `<Checklist>`, call `useChecklist`, use the checklist parts, or run one of its commands, every task from that `defineChecklists` call stays active for as long as the root is mounted. Until then, its conditions don't run: if your checklist only shows on one page, a project created elsewhere isn't ticked until the user visits it, and a condition that's only true for a moment is missed. To have tasks tick on every page, call [`useChecklist(firstSteps.checklists.main)`](#draw-your-own-checklist) once in a component near the root.

## How a task gets done

A task is `todo`, `done` or `skipped`.

- **A task with `isComplete`** is done the first time its condition holds, whether or not the user ran its walkthrough, and even if they skipped it. It stays done if the condition later turns false. Finishing its walkthrough doesn't tick it: only the condition does.
- **A task without one** is done when its walkthrough finishes.
- **The user can also** tick a task by hand, untick it, or skip it.

A task the user unticks stays todo until something new happens. With a condition, the condition has to turn false and then true again. Without one, the user has to run its walkthrough again.

For a task the user does elsewhere in your app, `action: { label: "Open billing", onSelect: () => navigate("/billing") }` puts your own button in place of "Show me". `toggleable: false` takes the checkbox away from `<Checklist>` and the checklist parts, for a task only your condition should tick. `markDone` and `toggle` from `useChecklist` still work on it. All the task fields are in the [reference](api.md#task-fields).

## More than one checklist

Without `checklists`, every task goes in one checklist named `main`. Name your own to show different tasks in different places. A task in two checklists has one status, shared by both.


```tsx
import { defineChecklists } from "react-waymark";

export const guidance = defineChecklists({
  tasks: {
    invite: { title: "Invite a teammate" },
    project: { title: "Create a project" },
    billing: { title: "Add a payment method" },
  },
  checklists: {
    setup: ["invite", "project"],
    admin: ["billing"],
  },
});

// <Checklist checklist={guidance.checklists.setup} />
```

Keep task ids unique across all your `defineChecklists` calls. A task with inline steps gives its id to that walkthrough, so don't give such a task the id of another walkthrough. The examples on this page reuse `project` and `invite` only because each stands alone; [Task fields](api.md#task-fields) says what happens when two calls share an id.

## Draw your own checklist

`useChecklist` gives you one checklist's state and commands, and you draw the rest:

```tsx
import { useChecklist } from "react-waymark";
import { onboarding } from "./onboarding";

export function GettingStarted() {
  const { snapshot, start, skip } = useChecklist(onboarding.checklists.main);
  if (snapshot.complete) return <p>You're all set.</p>;
  return (
    <ul>
      {snapshot.tasks.map(({ task, status, walkthrough }) => (
        <li key={task.id}>
          {status === "done" ? "✓" : "○"} {task.title}
          {status === "todo" && "walkthrough" in task && (
            <button onClick={() => start(task.id)}>{walkthrough === "collapsed" ? "Continue" : "Show me"}</button>
          )}
          {status === "todo" && <button onClick={() => skip(task.id)}>Skip</button>}
        </li>
      ))}
    </ul>
  );
}
```

To keep `<Checklist>`'s frame and change only its rows, pass `renderRow`, which gets the same task, status and commands.

## A checklist in a header popover

For a checklist that opens from a button in your header, `ChecklistRoot`, `ChecklistTrigger` and `ChecklistPanel` handle hover, presses, the keyboard and placement, and you style them. A finished one, in a Tailwind version and a CSS modules version, is in [`packages/react/registry/checklist-popover`](https://github.com/ResiDev/waymark/tree/main/packages/react/registry/checklist-popover) on GitHub. Copy the one you want into your app and change it as you like. Each part's props are in the [reference](api.md#checklist-parts).
