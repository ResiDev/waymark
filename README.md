# Waymark

<!-- Video: drag apps/demo/out/v13/waymark.mp4 into this file on github.com and paste the link it gives here. -->

Walkthroughs and onboarding checklists for React. A walkthrough shows a popover beside an element in your app, one step at a time, and moves to the next step when the user does what the step asks, such as clicking a button, typing a valid email, or reaching some state your app can check. Nobody has to press Next.

A walkthrough is what other tools call a product tour or an onboarding tour. Waymark calls it a walkthrough everywhere, in the API and in these docs, and [CONTEXT.md](CONTEXT.md) defines the rest of its words.

```sh
npm install react-waymark
```

React 18 or 19. `react-waymark` brings `waymark-core` with it. A walkthrough adds about 14 kB gzipped to your bundle, and everything, checklists included, about 17 kB.

Waymark hasn't reached 1.0, so its API may still change.

## A first walkthrough

Wrap your app in `<WaymarkRoot>`. Then mark the elements a walkthrough points at with `data-waymark`, define its steps, and render it. Waymark calls each of those elements a waymark.

```tsx
import { useState } from "react";
import { Walkthrough, WaymarkRoot, defineWalkthrough } from "react-waymark";

const isEmail = (input: Element | null) =>
  input instanceof HTMLInputElement && /^\S+@\S+\.\S{2,}$/.test(input.value);

export const inviteWalkthrough = defineWalkthrough({
  id: "invite",
  steps: [
    { waymark: "invite", advance: "click", content: "Invite someone to get started." },
    { waymark: "invite-email", advance: { state: isEmail, delayMs: 700 }, content: "Type a teammate's email." },
    { waymark: "send-invite", advance: "click", content: "And send it." },
  ],
});

export function App({ userId }: { userId: string }) {
  return (
    <WaymarkRoot key={userId} storage={`waymark:${userId}`}>
      <Header />
    </WaymarkRoot>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header>
      <button data-waymark="invite" onClick={() => setOpen(true)}>
        Invite
      </button>
      {open && (
        <form onSubmit={(event) => { event.preventDefault(); setOpen(false); }}>
          <input data-waymark="invite-email" type="email" />
          <button data-waymark="send-invite">Send invite</button>
        </form>
      )}
      <Walkthrough walkthrough={inviteWalkthrough} />
    </header>
  );
}
```

The first step waits for a click on Invite. The second watches the email field and moves on once it has held a valid address for 700ms. The third finishes the walkthrough when the invite is sent.

`<WaymarkRoot>` makes the user's Run, which keeps how far they are through every walkthrough and draws the one that is open. Render it once, around your whole app. `<Walkthrough>` draws nothing itself. When it mounts, it asks the Run to show its walkthrough, which waits its turn if another one is open. `useRun`, `<Walkthrough>`, `<Checklist>` and `useChecklist` all need a `<WaymarkRoot>` above them.

