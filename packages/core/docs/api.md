# Reference

## Exports

- Functions: `createRun`, `defineWalkthrough`, `defineChecklists`, `everyProblem`, `localStorageAdapter`, `applyChanges`.
- Values: `RecordUnreadableError` (a class), `DEFAULT_CHECKLIST` (`"main"`), `actions` (`readonly ["advance", "previous", "collapse", "resume", "reset", "exit"]`, every `Action` in order, for checking a value is one).

Types:

- The Run:
  - `Run`: what `createRun` returns
  - `RunOptions`: what it takes
  - `RunSnapshot`
  - `OpenWalkthrough`: a snapshot's `open`
  - `Beacon`: one of its `beacons`
  - `Location`: a `waymark`: found with a `Rect`, or a status
  - `Rect`: a box on screen
  - `UiElements`: what `attach`'s `ui` returns
  - `AttachOptions`: `{ waymarkPadding?: number }`
  - `Action`: what `act` takes
- Walkthroughs:
  - `Walkthrough`: what `defineWalkthrough` returns
  - `WalkthroughDefinition`: what it takes
  - `Step`: core's step fields, to extend with your own
  - `ExactStep`: rejects fields outside a step shape; used by `WalkthroughDefinition`
  - `AdvanceCondition`: a step's `advance`
  - `Dismiss`: `"collapse" | "exit"`
  - `WalkthroughProgress`: one walkthrough's entry in the record
  - `Running`: a walkthrough's state while running
  - `Ended`: its state after finishing or exiting, with `phase: "completed" | "exited"`
  - `Snapshot`: either
- Events:
  - `WaymarkEvent`: what `onEvent` gets: either of the next two
  - `RunEvent`: a walkthrough's event
  - `ChecklistsEvent`: a checklist's event
  - `RunEventType`: a walkthrough event's `type`
  - `WaymarkEventName`: a DOM event name, for `advance: { event }`
- Checklists:
  - `Task<TContext, TStep>`: a task, for `satisfies Task<AppContext>` on one written in its own module
  - `AnyTask`: any task plus its `id`, as events give it
  - `TaskMap`: tasks by id
  - `TaskId<TTasks>`: a task id
  - `TaskStatus`: `"todo" | "done" | "skipped"`
  - `TaskCommands`: a checklist's commands
  - `NamedTask<TTasks>`: a task as you wrote it plus its `id`
  - `SelectedTask`: a task in one checklist
  - `ExactTasks`: rejects task fields outside a task shape
  - `Checklist`: what `run.checklist` returns
  - `ChecklistDefinition`: one checklist, to pass to `run.checklist`
  - `ChecklistsDefinition`: what `defineChecklists` returns
  - `ChecklistsConfig`: what it takes
  - `ChecklistSelections`: its `checklists` field
  - `DefaultChecklists`: `{ main }`, without one
  - `ChecklistRow`: one of a snapshot's `tasks`
  - `ChecklistSnapshot`
  - `StorageStatus`: `"loading" | "ready" | "error" | "unreadable"`
- Problems:
  - `WaymarkProblem`: any problem
  - `ProblemHandlers`: `problemHandlers`
  - `CallbackName`: `callbackThrew`'s `callback`
  - `DropReason`: `recordDropped`'s `reason`
