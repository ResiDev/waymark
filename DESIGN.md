# Alternative 1: derive everything

## The problem

`createRun` in `packages/core/src/run/run.ts` holds about 40 variables in one
closure, and any of its 1,099 lines can write any of them. Several pairs must
be kept in step by hand. The worst is the open walkthrough's live state
(`machine`) and its saved place (`progress[id]`): a change that moves one and
forgets the other leaves the Run drawing a walkthrough its record says is
closed, or the reverse, and no type error says so.

This design removes the pairs by storing less. A fact is stored once, where
the Run learns it, and everything that follows from it is worked out when it
is needed. Two copies cannot drift apart when one of them is a function of the
other.

The types are in `packages/core/src/state.ts`, each field with the reason it
is stored. The modules are sketched in
`docs/design/run-architecture/alt-derived/`.

## Terms

- **Fact**: something the Run was told and cannot work out again. It is an
  input the app gave once, something the browser or storage said once, or a
  latch that remembers that something happened.
- **Given, Recorded, Asked, Live**: the four values the facts are kept in,
  apart by how long they last and how often they change:
  - Given: what the app handed over (definitions, checklist groups, context).
    Assigned at the call that hands it over.
  - Recorded: the user's record as this tab holds it (progress, statuses,
    entries not yet checked, storage's last word). Changes per action.
    Progress and statuses are what is saved.
  - Asked: what the app asked for that has not finished (requests waiting,
    the checklist that started each running walkthrough). Changes per
    action. This tab only.
  - Live: what the page shows now (the visit, the beacons' sightings).
    Changes per frame.
- **Visit**: what the page and the user have done on the open walkthrough's
  current step since it was shown: latches, times, where its Waymark is.
- **Work**: a pure function from the four values to the next four, for one
  command. No DOM, no storage, no app code.
- **Change**: up to three parts of works, run in order, then `settle`, then
  the announcements. `commit` runs one.
- **View**: a pure function from the four values to something the Run hands
  out (a snapshot, a checklist snapshot), cached by the identity of what it
  reads.

## How it differs from today

- **Which walkthrough is open.** Today `machine`, stored beside `progress`
  and kept in step by `record` after every rule, by `release`, and by
  `arrive`. Here it is worked out: the one entry that is checked, running
  and not collapsed. The visit names its walkthrough, so a frame finds the
  open one in two lookups. A visit whose walkthrough is no longer open at its
  step does not count, and `settle` drops it.
- **The step's Snapshot.** Today stored in `machine.state.snapshot` and kept
  in step with `unlocked` and the Waymark by `show` and `gate`. Here worked
  out by the rules' `running` from the definition, the entry and the visit,
  and cached, so `canAdvance` cannot fall out of step.
- **Step generations.** Today a number carried from one walkthrough to the
  next through `lastGeneration`. Here each visit gets a new `symbol`. A
  message names the visit it was raised on and does nothing on any other.
- **`attached` and `looked`.** Today two flags, one in the rules' State and
  one in run.ts, decide when the first look is due. Here one latch on the
  visit, `looked`, beside the page's own list of renderers.
- **`restored`.** Today a Set that four functions clear. Here `unchecked`:
  the entry objects storage gave. An entry is unchecked while
  `unchecked.get(id) === progress[id]`. Any write makes a new entry object,
  so there is nothing to clear.
- **`storageStatus` and `unreadable`.** Today a status and a report-once flag.
  Here one `StorageState`. The public status is worked out from it, and
  `recordUnreadable` is reported in the change that turns it to `unreadable`.
- **Tasks and snapshots.** Today `tasks`, `taskById`, `views`, `snapshot`,
  `openShown` and `beaconsShown` are stored and refreshed in `commit`. Here
  they are views, cached by input identity.
- **Flags.** Today a caller passes `silent`, `persist` and `replace`. Here a
  change is made of parts (`storage`, `arrival`, `commands`), and what is
  saved and announced follows from where each part ends.
- **Loading.** Today taking the record in is two changes, then one change per
  held command. Here it is one change.
- **Writes.** Today any line can write any variable. Here the four values are
  immutable. A work returns new ones, and `commit` assigns them. Given and the
  waiting list are also assigned at a call (see "Constraints replaced").

## How it differs from E

E keeps one immutable `RunState`, split into parts that each have one owner
module, and stores what was last published.

- **One value against four.** E puts definitions, progress, statuses, the
  active step, sightings, held commands and the serial number in one value.
  Here they are split by lifetime, as CODING_STANDARDS.md asks: a frame
  replaces only Live, and a definition handed over at a call is not part of
  what a change compares.
- **No active slot.** E stores `activeStep` and a map of sightings whose step
  is implied by progress, and keeps both in step with progress. Here the
  visit carries its walkthrough, its key and its sighting, and is checked
  against progress when read. Nothing writes "which is open".
- **No counter.** E stores `lastSerialNumber`. Here a symbol per visit.
- **Held commands are works, not data.** E adds a `Command` union, one
  `apply` and `RunState.held`. Here a held command is the same work an
  unheld one runs, kept in the shell. It is never drawn, saved or compared,
  so it is not a fact, and no union or dispatcher needs writing.
- **Tasks are worked out.** E stores `tasks` in its checklists part. Here
  they are worked out from the groups handed over.
- **Nothing published is stored.** E's `Published<T>` is assigned by
  `commit`. Here a view caches its last result by the identity of its
  inputs, so it cannot hold anything its inputs do not give.
- **A change has parts, not one source.** E's change has one `Source`
  (`command`, `arrival` or `storage`). The record coming in has to be all
  three at once (what storage said, checked against the definitions, then
  every held command), so here a change is up to three ordered parts, each
  with its own baseline for saving and for announcing.
- **`looked` stays, as a latch on the visit.** E proposes that the first
  look is due while attached and not started. A step that has started is not
  due under that rule when the Run attaches again, so nothing reads it as it
  attaches. "keeps a click's delay through a spell detached" needs that
  read: the click's delay passed while detached, and the step must advance
  as the Run attaches, before any frame.
- **`restored` is settled.** E's open question proposes "has progress, has
  no definition". That cannot work: a definition is taken at the call, before
  the change that checks the entry against it, so nothing could tell that the
  check is still due. Here the check is still due while the entry is the
  object storage gave.

## The state that remains, and why

Every piece of state in grounding.md's inventory, and where it went.

### Stored: inputs the app gave once

- `Given.walkthroughs`: every definition used, the first under each id. Code
  handed over at a call, and needed at the call to throw on a second
  definition under one id.
- `Given.groups`: each `defineChecklists` group used, in the order used.
- `Given.context`: the latest facts for completion conditions.
- `RunShell.held`: commands given while the record loads, as works. Given
  once, and they must run in order on the user's progress.
- `RunShell.listeners`, `Handle.listeners`, `PageState.attachments`: given by
  the app or a renderer.
- `RunShell.handles`: the `Checklist` object handed out for each definition,
  which must be the same object each time.

### Stored: what storage or the browser said once

- `Recorded.progress`, `Recorded.statuses`: the user's record. Saved.
- `Recorded.storage`: storage's last word, `loading`, `read`, `unreadable`
  (with the error) or `failed`.
- `Live.visit.sighting`: where the step's Waymark is (`waymark`), since when
  it has not been seen (`unseenSince`), and the element last found
  (`element`). The page measures; the Run cannot measure again in the past.
  The element is also reused to skip a `querySelector`, worth 88 ns a frame
  on the perf page (run.perf.ts, this machine), more on a larger page.
- `Live.beacons`: the same, for each collapsed walkthrough's Waymark that has
  been looked for. A beacon not looked for yet is worked out as unsighted.
- `Visit.heldSince`: since when the step's condition has held, for a step
  that waits a while. A time the frames told.

### Stored: latches, which remember that something happened

- `Visit.started`: the walkthrough's `start` has gone through, so clicks
  and checks count. Carried from step to step.
- `Visit.resumed`: it opened part way through, so `start` is not announced.
- `Visit.looked`: looked at since the Run last attached.
- `Visit.satisfied`, `Visit.unlocked`, `Visit.scrolled`: the step's click or
  event happened; Next is unlocked; the Waymark was scrolled into view.
- `Visit.walkthrough`, `Visit.key`, `Sighting.step`: which walkthrough and
  which step the visit is to. A stamp, checked against progress when read,
  never kept in step with it.
- `Recorded.unchecked`: entries storage gave that no definition has checked.
  Not "has no definition", for the reason under E above.
- `Asked.waiting`: requests not yet used up. A request is used up when it
  opens or is found started, and `reset` must not bring it back, so it
  cannot be worked out from progress.
- `Asked.startedFrom`: the checklist whose Start opened each running
  walkthrough. Which button was pressed is not in the record.

### Stored: handles on the outside world

- `PageState.watching`: the four DOM hookups, each with the key it was opened
  for.
- `PageState.thrown`: the state-check errors reported on one visit, one
  value, so the visit and its errors cannot disagree as `thrownStep` and
  `thrownErrors` can today.
- `AttachedRuns`: how many Runs are attached to each page, for the
  development warning.
- `LinkState`: open connections, whether storage was asked, and how to stop
  hearing.
- `RunShell.server`: the four values as the Run was made, after an `initial`
  record is in. Every server snapshot is worked out from them.
- `QueueState`: unchanged.

### Worked out

- Which walkthrough is open: from progress and the visit (`openOf`).
- The step's Snapshot, `canAdvance` included: from the definition, the entry
  and the visit (`running`).
- Which walkthroughs show as beacons, and where: from progress, `unchecked`,
  the definitions and `Live.beacons` (`collapsed`, and the Run's view).
- The public `StorageStatus`: from `Recorded.storage`.
- Whether to report `recordUnreadable`: from the storage state before and
  after a change.
- The Tasks, a Task by id, the open walkthrough's Task: from the groups.
- Every snapshot, the Run's and each checklist's, server ones included.
- What to save: from the record at the save baseline and after.
- Checklist events and `checklistComplete`: from the record at the announce
  baseline and after.
- Which DOM hookups are wanted: from the visit and the beacons.
- Whether the first look is due: attached, an open visit, not looked.
- Which unchecked entries the next arrival checks: from `unchecked` and the
  definitions (`due`).

### Gone

- `machine`, `lastGeneration`, `looked`, `restored`, `unreadable`,
  `thrownStep`, `thrownErrors`, `openShown`, `beaconsShown`, `snapshot`,
  `views`, `tasks`, `taskById`, `sightings`, `storageStatus`, and the
  State's `stepGeneration`, `attached` and `snapshot`.
- Run events, problems and credits: no longer variables. Each change makes a
  sink and throws it away (change.ts).

## A change

`commit(phases)` keeps today's eleven steps (grounding.md) in today's
order. The sketch `alt-derived/run.ts` maps each one. In short, by today's
numbers:

- 1: take the four values as they are, and `Date.now()` once.
- 2 to 5: run the parts, in order, each followed by `finish` (steps 4 and 5:
  Tasks done for walkthroughs just finished, `startedFrom` pruned), and
  `settle` once at the end (step 3). Assign the results.
- 6: evaluate every view, before any callback runs.
- 7: `page.afterChange`: DOM hookups to match, and the first look queued
  when due. Always, so a fired frame is asked for again.
- 8 to 11: notify, save, report problems, then `onEvent`, through the queue,
  as today.

The parts of a change:

- `storage`: what storage said (`loaded`, `heard`, `refused`, `replaced`).
  Not saved, as storage holds it. Not announced.
- `arrival`: every unchecked entry whose definition has come checked, then
  the completion conditions asked. Saved. No checklist events.
- `commands`: one command's work, or every held one. Saved and announced.
  Each checks its own walkthrough's entry first, as today.

What is saved is the difference from the end of `storage` (or from the
start), or the whole record with `whole`. What is announced as checklist
events is the difference from the end of the last part before `commands`,
and only when a command ran. Run events are told as
they happen, not worked out from a before and after: going from step 2 to
step 1 is `previous` or `reset`, and held commands can move a step twice.

A still frame changes no fact and tells nothing. `commit` then skips the
views, the notifications, the save and the events, and only does step 7.

### The first look

When a change leaves an open visit that has not been looked at while a
renderer is attached, `page.afterChange` queues a look. When the look runs,
from the queue, it looks at whichever visit is open then, and does nothing if
no look is due. It measures that step and commits one message, `look`, at
once: `looked`, then the read, then `start`. So:

- a step a handler moved before the look ran is the step measured, and its
  `start` names the visit measured. A look cannot go stale.
- `start` is announced before anything a listener does on seeing the
  walkthrough open, because the look is queued before the change's
  notifications, and commits at once rather than queueing another change.

## Flow: a handler that starts and advances at once

The test in `open.test.ts`: a Run attached to the page; walkthrough `other`
(one empty step), and `t`, whose second step waits for a click on the
`save` Waymark. On `other`'s `start`, the handler calls `run.start(t)` then
`run.act("advance", t)`. Steps are counted from 1. V1, V2 and V3 name visits
by their key: a visit's latches change, its key does not.

1. `run.start(other)`. Change C1: `start(other)` finds nothing open and opens
   `other` fresh: its entry (running, step 1) and visit V1 (not started, not
   looked). `page.afterChange` queues look L1. Queue: L1, C1's notifications.
2. L1 runs. A look is due for V1. Step 1 has no Waymark and no condition, so
   the read is empty. The `look` message commits at once (C2): V1 looked and
   started, `other:start` told. The Snapshot did not move, so nobody is
   notified. Queue: C1's notifications, C2's `onEvent`.
3. `onEvent(other:start)`. The handler calls `run.start(t)`, queued as C3,
   and `run.act("advance", t)`, queued as C4.
4. C3: `start(t)`. `other` is open, so it is set aside as its `dismiss` says
   (collapsed) and `other:interrupt` is told, by `t`. `t` opens fresh: entry
   at step 1, visit V2, not looked. `settle`: V2 counts; the beacons are
   empty while `t` is open. `page.afterChange` queues look L2, and closes
   the input hookup, as nothing listens before a look.
5. C4: `act("advance", t)`. `t` is open and its first step has no
   condition, so its gate is open. The rules move it to step 2 with a new
   visit V3, carrying `started`, `resumed` and `looked` from V2, all false.
   `t:advance` is told. `page.afterChange` queues look L3.
6. L2 runs. A look is due for whatever is open: V3, not looked. It measures
   step 2 and finds the `save` Waymark, then commits `look` for V3 at once
   (C5): V3 looked, Waymark found, started, `t:start` told.
   `page.afterChange` opens the input hookup, the frame loop and the
   Waymark's aria.
7. The queue runs on: C3's notifications and `other:interrupt`; L3, which
   finds V3 looked and does nothing; C4's notifications and `t:advance`;
   C5's notification and `t:start`.
8. `flush()` runs frames. The Waymark has not moved, so each frame changes no
   fact.
9. The click lands on the Waymark. The `click` message names V3, the visit
   open, and V3 has started, so the click counts: the condition is met, the
   step was the last, `t:advance` and `t:finish` are told.

Events, in order: `other:start`, `other:interrupt`, `t:advance`, `t:start`,
`t:advance`, `t:finish`. `t`'s first step was never drawn, so its `start`
comes with the first step that was, step 2.

Today the same test fails at step 6 of this flow. The look queued in C3
carried V2's step generation, so its `start` was dropped as stale once C4
had moved the step, and `looked` already named `t`'s machine, so no second
look came. `t` never started, and the click did not count.

## The nine tests

- `checklists/storage.test.ts`, "shows a record it cannot read as unreadable
  in each checklist": the load is `storage: loaded(...)`, which makes
  `Recorded.storage` `unreadable`. A checklist's `storageStatus` is worked
  out from it.
- `checklists/storage.test.ts`, "takes the statuses in and runs every command
  held meanwhile as one change": the load, the arrival and the held `skip`
  and `markTodo` are one change, so the checklist is notified once by it.
  The listener is called twice, as `subscribe` calls it at once; see "Known
  contradiction" below.
- `run/open.test.ts`, "starts a walkthrough a handler starts and advances in
  one go": the first look looks at whichever visit is open when it runs. See
  the flow above.
- `run/storage.test.ts`, "reports a record it cannot read once, starts
  afresh, and never saves over it": the load turns storage `unreadable`, so
  `recordUnreadable` is reported once and the progress is empty. A
  `storage` part is not saved, and the arrival changes nothing, so nothing
  is saved. The saves after `requestStart` and `advance` are refused by
  storage; `refused` finds storage already `unreadable`, so nothing is
  reported again.
- `run/storage.test.ts`, "shows a record it cannot read as unreadable, heard
  or loaded, until it reads one it can": `heard` turns storage `unreadable` on
  a record it cannot read, and back to `read` on one it can.
- `run/storage.test.ts`, "shows an unreadable record given as `initial` as
  unreadable, on the server too": the `initial` record is taken in as the Run
  is made, before the server's four values are kept.
- `run/storage.test.ts`, "takes the record in and runs every command held
  meanwhile as one change": as the checklist one. `act("advance", tour)` runs
  after the arrival has opened `tour` where it was, and `start(hint)`
  collapses it. One change, so one notification after the at-once one.
- `run/storage.test.ts`, "puts a request made while loading straight on the
  waiting list": `requestStart` puts the request on `Asked.waiting` at the
  call. In the load's change, the held `start(tour)` finds nothing open and
  opens `tour` without interrupting anything. `settle`, once at the end, finds
  `tour` open, so `whatsNew` waits until `tour` exits.
- `storage/adapter.test.ts`, "hands text that is not JSON on": the adapter
  already hands the text on, and `parseRecord` reports it as not one Waymark
  wrote. It fails today only because the status is `error`; here it is
  `unreadable`.

### Known contradiction

The two "one change" tests (`run/storage.test.ts:352`,
`checklists/storage.test.ts:154`) subscribe while the record loads and then
assert `toHaveBeenCalledExactlyOnceWith`. `subscribe` calls a new listener at
once, as `checklists.test.ts:539` and the Svelte store contract need. So the
listener is called twice: the loading snapshot, then the final one. This
design builds that, and those two tests fail: 275 of 277 core tests are
expected to pass.

## Modules

Line counts are estimates. The modules below replace run.ts, rules.ts,
run/state.ts, checklists/tasks.ts, checklists/statuses.ts and
checklists/views.ts, 1,947 lines today, with about 1,850. `state.ts` adds its
types, about 345 lines, most of them the reasons fields are stored.

### `run/run.ts`, about 270 lines

- Owns: `RunShell`: the four values, held commands, listeners, checklist
  handles, the server's four values.
- Contract: the only place the four values are assigned. `commit` assigns
  Recorded, Asked and Live once per change; a call assigns Given, and Asked
  when a request joins or leaves the waiting list. Every public method turns
  into a change's parts.
- Exports: `createRun`, with today's signature.

### `run/change.ts`, about 90 lines

- Owns: nothing past one change. A sink for what the change tells.
- Contract: runs the parts in order, `finish` after each, `settle` once, and
  says where the save and the announcements are worked out from.
- Exports: `runChange(before, phases, now, verdicts)`, `idle(before, ran)`,
  the types `Told` and `Ran`.

### `run/record.ts`, about 170 lines

- Owns: `Recorded`. The only module that makes one.
- Contract: pure. Every function hands back the same object when nothing
  changed. Storage's answers become a Recorded here.
- Exports: `recordedAt`, `storageStatus`, `turnedUnreadable`, `isUnchecked`,
  `due`, `loaded`, `heard`, `replaced`, `refused`, `put`, `checked`, `place`,
  `setStatus`, the type `Place`.

### `run/walkthroughs.ts`, about 230 lines

- Owns: every decision about walkthroughs: progress entries (through
  record.ts), `Asked.waiting`, `Live.visit`, `Live.beacons`.
- Contract: pure works. Which walkthrough is open is worked out, never
  written. `settle` drops a visit that does not count, opens the next
  request, and keeps the beacons only while none is open.
- Exports: `openOf`, `openId`, `collapsed`, `sightingOf`, `wait`, `unwait`,
  `check`, `checkAll`, `start`, `request`, `act`, `reset`, `obey`,
  `detached`, `sightBeacons`, `settle`.

### `run/rules.ts`, about 400 lines

- Owns: nothing. The rules of one step.
- Contract: pure. `apply(on, message)` takes the walkthrough, its entry and
  its visit, and returns the entry's next place, the next visit and what it
  said. The Snapshot is worked out by `running`, so `show` and `gate` go.
- Exports: `apply`, `enter`, `canAdvance`, `running`, `ended`,
  `needsAdvanceRead`, `liveWatchers`, `unsighted`, `sight`,
  `sameWaymarkEvents`, the types `OnStep`, `Outcome`, `Carried`,
  `MachineEvent`, `WaymarkEvents`, `LiveWatchers`; and, moved as they are,
  `WaymarkRead`, `AdvanceRead`, `StepRead`, `WaymarkAria`, `sameWaymarkAria`,
  `NOTHING_LIVE`, `stepAt`.

### `run/tasks.ts`, about 190 lines

- Owns: every decision about Tasks: statuses (through record.ts) and
  `Asked.startedFrom`.
- Contract: pure works. Completion conditions are asked through
  `change.verdicts`, so no app code runs inside a work.
- Exports: `tasksOf`, `taskOf`, `taskFor`, `isComplete`, `markDone`,
  `markTodo`, `toggle`, `skip`, `startFrom`, `conditions`, `finish`,
  `eventsBetween`.

### `run/views.ts`, about 170 lines

- Owns: no state. Caches.
- Contract: every snapshot is a function of the four values, the same object
  until something it shows moves. `commit` evaluates each once per change;
  `getSnapshot` hands back the last.
- Exports: `runView(server)`, `checklistView(definition, server)`, the type
  `View`.

### `run/memo.ts`, about 30 lines

- Owns: one cache slot per view.
- Contract: hands back the last result while every argument is the same
  object, and gives `compute` the last result so it can keep identity when
  nothing drawn moved.
- Exports: `memo`, `sameFields`, the type `Memo`.

### `run/page.ts`, about 240 lines

- Owns: `PageState` and the module-level `AttachedRuns`.
- Contract: reads the four values and never writes them. What it sees goes to
  the Run as a message or a work, which `commit` runs as a change. Only the
  first look commits at once.
- Exports: `createPage(deps)`, the types `PageDeps` and `Page`.

### `storage/link.ts`, about 60 lines

- Owns: `LinkState`.
- Contract: asks storage for the record once, hears other tabs while
  connected and the record is in, and sends saves. Holds no fact about the
  record.
- Exports: `createLink(deps)`, the types `LinkDeps` and `Link`.

### Unchanged

`run/input.ts`, `run/types.ts`, `checklists/checklists.ts`,
`checklists/record.ts`, `checklists/validate.ts`, `storage/records.ts`,
`storage/adapter.ts`, `queue.ts`, `subscribe.ts`, `problems.ts`.
`checklists/types.ts` gains `"unreadable"` in `StorageStatus`.

## Constraints replaced

- **"Commit alone writes the state"** (E's rule) becomes: `commit` writes
  Recorded, Asked and Live; a call writes Given and joins or withdraws a
  request. A definition clash must throw at the call that made it, as
  today, and a request made while loading must be waiting before the held
  commands run.
- **"One writer per piece of state"** is read as one module, not one
  function. `Asked.waiting` is joined at the call and dropped in changes,
  all by walkthroughs.ts. Every Recorded is made by record.ts; which entry
  a change puts is decided by walkthroughs.ts, which status by tasks.ts.
- **"Store only when deriving is too slow or impossible"** is read to
  include latches. That `start` went through, or that a click happened, is
  history the current facts no longer show, so it cannot be worked out.
- **Today's commit order.** Steps 3 to 5 ran once per change. Here `finish`
  (steps 4 and 5) runs after each part, and `settle` (step 3) once, at the
  end. Taking the record in with every held command is then one change, as
  two of the nine tests ask, and a request made while loading waits behind a
  start held meanwhile. A still frame skips steps 6 and 8 to 11.

## Behaviour that changes, besides the nine tests

- **A save storage refused as unreadable shows `unreadable`.** Today it is
  reported and the status stays `ready`. Here the refusal is the same fact a
  load would have told, so storage turns `unreadable`, and the report comes
  from that change, once. The coordinator may prefer to keep the status: it
  would need `refused` to report without changing `Recorded.storage`, and a
  flag to report once.
- **Held commands are one change.** Checklist events are the difference
  over all of them: a Task toggled twice while loading announces nothing. A
  request opens only at the end, so a held `act("advance")` with no
  walkthrough after a held `requestStart` finds nothing open. Tasks still
  finish after each held command, so none is lost.
- **A request joins the waiting list at the call.** A change queued ahead of
  the request's own, from a callback while nothing is open, can open it one
  change sooner, in the same drain. No event I can find moves, as opening
  says nothing until its first look, but a listener can see one snapshot
  fewer.

## Can walkthroughs and checklists share one model?

They already share the parts where they meet, and should not share more.

- **Shared:** one record (progress and statuses saved together, and compared
  together for checklist events), one Given, one change pipeline, one view
  layer.
- **Apart:** a walkthrough has a live step, the page and at most one open at
  a time; a Task is a status with an optional condition. A Task's status
  cannot be worked out from its walkthrough's progress, as the user can mark
  it done, skip it or reopen it without the walkthrough. What does follow
  from progress is worked out: `inProgress`, the open Task, and a Task done
  once its walkthrough finishes (`finish`).

So: one record, two modules deciding what goes in it, walkthroughs.ts and
tasks.ts.

## Predicted counts

Guesses, for the implementer to measure with count-state.ts.

- About 25 mutable variables, against 42 today: the shell's four values,
  held, listeners and handles (7); memo.ts's two, counted once for every
  view (2); page.ts's attachments, four watchers, thrown and the
  module-level count (7); link.ts's three (3); queue.ts's three (3); the
  change sink (up to 4, depending on whether it is one object); the Tasks
  cache (1).
- Pairs kept in step by hand: none. The candidates, and why each is not one:
  - The visit and the entry: the visit is checked against the entry when
    read, and `settle` drops one that does not count. No write keeps them in
    step; the rules return both from one function when the step moves.
  - `unchecked` and progress: by identity, so a write ends it.
  - `Live.beacons` and progress: each sighting names its step; one for
    another step is ignored.
  - `startedFrom` and progress: pruned in one place, `finish`, after every
    part of every change.
- Stored fields that could be worked out:
  - `Given.walkthroughs` holds the Tasks' walkthroughs, which the groups
    also hold. Kept so a clash throws at the call.
  - `Visit.started`, `resumed` and `looked` are copied from visit to visit
    by `enter`. They belong to the walkthrough's time on screen, not to the
    step; a value of their own would remove the copy, at the cost of one
    more value to check against progress.
  - `Sighting.element`, reused to skip a `querySelector` (88 ns a frame on
    the perf page).

## Predicted performance, every frame

Today, on this machine at the start of this work: "still waymark" 3,780 ns,
"moving waymark (transform)" 13,464 ns (load average 1.39, other agents
running). The predictions below are guesses from reading the code, not
measurements.

- **Still Waymark: likely 5 to 15% faster.** Today every frame runs the
  whole commit: three `moment()`s, a new Map for credits and another in
  `settle`, `finishTasks`, `build` (with a `tasks.find`), `changesBetween`
  and, with checklists, `refresh` of every view. Here the rules hand back the
  same visit, the four values are the same objects, and `commit` only
  reconciles the hookups. What
  remains is the measuring itself (`getBoundingClientRect` is about 1,017 ns
  of the frame) and `liveWatchers`.
- **Moving Waymark: likely within 5% either way.** Each frame makes a new
  Sighting, Visit, Live and four-value object, against today's new State and
  Snapshot. Then the step's Snapshot, the open walkthrough and the Run's
  snapshot are made anew, as today. Checklist views hit their cache. Today's
  `settle` makes a Map per frame and this does not, which may pay for the
  extra objects.
- **Risk.** Every work must hand back the same object when nothing moved.
  One that does not makes every still frame a full change, with no type
  error; if the new object reaches what a snapshot shows, every listener is
  notified once a frame. A test that counts
  notifications over still frames would catch it; the implementer should
  check one exists.

## Predicted size

- **Risk: medium. Likely within 3% of today, either way.** Gone: `show`,
  `gate`, `fresh`, `end`, `opening`, `release`, `record`, the `restored`
  bookkeeping, `lastGeneration`, the `Statuses` object, `createView` and
  `refresh`, and the flags. Added: memo.ts, the change's parts, `openOf`'s
  check, `settle` making a visit, the storage state's mapping. Immutable
  updates of nested values (`{ ...facts, recorded: { ...recorded, progress } }`)
  minify worse than writing in place, and there are many. Small helpers
  (`withRecorded`, `withLive`) keep that down.
- The walkthrough-only bundle still carries checklist code, as `createRun`
  imports tasks.ts. Winning it back needs the seam E's STATE.md describes;
  not in this design.

## Risks

- **Identity discipline** (above). The cost of a slip is invisible until it
  is measured.
- **A visit made by `settle`.** If a work opens an entry without making its
  visit, `settle` makes a resumed one, and `start` is never announced. The
  Run then looks fine but says nothing. A development assertion in `settle`,
  for an entry opened in this change, would catch it.
- **Three baselines in a change** (`storage`, `arrival`, `commands`). Right
  for the load, but a new kind of change has to pick its parts with care.
- **`commitNow`.** The first look commits outside `queue.run`. It is safe
  only because the look itself runs from the queue; called from anywhere
  else it would break the queue's order. page.ts is the only caller.
- **Caches shared by Runs.** `collapsed` and `due` hold one slot each. Two
  Runs on one page thrash them but stay correct.
- **The refused-save status** (under "Behaviour that changes") is a decision
  for the coordinator.
