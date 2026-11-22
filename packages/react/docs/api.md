# API reference

## Exports

- Components: `WaymarkRoot`, `Walkthrough`, `Checklist`, and the checklist parts `ChecklistRoot`, `ChecklistTrigger`, `ChecklistPanel`, `ChecklistTask`, `ChecklistCheckbox`, `ChecklistTaskTitle`.
- Hooks: `useRun`, `useChecklist`.
- Definitions: `defineWalkthrough`, `defineChecklists`, and `DEFAULT_CHECKLIST`, the name of the checklist you get without `checklists` (`"main"`).
- Drawing: `defaultPopover`, `defaultBeacon`.
- Problems and storage: `everyProblem`, `localStorageAdapter`, `applyChanges`, `RecordUnreadableError`.
- Server subpath (`react-waymark/server`): `applyChanges`, `RecordUnreadableError`, and types `StoredRecord`, `RecordChanges` — without importing React, for Next.js Route Handlers and non-React backends.

Types:

- Props:
  - `WaymarkRootProps`
  - `WalkthroughProps`
  - `ChecklistProps`
  - `ChecklistRootProps`
  - `ChecklistRootState`
  - `ChecklistPanelProps`
  - `ChecklistTaskProps`
  - `ChecklistCheckboxProps`
  - `ChecklistRowProps`
  - `WalkthroughRenderProps`
  - `BeaconRenderProps`
- Walkthroughs:
  - `WalkthroughDefinition`: what `defineWalkthrough` takes
  - `WalkthroughStep`: a step
  - `WalkthroughLabels`
  - `WalkthroughProgress`: one walkthrough's entry in the record
  - `Placement`
  - `Dismiss`
  - `Action`
  - `WaymarkEventName`: a DOM event name, for `advance: { event }`
  - `Running`: a walkthrough's snapshot while running
  - `Snapshot`: `Running`, or an ended one, as events carry
- Checklists:
  - `ReactTask`: a task, for `satisfies ReactTask<AppContext>`
  - `AnyReactTask`: `ReactTask` with any context
  - `Task`: core's task, without `title`; you usually want `ReactTask`
  - `TaskId`
  - `TaskStatus`: `"todo" | "done" | "skipped"`
  - `TaskCommands`: the commands
  - `NamedTask`: a task plus its `id`
  - `SelectedTask`: a task in one checklist
  - `ChecklistDefinition`: one checklist, to pass to `<Checklist>`
  - `ChecklistsDefinition`: what `defineChecklists` returns
  - `ChecklistSelections`: the `checklists` field
  - `DefaultChecklists`: `{ main }`, without one
  - `ChecklistRow`: one of a snapshot's `tasks`
  - `ChecklistSnapshot`
  - `ChecklistLabels`
  - `UseChecklistResult`
- The Run:
  - `Run`: what `useRun` returns
  - `RunSnapshot`
  - `WaymarkEvent`: what `onEvent` gets: either of the next two
  - `RunEvent`: a walkthrough's event
  - `ChecklistsEvent`: a checklist's event
- Problems:
  - `WaymarkProblem`
  - `ProblemHandlers`
  - `CallbackName`
  - `DropReason`
- Storage:
  - `StorageAdapter`: either of the next two
  - `SaveAdapter`
  - `SavePartialAdapter`
  - `StoredRecord`
  - `RecordChanges`
  - `StorageStatus`: `"loading" | "ready" | "error" | "unreadable"`

`Running`, `Snapshot` and the event types default to core's step type; write `Running<WalkthroughStep>` or `WaymarkEvent<WalkthroughStep>` to have `content` and `title` typed, as `onEvent` and render props already do.

The walkthrough type returned by `defineWalkthrough` isn't exported under its own name (since `<Walkthrough>` takes it); write `WalkthroughProps["walkthrough"]`. The beacon's `rect` is `BeaconRenderProps["rect"]`.

## `<WaymarkRoot>`