- Storage:
  - `StorageAdapter`: either of the next two
  - `SaveAdapter`
  - `SavePartialAdapter`
  - `StoredRecord`: [the record](storage.md#the-record)
  - `RecordChanges`: what `savePartial` gets
- Helpers:
  - `Exactly`: what `ExactStep` and `ExactTasks` use to reject unknown fields

## `defineWalkthrough(definition)`

- `id: string` (required): names the walkthrough in the user's saved progress. Keep it the same across releases. In development, the Run throws when it's given a second, different walkthrough with an id it already has, through `start`, `requestStart`, `reset`, `act` or a checklist; in production it uses the first.
- `steps` (required): the steps, in order.
- `dismiss`: what Escape, clicking away and being interrupted by another walkthrough do. `"collapse"` (default) or `"exit"`.
- `maxAge: number`: in ms. Progress left part way for longer than this starts again, checked when progress is read from storage, such as on a reload. Default one day.

## Step fields

- `waymark: string`: points at the element with `data-waymark="<value>"`.
- `selector`: `string`, a CSS selector for the element, in place of `waymark`. A step with neither shows in the middle of the screen.
- `advance`: what has to happen before the walkthrough moves on:
  - `"click"` or `{ click: true }`: a click on the waymark, unless it's inside `data-waymark-ui`.
  - `{ event: "input" }` or `{ event: ["change", "blur"] }`: DOM events on the waymark.
  - `{ state: (waymark: Element | null) => boolean }`: a check run every frame, with the waymark element or `null`.
  - Each object form takes `delayMs`, how long it must hold without a break (default `0`), and `then`: `"advance"` (default) moves on by itself, `"unlock"` enables Next instead.
  - A click or event needs a `waymark` or `selector`; `defineWalkthrough` throws without one. Without `advance`, Next works straight away.
- `scroll`: `"once"` (default) scrolls the waymark into view the first time it's off screen. Also `"always"` or `"never"`.
- `missingAfterMs`: `number`, in ms, how long to look for the waymark before calling it missing. Default `3000`. A waymark that was found and then leaves the page is lost after 200ms.
- `meta`: anything of yours.

## `createRun(options?)`

- `storage`: `string | StorageAdapter`, a localStorage key or an adapter. Without it, progress lasts as long as the Run. Give each user their own key, such as `` `waymark:${userId}` ``, and make a new Run when the user changes, so one user doesn't see another's progress on a shared browser.
- `initial`: a `StoredRecord` you already have, such as one fetched for a server render. The Run then doesn't load, though it still saves.
- `onChange(record: StoredRecord)`: hears the whole record each time it changes.
- `context: unknown`: the facts checklist conditions read. Conditions only run while it's set.
- `onEvent(event: WaymarkEvent)`: every walkthrough and checklist event.
- `problemHandlers`: see [Problems](#problems).
- `root`: `Document | Element`, where to look for waymarks. Default `document`.

## The Run

A command called from a listener or `onEvent` runs after the current change's listeners and events, not before it returns.

- `start(walkthrough)`: opens it now, for when the user asks. Part way through, it opens where it was; finished or exited, it starts from step 1. An open walkthrough is interrupted, and does what its `dismiss` says.
- `requestStart(walkthrough): () => void`: opens it once nothing else is open, if the user has never started it. One they put aside stays a beacon, and one they finished or exited stays closed; one put aside for longer than its `maxAge` is forgotten when its progress is next read from storage, such as on a reload, and then opens again from step 1. Waiting requests open in the order they were made. Returns a function that withdraws the request.
- `reset(walkthrough)`: an open walkthrough goes back to step 1; any other is forgotten, as if never started, without opening it.
- `act(action, walkthrough?)`: `"advance"`, `"previous"`, `"collapse"`, `"resume"`, `"reset"` or `"exit"`, on the open walkthrough or the one given. One that isn't open takes only `"resume"`, `"reset"` and `"exit"`.
- `attach(ui: () => { dialog: Element | null }, options?): () => void`: says you're drawing the Run, and switches on its listeners. `ui` is read on each key and click. `options.waymarkPadding`: px around the waymark that count as the waymark, default `0`. Returns a function that detaches. In development, Waymark warns when two Runs are attached to one page.
- `connect(): () => void`: starts storage. The first call loads the record, and while connected the Run hears other tabs. A Run with `storage` reports `storageStatus: "loading"`, and holds its commands, until the record is in. Returns a function that stops listening; saves carry on.
- `subscribe(listener: (snapshot: RunSnapshot) => void): () => void`: calls the listener at once, as Svelte's store contract requires, then after each change. Returns a function that unsubscribes. A Svelte component can read a Run as `$run`.
- `getSnapshot()`, `getServerSnapshot()`: the current state, and the state from before storage was read.
- `setContext(context: unknown)`: new facts for checklist conditions, which run again. Ignored when it's the object the Run already has.
- `checklist(definition)`: see [A checklist's state and commands](#a-checklists-state-and-commands).
- `skipTask(id: string)`: skips a todo task and exits its walkthrough. Does nothing until a checklist holding the task has been used.

## The snapshot

- `open`: the open walkthrough, or `null`. Has `walkthrough`, `task` (the id of the checklist task it guides, or `null` until a checklist holding that task has been used), and `snapshot`: `phase: "running"`, `step`, `stepIndex`, `stepCount`, `canAdvance`, `collapsed` and `waymark`.
- `beacons`: walkthroughs the user put aside, with `walkthrough`, `step`, `stepIndex` and `waymark`. Empty while a walkthrough is open. Each is listed once its waymark is `"found"`; only the one put aside most recently is listed without one, when its step has no waymark or it's `"lost"` or `"missing"`, for you to draw somewhere fixed. Only walkthroughs the Run has been given are listed; see [Why isn't anything showing?](troubleshooting.md#why-isnt-anything-showing)
- `progress`: each started walkthrough's progress, by id: `status` (`"running"`, `"finished"` or `"exited"`), `step`, `stepCount`, `collapsed`, and `changedAt` in epoch ms.
- `storageStatus`: `"loading"`, `"ready"`, `"error"` (loading failed; a failed save leaves it `"ready"`) or `"unreadable"` (it holds a record this Waymark can't read). In both of the last two, the user starts fresh.

A `waymark` is `{ status: "found", rect }`, with the element's box on screen (`top`, `right`, `bottom`, `left`, `width`, `height`, `x`, `y`), or a `status` of `"absent"`, `"searching"`, `"waiting"`, `"lost"` or `"missing"`. A snapshot is a new object only when something in it changed.

## `defineChecklists(config)`

- `tasks` (required): tasks by id. Each has, all optional: `walkthrough` (a walkthrough, or steps inline, which get the task's id as their walkthrough id), `isComplete(context): boolean` (must be pure) and `meta`.
- `checklists`: lists of task ids by checklist name. Without it, every task is in one checklist named `DEFAULT_CHECKLIST`, `"main"`.

Returns `{ checklists }`, with a definition for each checklist, to pass to `run.checklist`.

A task's id names its status in the user's record. Two `defineChecklists` calls that both define one share its status, and the Run uses whichever definition it was given first. If both give it inline steps, development throws when the second is used; if they give it two different walkthroughs with different ids, both checklists start the first one's.

## A checklist's state and commands

`run.checklist(definition)` returns the same object each time for one definition:

- `getSnapshot()`, `getServerSnapshot()`, and `subscribe(listener): () => void`, which calls the listener at once and after each change.
- `start(id)`: shows the task's walkthrough as `run.start` does. Does nothing if the task has none.
- `markDone(id)`: marks it done.
- `markTodo(id)`: takes a done or skipped task back to todo.
- `skip(id)`: skips a todo task, and exits its walkthrough if it's running.
- `toggle(id)`: todo to done, and done or skipped back to todo.

Its snapshot has:

- `tasks`: one row per task, in order, with `task` (as you wrote it, plus its `id`), `status` (`"todo"`, `"done"` or `"skipped"`) and `walkthrough` (`"open"`, `"collapsed"` part way, or `"none"`).
- `finishedCount`: tasks done or skipped. `taskCount`: all tasks.
- `complete`: `true` once every task is done or skipped.
- `open`: the task whose walkthrough is open, or `null`.
- `storageStatus`: as on the Run. While loading, every task shows todo.

## Events

`onEvent` hears every event, in order. A walkthrough event has:

- `walkthrough`: its id.
- `step` and `stepIndex`: the step it happened on, and its index from 0.
- `snapshot`: the walkthrough after the event. Moving from step 1 to step 2 fires `advance` with `stepIndex` `0` and `snapshot.stepIndex` `1`.
- The snapshot is a `Running`, with `phase: "running"` and the fields of `open.snapshot`, or, once the walkthrough has ended, an `Ended`, with `phase` `"completed"` or `"exited"` and only `stepIndex` and `stepCount`. It's ended on `finish` and the `advance` just before it, on `exit`, and on an `interrupt` that exits it.

Its `type` is one of:

- `start`: shown for the first time, or again after finishing or exiting. It fires when a renderer is attached and the Run first looks for the step's waymark.
- `advance`, `previous`: moved a step. Completing the last step fires `advance` and then `finish`.
- `collapse`, `resume`: put aside as a beacon, and brought back.
- `exit`: exited, whichever way: `act("exit")`, skipping its task, or dismissing it with `dismiss: "exit"`.
- `interrupt`: interrupted by another walkthrough, in place of `collapse` or `exit`. `interruptedBy` names the other one.
- `reset`: an open walkthrough went back to step 1. Resetting one that isn't open fires no walkthrough event.

Checklist events have `task` (as you wrote it, plus its `id`): `taskStarted`, `taskComplete`, `taskReopened`, `taskSkipped` and `taskUnskipped` (both with the `checklist` name when known), and `taskStopped`, when the task's walkthrough stops running, with a `reason`: `"finished"`, `"skipped"` when skipping the task exited it, or `"stopped"` when it was exited or reset otherwise. Putting it aside doesn't stop it. `checklistComplete` has the `checklist` name and its `snapshot`.

The events from one change come in order: the walkthrough's first, then `taskStopped`, then each task whose status changed, in task order, then `taskStarted`, then `checklistComplete`.

Some ticks aren't announced. A condition that already holds when the user's record loads, or when its checklist is first used, ticks its task silently: no `taskComplete`, and no `checklistComplete` if that completes the list. Statuses already in the record aren't announced either. `onChange` hears every status change, silent ones included, as the whole record: to count completions from it, compare each record's `tasks` with the last one you saw.

## Problems

Each handler in `problemHandlers` hears one type. A type without one keeps its default. `everyProblem(handler)` sends every type to one function, replacing all the defaults.

- `waymarkMissing`, `waymarkLost`: a step's waymark was never found, or left the page. Has `walkthrough`, `step` and `stepIndex`. Default: nothing.
- `storageFailed`: storage threw or rejected. Has `error`. Default: logged with `console.error`.
- `recordUnreadable`: the stored record isn't one this Waymark can read. Has `error`, `stored`, and `replace(record: StoredRecord | null)` to write one in its place. Default: logged.
- `recordDropped`: one stored entry was dropped. Has `walkthrough` or `task` (an id), and `reason`: `"expired"`, `"stepsChanged"` or `"unreadable"`. Default: nothing.
- `callbackThrew`: one of your functions threw. Has `error`, and `callback`: `"stateCheck"`, `"isComplete"`, `"onEvent"`, `"onChange"` or `"subscriber"`. With a handler, Waymark carries on. Default: thrown.