`storage` is a localStorage key. Waymark saves the step the user is on, whether the walkthrough is collapsed, and whether it has finished or exited. A reload puts the user back where they were. `<Walkthrough>` never brings back a walkthrough the user has finished or exited, unless you [reset](#starting-a-walkthrough) it. The root reads `storage` only when it mounts, so `key={userId}` gives each user a new Run that reads their own record.

`id` names the walkthrough in the saved record, so keep it the same across releases. Define each walkthrough once, outside any component, and give each its own id. In development, Waymark throws when two different definitions share an id.

### What the user can do

- Click anywhere outside the popover and its waymark, or press Escape, and the walkthrough collapses to a pulsing beacon on the waymark. Clicking the beacon reopens it on the same step. A step without a waymark puts its beacon at the bottom of the screen. A walkthrough with [`dismiss: "exit"`](#dismissing) ends instead.
- Use Next and Previous, or the arrow keys when they aren't typing in a field. Next stays disabled while a step's advance condition is unmet, and reads Finish on the last step.
- Press Tab to move between the popover and the waymark. Focus stays within the two.
- Close it with the × button. That exits the walkthrough, and the stored record keeps it exited.

A click within 20px of the waymark counts as a click on it. The same distance separates the waymark from the edge of its cut-out in the shade, and from the popover. Change it with `waymarkPadding` on `<WaymarkRoot>`.

### `defineWalkthrough`

| Field | What it does |
| --- | --- |
| `id` | Names the walkthrough in the saved record. Required, and must stay the same across releases. |
| `steps` | The steps, in order. See [Steps](#steps). |
| `dismiss` | What a click away, Escape and being interrupted do: `"collapse"`, the default, or `"exit"`. See [Dismissing](#dismissing). |
| `maxAge` | In ms. Progress left part way through for longer than this starts again. Defaults to a day. |
| `renderPopover`, `renderBeacon` | This walkthrough's own drawing, which wins over the root's. See [Changing the look](#changing-the-look). |

### `<WaymarkRoot>` props

| Prop | What it does |
| --- | --- |
| `storage` | A localStorage key or an adapter for this user's record. Without it, progress lasts until the page reloads. See [Saving progress](#saving-progress). |
| `initial`, `onChange` | A record you already hold, and a function that hears each change to it. See [Saving progress](#saving-progress). |
| `context` | Your app's facts, read by checklists' completion conditions. See [Checklists](#checklists). |
| `onEvent` | Hears what every walkthrough and checklist does. See [Events and analytics](#events-and-analytics). |
| `problemHandlers` | One set for every walkthrough and checklist. See [Problem handlers](#problem-handlers). |
| `labels`, `renderPopover`, `renderBeacon` | See [Changing the look](#changing-the-look). |
| `waymarkPadding` | In px. Defaults to 20. |
| `portal` | `false` renders the popover and beacons inside `<WaymarkRoot>`, after its children, not in `document.body`. Defaults to `true`. |

The root calls the `onEvent`, `onChange` and `problemHandlers` from its latest render, so you can write them inline.

### `<Walkthrough>` props

| Prop | What it does |
| --- | --- |
| `walkthrough` | The walkthrough to ask for. |
| `active` | `false` holds the request back, for example until your data has loaded. Defaults to `true`. |

Unmounting `<Walkthrough>` withdraws a request still waiting its turn. It doesn't close a walkthrough that has already opened.

## Starting a walkthrough

`<Walkthrough>` suits a walkthrough a page shows by itself. To start one from your own code, get the Run with `useRun()`:

```tsx
import { useRun } from "react-waymark";
import { inviteWalkthrough } from "./header";

export function HelpMenu() {
  const run = useRun();
  return <button onClick={() => run.start(inviteWalkthrough)}>How do I invite someone?</button>;
}
```

The Run has two ways to start a walkthrough, and the difference is who asked. `run.start(walkthrough)` is for a click by the user, and shows it now. `run.requestStart(walkthrough)` is for your app choosing to show one. It waits until no walkthrough is open, so it never interrupts the user, and it never brings back a walkthrough they have finished or exited. It returns a function that withdraws the request while it waits. `<Walkthrough>` calls `requestStart`.

| Its progress | `start` | `requestStart` |
| --- | --- | --- |
| None | Opens at step 1, now. | Opens at step 1 once nothing is open. |
| Part way | Opens where it was, now. | Nothing. It stays as it was. |
| Finished or exited | Starts again at step 1. | Nothing. |

`run.reset(walkthrough)` starts a walkthrough again from step 1, whatever its progress. An open one goes back to its first step, and any other is forgotten, as if the user had never started it.

`run.act(action, walkthrough)` does what the user can: `advance`, `previous`, `collapse`, `resume`, `reset` or `exit`. Without a walkthrough, it acts on the open one. A walkthrough that isn't open takes only `resume`, `reset` and `exit`.

### One at a time

At most one walkthrough is open. When `start` opens a walkthrough while another is open, the open one is set aside as its `dismiss` says. By default it collapses and keeps its step. With `dismiss: "exit"`, it exits. Either way it fires `interrupt` in place of `collapse` or `exit`, so your analytics can tell it apart from the user turning away.

No beacons show while a walkthrough is open. Once none is open, every collapsed walkthrough shows its beacon on its step's waymark, and the user picks which one to go back to. A beacon whose waymark isn't on the page has nowhere to sit. Only the walkthrough collapsed most recently puts its beacon at the bottom of the screen. The others wait until their waymark is found.

When the open walkthrough finishes, exits or collapses, a waiting `requestStart` goes first. The beacons show once nothing is open.

### Dismissing

```ts
import { defineWalkthrough } from "react-waymark";

export const filtersHelp = defineWalkthrough({
  id: "filtersHelp",
  dismiss: "exit",
  steps: [
    { waymark: "filter-status", content: "Pick which statuses to show." },
    { waymark: "save-view", content: "Save the combination as a view." },
  ],
});
```

`dismiss` says what a click away, Escape and being interrupted do to a walkthrough. `"collapse"`, the default, suits onboarding the user should come back to. The popover hides behind a beacon, and the walkthrough keeps its step. `"exit"` suits help the user asked for. The walkthrough ends, as × ends it, and fires `exit` in place of `collapse`.

`dismiss` changes only what happens when the user turns away. A `collapse` from your own Later button still collapses, and × still exits.

An exit is stored like any other. With `"exit"`, one stray click ends a stored walkthrough until the user starts it again or you reset it, and `<Walkthrough>` and `requestStart` won't bring it back. Keep onboarding on the default.

## Steps

Every field but `content` is optional.

| Field | What it does |
| --- | --- |
| `content` | What the popover shows. Any React node. |
| `waymark` | Points at the element with `data-waymark="<value>"`. |
| `selector` | Points at an element you can't mark, by CSS selector. A step has `waymark` or `selector`, not both. |
| `advance` | What has to happen before the walkthrough can move on. See below. |
| `preferredPlacement` | `"above"`, `"below"`, `"left"` or `"right"` of the waymark. Defaults to `"below"`. Waymark picks another side when this one has no room. |
| `scroll` | `"once"`, the default, scrolls the waymark into view the first time it is off-screen. Also `"always"` or `"never"`. |
| `missingAfterMs` | How long to look for the waymark before calling it missing. Defaults to 3000. |
| `popoverStyle` | Inline styles for the default popover. |
| `meta` | Anything of yours. It comes back in events, render props and problems. |

A step with no waymark shows its popover in the middle of the screen.

### Advance conditions

```ts
advance: "click"                                  // a click on the waymark
advance: { event: "input" }                       // any DOM event the waymark fires
advance: { event: ["change", "blur"] }            // any of several
advance: { state: (waymark) => boolean }          // checked once a frame
advance: { state: isEmail, delayMs: 700 }         // must hold for 700ms without a break
advance: { click: true, then: "unlock" }          // unlock Next instead of moving on
```

`state` gets the waymark element, or `null` while it isn't on the page, so it can read the element itself. It can also ignore it and check anything in your app.

By default a met condition moves the walkthrough on by itself. With `then: "unlock"` it enables Next and leaves the move to the user. `then` and `delayMs` go with any of the object forms.

A step without `advance` has a Next button that works straight away.

### When the waymark isn't there

Waymark looks for a step's waymark every frame. If it hasn't appeared after half a second, the popover shows in the middle of the screen while the page catches up. After `missingAfterMs` it counts as missing. The popover then says it can't find what the step points to, and Next unlocks so the user is never stuck behind a condition they can't meet. A waymark that was found and then leaves the page for 200ms is lost, and gets the same treatment. Both reach your [problem handlers](#problem-handlers).

## Checklists

A checklist is a list of tasks for a user to get through, such as "Invite a teammate" or "Create a project". A task can carry a short walkthrough the user starts from the checklist, and a completion condition that ticks it off when the user does the task on their own.

```tsx
import { Checklist, WaymarkRoot, defineChecklists } from "react-waymark";

type AppContext = { invited: boolean; hasProject: boolean };

export const onboarding = defineChecklists({
  tasks: {
    invite: {
      title: "Invite a teammate",
      description: "Plotline works best with everyone in.",
      isComplete: (c: AppContext) => c.invited,
    },
    project: {
      title: "Create a project",
      walkthrough: [
        { waymark: "new-project", advance: "click", content: "Every project starts here." },
        { waymark: "create-project", advance: "click", content: "Name it and create it." },
      ],
      isComplete: (c: AppContext) => c.hasProject,
    },
  },
});

export function App({ userId, context }: { userId: string; context: AppContext }) {
  return (
    <WaymarkRoot key={userId} storage={`waymark:${userId}`} context={context}>
      <Checklist checklist={onboarding.checklists.main} />
    </WaymarkRoot>
  );
}
```

`defineChecklists` describes the tasks and the checklists that list them, as `defineWalkthrough` describes a walkthrough. It holds no state. Each task's status lives in the user's Run, and is saved in the same record as their walkthrough progress.

`context` on `<WaymarkRoot>` is the information your completion conditions read. When the facts change, pass a new object, and Waymark checks the conditions again. A condition that now holds ticks its task off. The root can't know your context's type, so write it on each condition, as in `(c: AppContext) => c.invited`. A task written apart from `defineChecklists` can take it from `satisfies ReactTask<AppContext>` instead.

`<Checklist>` draws the list. When the user starts a task, `<WaymarkRoot>` draws its walkthrough like any other.

### Tasks

A task is `todo`, `done` or `skipped`. The user can tick it, skip it, or press "Show me" to start its walkthrough. A task with `isComplete` is done when the condition holds, whether or not its walkthrough ran, and even if the user skipped it. A task without one is done when its walkthrough finishes.

| Field | What it does |
| --- | --- |
| `title` | Any React node. |
| `description` | Any React node, shown under the title. |
| `walkthrough` | A walkthrough from `defineWalkthrough`, or steps written inline. Inline steps become a walkthrough whose id is the task's id. |
| `isComplete` | `(context: AppContext) => boolean`. It must be pure. |
| `action` | `{ label, onSelect }`, a button in place of "Show me", for a task the user does somewhere else in your app. |
| `toggleable` | `false` stops the user ticking it by hand. Defaults to `true`. |
| `meta` | Anything of yours. |

Starting a task sets the open walkthrough aside as its `dismiss` says, so several tasks can be in progress at once. A task is in progress while its walkthrough is collapsed part way. Each one shows its beacon once nothing is open.

A task's walkthrough has a "Skip task" button. Its × button exits the walkthrough and leaves the task todo, so the user can start it again from the checklist, at step 1.

### A checklist's commands

`useChecklist`, `renderRow` and `ChecklistRoot` hand you these. Each takes a task's id.

| Command | What it does |
| --- | --- |
| `start(id)` | Shows the task's walkthrough as `run.start` does, where it was if part way through and otherwise from step 1. Does nothing if the task has no walkthrough. |
| `markDone(id)` | Marks the task done. |
| `markTodo(id)` | Takes a done or skipped task back to todo. A task with a condition stays todo until the condition has been false. |
| `skip(id)` | Skips a todo task, and exits its walkthrough if it is running. |
| `toggle(id)` | Ticks a todo task, and takes a done or skipped one back to todo. |

### More than one checklist

Without `checklists`, every task goes in one checklist named `main`. Name your own to show different tasks in different places. A task in two checklists has one status, shared by both.

```ts
import { defineChecklists } from "react-waymark";

const guidance = defineChecklists({
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

guidance.checklists.setup; // pass to <Checklist> or useChecklist
```

### Drawing your own checklist

`useChecklist` gives you one checklist's snapshot and its commands, and you draw the rest.

```tsx
import { useChecklist } from "react-waymark";
import { onboarding } from "./onboarding";

export function GettingStarted() {
  const { snapshot, start, skip } = useChecklist(onboarding.checklists.main);
  if (snapshot.complete) return <p>You're all set.</p>;
  return (
    <ul>
      {snapshot.tasks.map(({ task, status, inProgress }) => (
        <li key={task.id}>
          {status === "done" ? "✓" : "○"} {task.title}
          {status === "todo" && "walkthrough" in task && (
            <button onClick={() => start(task.id)}>{inProgress ? "Carry on" : "Show me"}</button>
          )}
          {status === "todo" && <button onClick={() => skip(task.id)}>Skip</button>}
        </li>
      ))}
    </ul>
  );
}
```

| Snapshot field | What it holds |
| --- | --- |
| `tasks` | Each task with its `status`, and `inProgress` while its walkthrough is collapsed part way, in the checklist's order. |
| `finishedCount` | Tasks done or skipped. |
| `taskCount` | Tasks in the checklist. |
| `complete` | `true` once every task is done or skipped. |
| `open` | The task whose walkthrough is open, or `null` when no task in this checklist has its walkthrough open. |
| `storageStatus` | `"loading"`, `"ready"` or `"error"`. While loading, every task shows todo. |

### A checklist in a popover

For a checklist that opens from a button in your header, the headless parts handle hover, focus, keyboard and placement, and you style them.

- `ChecklistRoot` takes the checklist and renders no element of its own. Its children can be a function of the checklist's state, which adds `open`, whether the panel is open, to what `useChecklist` returns.
- `ChecklistTrigger` is the button. It sets `data-state` to `open` or `closed`, and `data-running` while one of the checklist's tasks has its walkthrough open.
- `ChecklistPanel` is the popover. Its `side` defaults to below, its `gap` to 8px, and it renders in `document.body` unless `portal={false}`. It sets `data-side` to the side it took, `data-running`, and a `--waymark-available-height` CSS variable with the room it has.
- `ChecklistTask` is a row. It and the `ChecklistCheckbox` and `ChecklistTaskTitle` inside it set `data-status`, `data-open` while the task's walkthrough is open, and `data-in-progress` while it is collapsed part way.

A finished popover built from them is in [`packages/react/registry/checklist-popover`](packages/react/registry/checklist-popover), in a Tailwind version and a CSS modules version. Copy the one you want into your app and change it as you like.

## Changing the look

The default popover and beacon are styled inline, with no stylesheet to import. They sit at `z-index` 51, over a shade at 50, and render in `document.body`, so no transform, overflow or stacking context in your layout can clip them.

### Labels

Translate or reword the default text with `labels` on `<WaymarkRoot>`:

```tsx
<WaymarkRoot labels={{ next: "Weiter", previous: "Zurück", finish: "Fertig", stepOf: (step, count) => `${step} / ${count}` }}>
  <App />
</WaymarkRoot>
```

| Label | Default |
| --- | --- |
| `next` | Next |
| `previous` | Previous |
| `finish` | Finish |
| `skipTask` | Skip task |
| `missing` | Can't find the part of the page this step points to. You can carry on, but the next steps may not match what you see. |
| `close` | Close |
| `resume` | Resume walkthrough |
| `stepOf` | `` (step, count) => `Step ${step} of ${count}` `` |

`close`, `resume` and `stepOf` become accessible names, so they take strings. The rest take any React node.

`<Checklist>` has labels of its own. `start` defaults to "Show me", `replay` to "Show me again" on a done task, and `skip` to "Skip".

### Your own popover and beacon

To draw the popover yourself, pass `renderPopover` to `<WaymarkRoot>`, and it draws every walkthrough's popover. Waymark still places it and handles the keyboard. It gets:

| Prop | What it is |
| --- | --- |
| `currentStep` | The step, with your own fields such as `content` and `meta`. |
| `snapshot` | The walkthrough, with `stepIndex`, `stepCount` and `canAdvance`. |
| `placement` | The side of the waymark Waymark put it on. |
| `waymarkFound` | `false` while the popover is centred because the step has no waymark, or it isn't on the page. |
| `labels` | Your labels over the defaults. |
| `advance`, `previous`, `collapse`, `reset`, `exit` | What the user can do. |
| `skipTask` | Only in a task's walkthrough. |

`renderBeacon` works the same way for the beacon, with `currentStep`, `waymarkFound`, `labels`, `resume` and `exit`. A render function that returns `null` gets the default instead.

```tsx
<WaymarkRoot
  renderPopover={({ currentStep, snapshot, advance, previous, collapse }) => (
    <div className="walkthrough-card">
      <p>{currentStep.content}</p>
      <button onClick={previous} disabled={snapshot.stepIndex === 0}>Back</button>
      <button onClick={advance} disabled={!snapshot.canAdvance}>Next</button>
      <button onClick={collapse}>Later</button>
    </div>
  )}
>
  <App />
</WaymarkRoot>
```

A walkthrough can carry its own `renderPopover` and `renderBeacon`, which win over the root's for that walkthrough. The root's functions draw every walkthrough, so they can't know the type of a step's `meta`. A definition's own see its steps with their exact types:

```tsx
const whatsNew = defineWalkthrough({
  id: "whatsNew",
  steps: [{ waymark: "export", content: "Export any board as a PDF.", meta: { image: "/new/export.png" } }],
  renderPopover: ({ currentStep, advance }) => (
    <div className="announcement">
      <img src={currentStep.meta.image} alt="" />
      <p>{currentStep.content}</p>
      <button onClick={advance}>Got it</button>
    </div>
  ),
});
```

A click anywhere else in your app counts as clicking away, and collapses the walkthrough or, with `dismiss: "exit"`, ends it. Add `data-waymark-ui` to an element, such as a help menu, to keep clicks inside it from doing that.

### `<Checklist>`

`<Checklist>` takes `style` for the list and `rowStyle` for each row. `renderRow` replaces a row's content, and gets the `task`, its `status`, whether its walkthrough is `open` or `inProgress`, and the checklist's commands.

## Saving progress

Give `<WaymarkRoot>` a `storage`, and Waymark keeps one record for the user: every walkthrough's progress and every task's status. A string is a localStorage key. For anything else, pass an adapter:

```ts
import type { StorageAdapter, StoredRecord } from "react-waymark";

export const server: StorageAdapter<StoredRecord> = {
  load: () => fetch("/api/waymark").then((r) => (r.ok ? r.json() : null)),
  save: (value) => {
    void fetch("/api/waymark", { method: "PUT", body: JSON.stringify(value) });
  },
};
```

`load` and `save` can be synchronous or return a promise. `save(null)` clears. Until `load` settles, the Run's `storageStatus` is `"loading"`. It holds the user's actions and your commands until the record is in, then runs them in order. It doesn't wait for `save`. A click on Next moves the walkthrough at once, and a save that fails keeps the change and reports `storageFailed`.

Without `storage`, progress lasts as long as the Run, which is until the page reloads or the root gets a new `key`. The root reads `storage` only when it mounts. Give each user their own key, and `key={user.id}`, so a new user gets a new Run that reads their record and leaves the last user's alone.

An adapter can also have `subscribe(listener)` to hear changes made elsewhere. Task statuses take them at once, so with the localStorage adapter a task ticked in one tab is ticked in the others. Walkthrough progress doesn't follow. Each tab keeps its own, and its next save wins.

Waymark checks every record it loads. A record it can't read is a `recordUnreadable` problem, and the user starts fresh. Waymark doesn't save over that record until the user changes something. Each walkthrough's progress is checked when its definition reaches the Run. Progress part way through is dropped, and the walkthrough starts fresh, if the walkthrough's number of steps has changed since, or if the user left it for longer than its `maxAge`, a day by default. A finished or exited walkthrough stays that way. Each drop reaches your [problem handlers](#problem-handlers).

A walkthrough's definition reaches the Run when something uses it, such as `start`, a mounted `<Walkthrough>`, or a mounted `<Checklist>` that lists its task. Until then its restored progress waits, and shows no beacon. A walkthrough that was open when the page unloaded opens again once its definition arrives, if nothing else is open. Otherwise it is set aside as its `dismiss` says.

If you already have the record, from a server render for example, pass it as `initial`. The Run then doesn't load from storage, though it still saves to it. `onChange` hears the whole record each time it changes, for an app that keeps it itself.

On the server, `<WaymarkRoot>` draws no walkthrough, and checklists render their state from before storage was read, so hydration matches.

## Events and analytics

`onEvent` on `<WaymarkRoot>` hears every walkthrough's events and every checklist's, in the order they happened:

```tsx
<WaymarkRoot
  onEvent={(event) => {
    if ("walkthrough" in event) {
      analytics.track(`Walkthrough ${event.type}`, { walkthrough: event.walkthrough, step: event.stepIndex + 1 });
    } else {
      analytics.track(event.type, event.type === "checklistComplete" ? { checklist: event.checklist } : { task: event.task.id });
    }
  }}
>
  <App />
</WaymarkRoot>
```

A walkthrough's event names it by id in `walkthrough`. Its `type` is one of `start`, `advance`, `previous`, `collapse`, `resume`, `reset`, `exit`, `finish` or `interrupt`. Each event has the `step` and `stepIndex` it happened on and a `snapshot` of the walkthrough after it.

`start` fires the first time a walkthrough is drawn, and again when it starts over after finishing or exiting. Going back to a collapsed walkthrough fires `resume`. `interrupt` fires in place of `collapse` or `exit` when another walkthrough starts over this one, and names that one in `interruptedBy`. A waymark that goes missing or is lost is a [problem](#problem-handlers), not an event.

Task events are `taskStarted`, `taskComplete`, `taskReopened`, `taskSkipped`, `taskUnskipped`, `taskStopped` and `checklistComplete`. A `taskStopped` event's `reason` is `finished`, `skipped` or `stopped`. A change's task events come after its walkthrough events.

To follow the Run's state rather than its events, subscribe to it with `useRun().subscribe(listener)`. Subscribing changes nothing on the page.

## Problem handlers

Everything that goes wrong is a problem. Storage can fail, a stored record can be unreadable or out of date, a waymark can be missing from the page, and your own functions can throw. Give `problemHandlers` on `<WaymarkRoot>` a function for each type of problem you want to handle:

```tsx
<WaymarkRoot
  problemHandlers={{
    storageFailed: () => toast("Your progress won't be saved on this device"),
    waymarkMissing: (problem) =>
      analytics.track("walkthrough_waymark_missing", { walkthrough: problem.walkthrough, step: problem.stepIndex }),
    callbackThrew: (problem) => Sentry.captureException(problem.error),
  }}
>
  <App />
</WaymarkRoot>
```

Each handler hears only its own type, so `waymarkMissing` reads `problem.stepIndex` without checking `problem.type` first. A type you leave out keeps Waymark's default. This root still logs a record it can't read. One set of handlers hears every walkthrough and checklist.

| `type` | When | Carries | Default |
| --- | --- | --- | --- |
| `storageFailed` | An adapter's `load` or `save` threw or rejected | `error` | logged |
| `recordUnreadable` | A stored record Waymark didn't write, or a newer version than it reads | `error` | logged |
| `recordDropped` | Waymark dropped a walkthrough's stored progress rather than resume it | `walkthrough`, `reason` | nothing |
| `waymarkMissing` | A step's waymark wasn't found within `missingAfterMs`, reported once per step | `walkthrough`, `step`, `stepIndex` | nothing |
| `waymarkLost` | A step's waymark was found, then left the page, reported each time it goes | `walkthrough`, `step`, `stepIndex` | nothing |
| `callbackThrew` | One of your own functions threw | `callback`, `error` | thrown |

`walkthrough` is the walkthrough's id. A dropped walkthrough's `reason` is `expired` or `stepsChanged`. `callback` names the function that threw: `subscriber`, `onEvent`, `onChange`, `stateCheck` or `isComplete`. Since one set of handlers hears every walkthrough, `step` is typed as any walkthrough's step, and its `meta` as `unknown`.

The defaults behave like plain JavaScript. Waymark throws the errors from your functions. Storage problems go to `console.error` instead, because they come from the user's browser rather than a bug in your app, and a throw would break the click that caused the save.

### Errors from your code

A `callbackThrew` handler takes the errors your functions throw in place of throwing them, and Waymark carries on. The change that called your function still happens, so a throwing subscriber doesn't stop a walkthrough moving to its next step. A task whose `isComplete` throws stays todo.

To have an error thrown as well, rethrow it from the handler. Whatever a handler throws is thrown, and never comes back to a handler. Without a `callbackThrew` handler, Waymark calls the rest of your functions before it throws, and two or more errors from one change arrive as one `AggregateError`.

A `state` check runs every frame, so Waymark reports each distinct error from one once per step, not sixty times a second.

### Every problem in one place

`everyProblem` sends every type to one function. It replaces all the defaults, including the one that throws your errors, so rethrow those if you still want them thrown:

```tsx
<WaymarkRoot
  problemHandlers={everyProblem((problem) => {
    logger.warn("waymark", problem);
    if (problem.type === "callbackThrew") throw problem.error;
  })}
>
  <App />
</WaymarkRoot>
```

To handle every type with its own handler, check them with `satisfies Required<ProblemHandlers>`. TypeScript then names any type you left out, including one a later Waymark adds, and any name you misspelt.

## Without React

`waymark-core` holds everything but the UI: finding waymarks, advance conditions, the frame loop, storage and checklists. It has no dependencies and no framework.

```ts
import { createRun, defineWalkthrough } from "waymark-core";

const invite = defineWalkthrough({ id: "invite", steps: [{ waymark: "invite", advance: "click" }] });

const popover = document.querySelector("#walkthrough-popover");
const run = createRun({ storage: "waymark" });
const detach = run.attach(() => ({ dialog: popover }), { waymarkPadding: 20 });
const unsubscribe = run.subscribe((snapshot) => {
  // Draw snapshot.open.snapshot.step while a walkthrough is open. Once its
  // waymark.status is "found", waymark.rect says where it is. With none open,
  // draw a beacon for each of snapshot.beacons.
});
run.start(invite);
```

`createRun` makes a Run, as `<WaymarkRoot>` does. Make one per user, and hand it down as your framework does, such as with `setContext` in Svelte or `provide` in Vue. A plain JavaScript app that only runs in the browser can export it from a module. On a server, a Run kept in a module would be shared by every request.

`attach` tells the Run you are drawing it. Only while attached does the Run listen for keys and clicks, measure waymarks each frame, and mark the open step's waymark with aria. Clicks on the `dialog` you pass, or inside anything marked `data-waymark-ui`, don't count as clicking away. `waymarkPadding` defaults to 0 here, and `<WaymarkRoot>` passes 20. `attach` returns a function that detaches. In development, Waymark warns when two Runs are attached to one page.

`subscribe` only tells you when the snapshot changes, so analytics can follow a Run without changing anything on the page. It calls the listener straight away, as Svelte's store contract asks, so a Svelte component can read a Run with `$run`. `getSnapshot()` reads it without subscribing.

| Snapshot field | What it holds |
| --- | --- |
| `open` | The open walkthrough, its `snapshot` and the id of the `task` it guides, or `null`. |
| `beacons` | Each collapsed walkthrough to draw a beacon for, with its `step`, `stepIndex` and `waymark`. Empty while a walkthrough is open. |
| `progress` | How far the user is through every walkthrough they have started, by id. |
| `storageStatus` | `"loading"`, `"ready"` or `"error"`. |

| Option | What it does |
| --- | --- |
| `root` | Where to look for waymarks. Defaults to `document`. |
| `storage`, `initial`, `onChange`, `context`, `onEvent`, `problemHandlers` | As on `<WaymarkRoot>`. |

`start`, `requestStart`, `reset` and `act` work as in React. `setContext(context)` gives completion conditions new facts. `checklist(onboarding.checklists.main)` returns that checklist's `getSnapshot`, `subscribe` and commands. `skipTask(id)` skips a task and exits its walkthrough, as the popover's Skip task button does.

Only the React adapter exists so far.

## Developing

```sh
pnpm install
pnpm setup:browser   # once, to install Chromium for the browser tests
pnpm check           # types, lint, unit and browser tests
pnpm dev:react       # the React test fixtures, in a browser
```

[CODING_STANDARDS.md](CODING_STANDARDS.md) has the rules for code and tests, and [docs/design](docs/design) explains why the trickier parts work the way they do.

## Licence

MIT