- `renderPopover: (props: WalkthroughRenderProps) => ReactNode` and `renderBeacon: (props: BeaconRenderProps) => ReactNode` (both required): what draws every walkthrough's popover and beacon, unless the walkthrough has its own. Their props are under [Render props](#render-props). An app with no walkthroughs can pass `() => null`.
- `storage`: `string | StorageAdapter`, a localStorage key or an [adapter](#storage-adapter-contract). Read once, when the root mounts. Without it, progress lasts as long as the root stays mounted.
- `initial`: a [`StoredRecord`](#the-record) you already have. Read once, when the root mounts. Waymark then doesn't load from storage, but still saves to it.
- `onChange(record: StoredRecord)`: hears the whole record each time it changes.
- `context: unknown`: the facts checklist conditions read. Conditions only run while it's set. Pass a new object when the facts change.
- `onEvent(event: WaymarkEvent)`: every walkthrough and checklist event. See [Event fields](#event-fields).
- `problemHandlers`: `ProblemHandlers`, a function for each type of problem. See [Handle problems](events-and-problems.md#handle-problems).
- `labels`: `Partial<WalkthroughLabels>`, the default popover's text. See [Labels](#labels).
- `waymarkPadding: number`: in px, the room around a waymark, in its cut-out of the shade and before the popover. Clicks this close count as clicks on it. Default `20`.
- `portal: boolean`: `false` renders the popover and beacons inside the root instead of in `document.body`. Default `true`.
- `children`: `ReactNode`, your app.

The root always calls the latest `onEvent`, `onChange` and `problemHandlers`, so they can be written inline.

## `defineWalkthrough`

- `id: string` (required): names the walkthrough in the user's saved progress. Keep it the same across releases. In development, Waymark throws when two different walkthroughs share an id; in production, the first one is used.
- `steps` (required): the steps, in order. See [Step fields](#step-fields).
- `dismiss`: what clicking away, Escape and being interrupted do. `"collapse"` (default) or `"exit"`.
- `maxAge: number`: in ms. Progress left part way for longer than this starts again, checked when progress is read from storage, such as on a reload. Default one day.
- `renderPopover`, `renderBeacon`: this walkthrough's own drawing, with the same signatures as on [`<WaymarkRoot>`](#waymarkroot), but typed with this walkthrough's steps.

## Step fields

- `content` (required): what the popover shows. Any React node.
- `title: ReactNode`: a heading over `content` in the default popover.
- `waymark: string`: points at the element with `data-waymark="<value>"`.
- `selector`: `string`, a CSS selector for the element, in place of `waymark`.
- `advance`: what has to happen before the walkthrough moves on. One of `"click"`, `{ click: true }`, `{ event: WaymarkEventName | readonly WaymarkEventName[] }` or `{ state: (waymark: Element | null) => boolean }`. Each object form also takes `delayMs` (default `0`) and `then`: `"advance"` (default) moves on by itself, `"unlock"` enables Next instead. See [Waiting for the user](walkthroughs.md#waiting-for-the-user).
- `preferredPlacement`: `"below"` (default), `"above"`, `"left"` or `"right"`. Another side is used when this one has no room.
- `scroll`: `"once"` (default) scrolls the waymark into view the first time it's off screen. Also `"always"` or `"never"`.
- `missingAfterMs`: `number`, in ms, how long to look for the waymark before calling it missing. Default `3000`.
- `popoverStyle: CSSProperties`: inline styles for the default popover.
- `meta`: anything of yours. It comes back in events, render props and problems.

## `<Walkthrough>`

- `walkthrough` (required): the walkthrough to show. It's requested with `requestStart` when the component mounts, and the request is withdrawn when it unmounts. Unmounting doesn't close a walkthrough that has already opened.
- `active`: `false` holds the request back, for example until your data has loaded. Default `true`.

## `useRun()`

Returns the Run from the nearest `<WaymarkRoot>`:

- `start(walkthrough)`: opens it now, interrupting any open one. See [Start a walkthrough from your code](walkthroughs.md#start-a-walkthrough-from-your-code).
- `requestStart(walkthrough): () => void`: opens it once nothing else is open, if the user has never started it. Returns a function that withdraws the request; once the walkthrough has opened, withdrawing does nothing.
- `reset(walkthrough)`: puts an open walkthrough back to step 1, and forgets any other, without opening it.
- `act(action, walkthrough?)`: `"advance"`, `"previous"`, `"collapse"`, `"resume"`, `"reset"` or `"exit"`. Without a walkthrough, acts on the open one. One that isn't open takes only `"resume"`, `"reset"` and `"exit"`.
- `skipTask(id: string)`: skips a todo task and exits its walkthrough, as the popover's Skip task button does. Does nothing until a checklist holding the task has been used.
- `setContext(context)`: new facts for checklist conditions. `<WaymarkRoot>`'s `context` prop calls this for you.
- `checklist(definition)`: a checklist for use outside React: `getSnapshot()`, `getServerSnapshot()`, `subscribe(listener): () => void`, and the same commands as `useChecklist`.
- Commands called from a listener or `onEvent` run after the current change's listeners and events, not before they return.
- `getSnapshot(): RunSnapshot` and `getServerSnapshot(): RunSnapshot`: the Run's state now, and its state from before storage was read.
- `subscribe(listener: (snapshot: RunSnapshot) => void): () => void`: calls the listener at once and after each change, and returns a function that unsubscribes. Following the Run changes nothing on the page.
- `attach` and `connect`: `<WaymarkRoot>` calls these. Don't call them yourself.

A `RunSnapshot` has:

- `open`: the open walkthrough, or `null`. Has `walkthrough` (the definition), `task` (the id of the checklist task it guides, or `null` until a checklist holding that task has been used) and `snapshot`, the same snapshot [render props](#render-props) get: `phase: "running"`, `step`, `stepIndex`, `stepCount`, `canAdvance`, `collapsed` and `waymark`.
- `beacons`: walkthroughs the user put aside, with `walkthrough`, `step`, `stepIndex` and `waymark`. Empty while a walkthrough is open. Each shows on its waymark once that's found; only the one put aside most recently shows without one, at the bottom of the screen, when its step has no waymark or it's lost or missing. Only walkthroughs the Run has been given since the root mounted are listed; see [Why isn't a walkthrough showing?](troubleshooting.md#why-isnt-a-walkthrough-showing)
- `progress`: each started walkthrough's progress, by id, shaped as in [the record](#the-record).
- `storageStatus`: as on a [checklist](#usechecklistchecklist).

## `defineChecklists`

Takes `tasks`, an object of tasks by id, and optionally `checklists`, an object of lists of task ids by checklist name. Without `checklists`, every task is in `checklists.main`. Returns `{ checklists }`, a definition for each checklist by name.

## Task fields

- `title: ReactNode` (required).
- `description`: any React node, shown under the title while the task is todo.
- `walkthrough`: a walkthrough from `defineWalkthrough`, or steps written inline. Inline steps get the task's id as their walkthrough id.
- `isComplete: (context: TContext) => boolean`: ticks the task the first time it returns `true`. It must be pure. Write the context's type on the parameter.
- `action`: `{ label: ReactNode; onSelect: () => void }`, a button in place of "Show me".
- `toggleable`: `false` draws no checkbox for it in `<Checklist>` and the checklist parts. Default `true`.
- `meta`: anything of yours.

A task's id names its status in the user's record. Two `defineChecklists` calls that both define one share its status, and Waymark uses whichever definition it was given first. If both give it inline steps, development throws when the second is used; if they give it two different walkthroughs with different ids, both checklists start the first one's.

## `<Checklist>`

- `checklist` (required): such as `onboarding.checklists.main`.
- `title: ReactNode`: a heading beside the progress count.
- `labels: Partial<ChecklistLabels>`: `start` ("Show me"), `resume` ("Continue"), `replay` ("Show me again") and `skip` ("Skip").
- `style`, `rowStyle`: `CSSProperties`, inline styles for the list and each row.
- `renderRow(props: ChecklistRowProps): ReactNode`: replaces a row's content. Gets the `task`, its `status`, its `walkthrough` (`"open"`, `"collapsed"` or `"none"`), and the [commands](#usechecklistchecklist).

## `useChecklist(checklist)`

Returns `snapshot` and the commands. The snapshot has:

- `tasks`: each task with its `status` and its `walkthrough`, in the checklist's order.
- `finishedCount`, `taskCount`: tasks done or skipped, and all tasks. "Finished" here counts tasks, not walkthroughs.
- `complete`: `true` once every task is done or skipped.
- `open`: the task whose walkthrough is open, or `null`.
- `storageStatus`: `"loading"` until the record is in, then `"ready"`, or `"error"` or `"unreadable"` when it couldn't be read and the user starts fresh. While loading, every task shows todo.

The commands each take a task's id:

- `start(id)`: starts the task's walkthrough as `run.start` does: where the user left it if part way through, from step 1 if they finished or exited it. Does nothing for a task without one.
- `markDone(id)`, `markTodo(id)`, `toggle(id)`: change its status.
- `skip(id)`: skips a todo task, and exits its walkthrough if it's running. Does nothing to a done or skipped one.

## Checklist parts

Every part goes inside a `ChecklistRoot`. The parts that render an element pass your other props, such as `className`, on to it. `ChecklistTrigger` and `ChecklistPanel` mark themselves `data-waymark-ui`, so using the checklist doesn't count as clicking away from a walkthrough. The panel has no `z-index` of its own, so give it one in your styles.

- `ChecklistRoot`: takes `checklist`, and renders no element of its own. Its children are React nodes, or a function `(state) => ReactNode`, where `state` is `useChecklist`'s result plus `open`, whether the panel is open.
- `ChecklistTrigger`: a `<button>`. The panel opens while a mouse rests on the trigger or panel, and a press pins it open, which is how the keyboard and touch open it. Escape closes it. Sets `data-state` to `"open"` or `"closed"`, and `data-running` while one of the checklist's walkthroughs is open.
- `ChecklistPanel`: a `<div>` popover. `side`: `"below"` (default), `"above"`, `"left"` or `"right"`. `gap`: px from the trigger, default `8`. `portal`: default `true`, rendering in `document.body`. It's a `role="dialog"` named "Checklist"; pass `aria-label` to change that. Sets `data-side` to the side it took, `data-running`, and a `--waymark-available-height` CSS variable with the room it has.
- `ChecklistTask`: an `<li>` for one task. Requires `row`, one of the snapshot's `tasks`.
- `ChecklistCheckbox`: a `<button role="checkbox">` inside a `ChecklistTask` that toggles the task, followed by a visually hidden status for screen readers. `statusText: Record<TaskStatus, string>` sets that status. Default `{ todo: "To do", done: "Done", skipped: "Skipped" }`. For a task with `toggleable: false`, it renders a `<span>` the user can't press, which takes only `className`, `style` and `children`.
- `ChecklistTaskTitle`: a `<div>` inside a `ChecklistTask`, which names its checkbox.

`ChecklistTask`, `ChecklistCheckbox` and `ChecklistTaskTitle` set `data-status`, `data-open` while the task's walkthrough is open, and `data-in-progress` while it's collapsed part way.

## Render props

`renderPopover` gets:

- `currentStep`: the step, with your own fields such as `content` and `meta`.
- `snapshot`: the walkthrough, with `stepIndex`, `stepCount`, `canAdvance`, and `waymark.status`: `"found"`, `"absent"` (the step has no waymark), `"waiting"`, `"lost"` or `"missing"`. Show that the waymark can't be found while it's `"lost"` or `"missing"`; `canAdvance` is then always `true`.
- `advance`, `previous`, `collapse`, `reset`, `exit`: `() => void`, what the user can do.
- `skipTask`: `(() => void) | undefined`, set while the walkthrough is a checklist task's, once that checklist has been used, however the walkthrough was started. It does nothing unless the task is todo.
- `placement`: the side of the waymark it was placed on.
- `arrow`: in px, how far along the popover's edge the waymark's centre is, for drawing an arrow.
- `waymarkFound`: `false` while the popover is centred because the step has no waymark or it isn't on the page.
- `labels`: your labels over the defaults.

`renderBeacon` gets `currentStep`, `resume` and `exit` (both `() => void`), `labels`, `waymarkFound`, and `rect`, the waymark's box. Waymark places the beacon on the waymark's top-right corner, on its bottom-right corner when the waymark is at the top of the screen, and at the bottom of the screen when there's no waymark.

## Labels

- `next`: "Next"
- `previous`: "Previous"
- `finish`: "Finish"
- `skipTask`: "Skip task"
- `missing`: "Can't find this part of the page. You can still carry on."
- `close`: "Close"
- `resume`: "Resume walkthrough"
- `stepOf`: `` (step, count) => `Step ${step} of ${count}` ``

`close`, `resume` and `stepOf` are used as accessible names, so they take strings. The rest take any React node.

## Event fields

`onEvent` gets a `WaymarkEvent`: a walkthrough event or a checklist event. A walkthrough event has:

- `type`: see [Events and analytics](events-and-problems.md#events-and-analytics).
- `walkthrough`: its id.
- `step`, `stepIndex`: the step it happened on, with your fields, and its index from 0.
- `snapshot`: the walkthrough after it. Its `phase` is `"running"`, with the fields [render props](#render-props) get, or, once the walkthrough has ended, `"completed"` or `"exited"`, with only `stepIndex` and `stepCount`. It's ended on `finish` and the `advance` just before it, on `exit`, and on an `interrupt` that exits it.
- `interruptedBy`: on `interrupt` only, the id of the walkthrough that started.

A checklist event has `type` and `task`, the task as you wrote it plus its `id`, except `checklistComplete`, which has `checklist` (its name) and `snapshot` (as `useChecklist` gives it) instead. `taskSkipped` and `taskUnskipped` also have `checklist`, the name of the checklist it was skipped from, when Waymark knows it. `taskStopped` has `reason`.

The events from one change come in order: the walkthrough's first, then `taskStopped`, then each task whose status changed, in task order, then `taskStarted`, then `checklistComplete`.

## Storage adapter contract

A `StorageAdapter` has `load`, one of `save` or `savePartial`, and optionally `subscribe`:

- `load(): StoredRecord | null | Promise<StoredRecord | null>`: what's stored, or `null` when nothing is. Throws or rejects when it fails. A `save` adapter's `load` is called on connecting and before every save; a `savePartial` adapter's only on connecting.
- `save(record: StoredRecord | null): void | Promise<void>`: store the whole record in place of what's there. `null` means nothing is left: delete it.
- `savePartial(changes: RecordChanges): void | Promise<void>`: apply the changes to what's stored, with `applyChanges`, in one transaction. A `RecordUnreadableError` thrown here is reported as `recordUnreadable`; anything else as `storageFailed`.
- `subscribe(listener: (record: StoredRecord | null) => void): () => void`: hear the record change elsewhere, such as in another tab. Returns a function that unsubscribes.

`applyChanges(stored: unknown, changes: unknown): StoredRecord | null` returns the record to store, or `null` when nothing is left. `localStorageAdapter(key: string)` is the adapter a string `storage` uses.

## The record

A `StoredRecord` is plain JSON. You don't need to read it, but this is its shape:

```ts
type StoredRecord = {
  version: 1;
  // Each started walkthrough's progress, by id.
  walkthroughs: Record<string, {
    status: "running" | "finished" | "exited";
    step: number; // from 0
    stepCount: number;
    collapsed: boolean; // put aside as a beacon
    changedAt: number; // epoch ms
  }>;
  // Each task's status by id, once it has left its first todo. "reopened" is one the user took back to todo.
  tasks: Record<string, "done" | "skipped" | "reopened">;
  // When each walkthrough was reset, epoch ms, kept until it next runs. Left out when there are none.
  resets?: Record<string, number>;
};

// What savePartial gets.
type RecordChanges = {
  version: 1;
  // Entries to write, each in place of the one under its id.
  set: { walkthroughs: StoredRecord["walkthroughs"]; tasks: StoredRecord["tasks"]; resets?: Record<string, number> };
  // Ids whose entries go.
  remove: { walkthroughs: string[]; tasks: string[] };
  // Only when the stored record couldn't be read and a recordUnreadable handler replaced it:
  // applyChanges then builds a new record from `set` alone, without reading what's stored.
  replace?: true;
};
```

It's deliberately not shaped like a record, so it can't be stored as one by mistake. Hand it to `applyChanges` and store what that returns.
