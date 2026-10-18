# Grounding: `run.ts` on `run-redesign-wip`

Read the live file at
`/home/alex/Work/libs/raf/.worktrees/run-redesign/packages/core/src/run/run.ts`
(it has uncommitted edits newer than the commit this branch is cut from). The
design it implements is `docs/design/run.md` in the same checkout.

## How it got to 1,007 lines

On `main`, a Run drove one walkthrough (`run.ts`, 337 lines) and the checklist
controller (`checklists/checklists.ts`, 687 lines) owned several Runs, their
storage, task statuses and checklist views. `docs/design/run.md` merged the two
into one Run per user. `checklists.ts` is now a 73-line pure `defineChecklists`;
the controller's state moved into `createRun`. So the line count is mostly
consolidation, not new behaviour. But it now lives in one closure, with every
concern able to read and write every variable.

## The public contract (keep it)

`Run` in `packages/core/src/run/types.ts`: `start`, `requestStart` (returns a
withdraw function), `act`, `reset`, `getSnapshot`, `getServerSnapshot`,
`subscribe`, `attach(ui, { waymarkPadding })`, `setContext`,
`checklist(definition)` (returns a `Checklist` with `getSnapshot`,
`getServerSnapshot`, `subscribe`, `start`, `markDone`, `markTodo`, `skip`,
`toggle`), `skipTask`. `RunOptions`: `root`, `storage`, `initial`, `onChange`,
`problemHandlers`, `context`, `onEvent`. Every test (`run.test.ts`,
`open.test.ts`, `storage.test.ts`, `checklists/*.test.ts`, React's) goes through
this surface, so internals are free to move.

## Pure modules it already leans on (reuse them)

- `run/rules.ts`: `apply(state, message, walkthrough) -> Outcome` — the pure
  per-walkthrough machine. Also `liveWatchers(state)`, `needsAdvanceRead`,
  `sight`/`unsighted` for beacon sightings.
- `run/state.ts`: `State`, `opening`, `stepAt`.
- `run/input.ts`: `whereClicked`, `keyAction` — pure DOM-event classification.
- `checklists/tasks.ts`: `eventsBetween`, `finishTasks`, `checkConditions`,
  `reopen` — pure over a `Moment = { statuses, progress }`.
- `checklists/views.ts`: `createView`, `refresh` — checklist snapshots.
- `checklists/statuses.ts`: a tiny mutable task-status record.
- `storage/records.ts`: `parseRecord`, `staleness`, `changesBetween`,
  `storedRecord`. `storage/adapter.ts`: `loadFrom`, `saveTo`, `adapterOf`.
- `queue.ts`: reentrancy-safe drain. Work queued from a callback runs after the
  current change's notifications and events.

## State inventory (everything `createRun` holds)

| State | Kind | Saved? | Who writes it |
| --- | --- | --- | --- |
| `definitions` Map id→Walkthrough | registry | no | `take` |
| `progress` Record id→WalkthroughProgress | durable | yes | `record`, `setProgress` (open, release, arrive, resetOne, actOn), `load`, `hear` |
| `statuses` (task statuses) | durable | yes | checklist commands, `skip`, `finishTasks`, `checkConditions`, `load`, `hear` |
| `restored` Set id | "progress not yet checked against its definition" | no | `load`, `hear`, `arrive`, `resetOne` |
| `storageStatus` | lifecycle | no | `load` |
| `held` commands | lifecycle | no | `later`, `loaded` |
| `context` | input | no | `setContext` |
| `waiting` Walkthrough[] | scheduling | no | `request`, `begin`, `settle`, requestStart's withdraw |
| `machine` {walkthrough, state} | the open walkthrough's live State | no | `open`, `obey`, `interrupt`, `release` |
| `lastGeneration` | step-generation continuity across walkthroughs | no | `release` |
| `sightings` Map id→Sighting | beacon waymark tracking | no | `release`, `settle`, `lookAtBeacons`, `setAttached` |
| `startedFrom` Map walkthroughId→checklist name | event credit | no | checklist `start`, `commit` prunes |
| `groups`, `tasks`, `taskById`, `views`, `checklists` | checklist registry + view cache | no | `join`, `viewOf`, `checklistOf` |
| `snapshot`, `openShown`, `beaconsShown` | identity-preserving snapshot cache | no | `build`, `openNow`, `beaconsNow` |
| `events`, `problems`, `credits` | per-change accumulators | no | everywhere during `commit` |
| `attachments` | renderer attachments | no | `attach`/detach |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | DOM watchers | no | `reconcile`, `openFrame` |
| `looked` | "first look sent for this machine" | no | `lookOnOpening`, `setAttached` |
| `thrownStep`, `thrownErrors` | dedupe of state-check throws | no | `firstThrowThisStep` |
| `attachedRuns` (module WeakMap) | dev warning | no | `countAttached` |

Note the drift from the design doc: it says which walkthrough is open and which
beacons show "are worked out from the progress each time, not stored". The
code stores `machine` beside `progress` and keeps them in step by hand
(`record` after every machine change, `release`, `arrive`'s collapse/exit).

## The change pipeline (`commit`), whose order is load-bearing

1. `before = moment()`; reset `events`, `problems`, `credits`.
2. Run the work (any mix of the above writers).
3. `settle()`: release a machine that collapsed/ended (record its progress,
   remember its sighting, carry `lastGeneration`); open the next `waiting`
   request whose progress is still empty; rebuild `sightings` for current beacons.
4. `finishTasks` (task done when its walkthrough finished and it has no condition).
5. Prune `startedFrom`.
6. Build the Run snapshot and refresh every checklist view (all snapshots up to
   date before any callback runs).
7. `reconcile()` DOM watchers; `lookOnOpening()` (queues a read + `start`
   message as a *new* change via the queue).
8. Notify Run listeners, then view listeners.
9. Save `changesBetween(before, after)` unless `persist: false`; `onChange`.
10. Report problems (after notify, so the renderer has redrawn).
11. `onEvent`: run events, then (unless `silent`) checklist events from
    `eventsBetween`, then `checklistComplete`.

Flags: `silent` (no checklist events: storage or a checklist arriving),
`persist: false` (came from storage: don't save).

## Flows worth tracing through any new shape

- Reload: progress loads before any definition; each entry waits in `restored`
  until `take` + `arrive` validates it (staleness → `recordDropped`), reopens it
  if it was open and nothing else is, otherwise sets it aside per `dismiss`.
- `start(B)` while A is open: A gets `act dismiss` → `interrupt` event; B opens
  fresh/resume/restore; a later collapse of B lets `settle` open a waiting
  request before beacons show.
- Frame loop: while open, `sendRead` measures the waymark, runs the step's
  check (throw dedup per step generation), sends `stepRead`; while not open,
  `lookAtBeacons` updates sightings.
- Another tab writes: `hear` merges per entry (`heardEntry`: ours wins if open
  here or newer by `changedAt`; open-elsewhere becomes collapsed here).
- Loading: every command is held (`later`) and replayed in order after load.
- Server render: `server` is a frozen `Seen` and `serverSnapshot` taken before
  the load.

## Concerns, as they cluster today

1. Record: progress + statuses + storageStatus + restored + load/hear/save.
2. Scheduling: machine, waiting, lastGeneration, open/release/settle/interrupt/
   arrive/begin/request/actOn.
3. Checklists: registry, views, credits/startedFrom, task commands, conditions.
4. Change pipeline: accumulators, diff, snapshots, notify, save, events.
5. Page: measure, reads, beacons' sightings, input, frame, aria, waymark
   events, attachments, dev warning.
6. Snapshot identity caches.
