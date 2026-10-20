# Alternative 1: derive everything

## The problem

At `181a36d`, `createRun` in `packages/core/src/run/run.ts` holds about 40 variables in one closure, and any of its 1,099 lines can write any of them. Several pairs must be kept in step by hand. The worst is the open walkthrough's live state (`machine`) and its saved place (`progress[id]`). A change that moves one and forgets the other leaves the Run drawing a walkthrough its record says is closed, or the reverse, and no type error says so.

This design removes the pairs by storing less. A fact is stored once, where the Run learns it, and everything that follows from it is worked out when it is read. Two copies cannot drift apart when one of them is a function of the other.

This document describes what was built on branch `run-alt-derived`. The types are in `packages/core/src/state.ts`.

## Terms

- **Fact.** Something the Run was told and cannot work out again: an input the app gave once, something the browser or storage said once, or a latch that remembers that something happened.
- **Given, Recorded, Asked, Live.** The four values the facts are kept in, apart by how long they last and how often they change.
  - `Given` is what the app handed over: definitions, checklist groups and the context. A call assigns it.
  - `Recorded` is the user's record as this tab holds it: progress, statuses, the entries no definition has checked yet, and storage's last word. Progress and statuses are what is saved.
  - `Asked` is what the app asked for that has not finished: the requests waiting, and the checklist that started each running walkthrough. This tab only.
  - `Live` is what the page shows now: the visit and the beacons' sightings. It changes per frame.
- **Visit.** What the page and the user have done on the open walkthrough's current step since it showed. Each visit has its own `symbol` key.
- **Work.** A pure function `(facts, change) => facts` for one command. It hands back `facts` itself when nothing moved. No DOM, no storage, no app code.
- **Change.** Up to three parts, `storage`, `arrival` and `commands`, run in that order, then `settle`. `commit` in `run.ts` runs one and announces it.
- **View.** A function from the facts to something the Run hands out, cached by the identity of what it reads.

## How it differs from today

- **Which walkthrough is open.** Today `machine` is stored beside `progress` and kept in step by `record`, `release` and `arrive`. Here it is worked out by `openOf`: the visit's walkthrough, while its entry is running, not collapsed and at the visit's step. A visit that no longer counts is dropped by `settle`.
- **The step's Snapshot.** Today it is stored in `machine.state.snapshot` and kept in step with `unlocked` and the Waymark by `show` and `gate`. Here `running` in `rules.ts` works it out from the definition, the entry and the visit, so `canAdvance` cannot fall out of step.
- **Step generations.** Today a number is carried from one walkthrough to the next through `lastGeneration`. Here each visit gets a new `symbol`. A message names the visit it was raised on and does nothing on any other.
- **`attached` and `looked`.** Today two flags, one in the rules' State and one in `run.ts`, decide when the first look is due. Here there is one latch, `Visit.looked`, beside the page's list of renderers.
- **`restored`.** Today a Set that four functions clear. Here `Recorded.unchecked` holds the entry objects storage gave. An entry is unchecked while `unchecked.get(id) === progress[id]`. Every write makes a new entry object, so there is nothing to clear.
- **`storageStatus` and `unreadable`.** Today a status and a report-once flag. Here one `StorageState`, whose `type` is the public status. `recordUnreadable` is reported in the change that turns it to `unreadable` from anything else.
- **Tasks and snapshots.** Today `tasks`, `taskById`, `views`, `snapshot`, `openShown` and `beaconsShown` are stored and refreshed in `commit`. Here the Tasks are worked out from `Given.groups`, and every snapshot is a view.
- **Flags.** Today a caller passes `silent`, `persist` and `replace`. Here a change is made of parts, and what is saved and announced follows from where each part ends.
- **Loading.** Today taking the record in is two changes, then one change per held command. Here it is one change.
- **Writes.** Today any line can write any variable. Here the four values are immutable. A work returns new ones, and `commit` assigns `Recorded`, `Asked` and `Live`. A call assigns `Given`, and `Asked` when a request joins or leaves the waiting list.

## How it differs from E

E keeps one immutable `RunState`, split into parts that each have one owner module, and stores what was last published.

- **Four values, not one.** E puts definitions, progress, statuses, the active step, sightings, held commands and a serial number in one value. Here they are split by lifetime, as `CODING_STANDARDS.md` asks. A frame replaces only `Live`, and a definition handed over at a call is not part of what a change compares.
- **No active slot.** E stores `activeStep` and keeps it in step with progress. Here the visit carries its walkthrough, its key and its sighting, and is checked against progress when read. Nothing writes "which is open".
- **No counter.** E stores `lastSerialNumber`. Here each visit has a `symbol`.
- **Held commands are works.** E adds a `Command` union, one `apply` and `RunState.held`. Here a held command is the same work an unheld one runs, kept in `run.ts`'s `held` list. It is never drawn, saved or compared.
- **Tasks are worked out.** E stores `tasks`. Here `tasksOf(groups)` works them out where they are read.
- **Nothing published is stored as state.** E's `Published<T>` is assigned by `commit`. Here each view keeps only its last result, which `getSnapshot` hands back between changes.
- **A change has parts, not one source.** E's change has one `Source`. Taking the record in has to be all three at once: what storage said, checked against the definitions, then every held command. So here a change has up to three ordered parts, each with its own baseline for saving and for announcing.
- **`looked` stays, as a latch on the visit.** E makes the first look due while attached and not started. A step that has started is then not looked at when the Run attaches again, and "keeps a click's delay through a spell detached" needs that read.

## The state that remains, and why

### What the counter finds

`count-state.ts` prints 23 mutable variables and 1 mutable field, 24 in all, against 42 and 2 (44) at `181a36d`.

- `run.ts`: `given`, `recorded`, `asked`, `live`, the four values. `held`, commands given while the record loads, as works. `handles`, the `Checklist` handed out for each definition, which must be the same object each time.
- `page.ts`: `attachedRuns`, at module level, how many Runs are attached to each page, for the development warning. `attachments`, the renderers attached. `input`, `frame`, `waymarkAria` and `waymarkEvents`, each DOM hookup with the key it was opened for, so it can be closed. `thrown`, with its field `thrown.errors`, the state-check errors already reported on one visit. Today that is two variables, `thrownStep` and `thrownErrors`, which can disagree.
- `views.ts`: `shown`, one per view, the snapshot `getSnapshot` hands back until the next change.
- `memo.ts`: `last`, one per cache, each made inside `createRun`.
- `link.ts`: `connections`, `asked` (storage was asked for the record), `unsubscribe`, and `connected` per `connect` call.
- `queue.ts`: `queue`, `draining`, `errors`. Unchanged.
- `checklists/validate.ts`: `seen`. Unchanged and local to one call; the counter flags it because a callback captures it.

The counter misses `listeners` in `run.ts` and in each handle, because `subscribe.ts` writes them through a parameter. It missed them at `181a36d` too.

### Stored facts

Inputs the app gave once:

- `Given.walkthroughs`: every definition used, the first under each id. Needed at the call, to throw on a second definition under one id.
- `Given.groups`: each `defineChecklists` group used, in the order used.
- `Given.context`: the latest facts for completion conditions.

What storage or the browser said once:

- `Recorded.progress` and `Recorded.statuses`: the user's record.
- `Recorded.storage`: `loading`, `ready`, `unreadable` (with the error) or `error`.
- `Sighting.waymark`, `Sighting.unseenSince` and `Sighting.element`, on the visit and on each beacon: where the Waymark was, since when it has not been seen, and the element last found. The Run cannot measure again in the past. The element is also reused to skip a `querySelector`.
- `Visit.heldSince`: since when the step's condition has held.

Latches:

- `Visit.started`, `resumed`, `looked`, `satisfied`, `unlocked` and `scrolled`.
- `Visit.walkthrough`, `Visit.key` and `Sighting.step`: which walkthrough and step the visit is to. A stamp, checked against progress when read.
- `Recorded.unchecked`: not "has no definition", because a definition is taken at the call, before the change that checks its entry against it.
- `Asked.waiting`: a request is used up when it opens or is found started, and `reset` must not bring it back, so it cannot be worked out from progress.
- `Asked.startedFrom`: the record does not say which checklist's Start was pressed.

### Worked out

- Which walkthrough is open (`openOf`, `openId`).
- The step's Snapshot, `canAdvance` included (`running`).
- Which walkthroughs show as beacons, and where (`beaconCandidates`, `sightingOf`, the Run's view).
- The public `StorageStatus`: `Recorded.storage.type`.
- Whether to report `recordUnreadable` (`turnedUnreadable`).
- The Tasks, a Task by id, the open walkthrough's Task (`tasksOf`, `taskOf`, `taskIdFor`).
- Every snapshot, the Run's and each checklist's, server ones included.
- What to save, and the checklist events and `checklistComplete` to announce.
- Which DOM hookups are wanted, and whether the first look is due.

### Gone

- Gone outright: `machine`, `lastGeneration`, `looked`, `restored`, `unreadable`, `thrownStep`, `openShown`, `beaconsShown`, `snapshot`, `tasks`, `taskById`, `storageStatus`, `withdrawn`, the `Statuses` object, and the State's `stepGeneration`, `attached` and `snapshot`.
- No longer variables of their own: `definitions`, `groups` and `context` are fields of `Given`; `sightings` is `Live.beacons`; `waiting` and `startedFrom` are fields of `Asked`; `views` and `checklists` are one map, `handles`; `thrownErrors` is part of `thrown`.
- Run events, problems and credits: each change makes a `Change` object and drops it.

### Pairs kept in step by hand

None that two writers must keep in step. These come closest, and each is enforced in one place:

- `Live.beacons` and `Live.visit`. While a visit is open, the beacons must be empty, so each beacon is looked for afresh when it shows again. `keepBeacons`, the last step of `settle`, empties them after every change.
- `Asked.startedFrom` and progress. An entry for a walkthrough that stopped running is dropped by `finish`, after every part of every change. A stale entry would credit a later Skip to the wrong checklist.
- The visit and its entry. Never kept in step: the rules return both from one call, `open` writes both, and a visit that does not match its entry does not count.

### Stored fields that could be worked out

- `Given.walkthroughs` holds each Task's walkthrough, which `Given.groups` also holds. `join` copies them in, so a clash throws at the call and `start` finds a definition by id.
- `Visit.started`, `resumed` and `looked` are copied from visit to visit by `enter`. They belong to the walkthrough's time on screen, not to the step.
- `Sighting.element`, kept to skip a `querySelector` each frame.
- `Visit.walkthrough` could be found by scanning progress for the one running, uncollapsed, checked entry. The visit names it so a frame finds the open walkthrough in two lookups.
- Each checklist handle's server snapshot, and the Run's, worked out once from the facts as the Run was made.

## One change

`commit(phases)` in `run.ts` keeps today's order.

1. `runChange(facts(), phases, Date.now(), verdicts)` in `change.ts` runs the parts. After each part, `finish` marks done each Task without a condition whose walkthrough just finished, and forgets `startedFrom` for each walkthrough that stopped running. Then `settle` runs once.
2. `commit` assigns `Recorded`, `Asked` and `Live`, then scrolls to any Waymark a rule asked for.
3. Every view is evaluated, the Run's and each checklist's, before any callback runs, so a callback that reads another snapshot sees this change too.
4. `page.afterChange` opens or closes each DOM hookup to match, and queues the first look when one is due. This happens after every change, as a frame that has fired has closed itself.
5. The Run's listeners, if its snapshot is a new object, then each checklist's whose snapshot is.
6. The save, then `onChange`.
7. Problems, `recordUnreadable` first when storage turned unreadable.
8. `onEvent`: run events in the order told, then checklist events, then `checklistComplete` for each checklist that was not complete at the announce baseline and is now.

Steps 5 to 8 call the app at once, as today. Work they start goes through the queue, after this change.

The parts of a change:

- `storage`: what storage said (`loaded`, `heard`, `refused` or `replaced` in `record.ts`).
- `arrival`: `checkAll`, which checks every unchecked entry whose definition has come, then `conditions`, which asks the completion conditions.
- `commands`: one command's work, or every held one.

What is saved is the difference from the end of `storage` to the end of the change, or the whole record when `replace` is set. Checklist events are the difference from the end of `arrival`, and only when a command ran, so neither a load nor a checklist reaching the Run announces what the user did before. Run events are told as they happen, not worked out from a before and after: going from step 2 to step 1 is `previous` or `reset`, and held commands can move a step twice.

`settle` has three steps:

1. `dropClosedVisit`: a visit that no longer counts is dropped. If its walkthrough is a beacon at that step, the beacon starts from the visit's sighting.
2. `openRequest`: with nothing open and storage not `loading`, the first waiting request without progress opens, and the requests before it, found started since, are dropped.
3. `keepBeacons`: empty while a visit is open; otherwise only those still collapsed at their sighting's step.

A still frame changes no fact. Every work hands back the same objects, so the views' caches hit, nothing is notified, `changesBetween` is skipped because progress and statuses are the same objects, and only `afterChange` does work, asking for the next frame.

### The first look

When a change leaves an open visit that has not been looked at while a renderer is attached, `afterChange` queues `look`. When `look` runs, from the queue, it looks at whichever visit is open then, and does nothing if none is due. It measures that step and commits one message, `{ type: "look" }`, at once through `commitNow` rather than queueing a change. The rules set `looked`, apply the read, set `started` and tell `start`, unless the visit was resumed. So:

- a step a handler moved before the look ran is the step measured, and `start` names that visit. A look cannot go stale.
- `start` is announced before anything a listener queued on seeing the walkthrough open, because `look` was queued first.

## Flow: a handler that starts and advances at once

The test in `open.test.ts`, "starts a walkthrough a handler starts and advances in one go". A Run is attached. Walkthrough `other` has one empty step. Walkthrough `t` has an empty step, then a step that waits for a click on the `save` Waymark. On `other:start`, the handler calls `run.start(t)` and then `run.act("advance", t)`. Steps are counted from 1. V1, V2 and V3 are visits.

1. `watch(run)` attaches. Change C0 has no parts. Nothing is open, so `afterChange` opens nothing.
2. `run.start(other)` takes `other` into `Given` and runs C1 with `start(other)`. Nothing is open, so `open` makes `other`'s entry (running, step 1) and visit V1 (not started, not looked) together. `afterChange` queues look L1. The Run's snapshot is a new object, so its listeners are notified. C1 tells no event: opening says nothing until the first look.
3. L1 runs. V1 is open and not looked. Step 1 has no Waymark and no condition, so there is nothing to read. C2 commits `look` for V1 at once: V1 is looked and started, and `other:start` is told. The Snapshot did not move, so the open view hands back the same object and nobody is notified. `afterChange` opens the input hookup. `onEvent(other:start)` calls the handler, which queues C3, `start(t)`, and C4, `act("advance", t)`.
4. C3: `other` is open, so `interrupt` collapses it, as its `dismiss` says, and tells `other:interrupt`. `open` makes `t`'s entry at step 1 and visit V2, which replaces V1 in `Live`. `settle` keeps V2. `afterChange` queues look L2, and closes the input hookup, as nothing listens on a step before its first look. `onEvent(other:interrupt)`.
5. C4: `t` is open and step 1 has no condition, so its gate is open. The rules move `t` to step 2 with a new visit V3, which carries `started`, `resumed` and `looked` from V2, all false. `t:advance` is told. `afterChange` queues look L3. `onEvent(t:advance)`.
6. L2 runs and looks at whatever is open now: V3, not looked. It measures step 2 and finds the `save` Waymark. C5 commits `look` for V3: V3 is looked, its Waymark found, started, and `t:start` is told. `afterChange` opens the input hookup, the frame loop and the Waymark's aria attributes. `onEvent(t:start)`.
7. L3 runs, finds V3 looked, and does nothing.
8. `flush()` runs a frame. The Waymark has not moved, so the read changes no fact, and `afterChange` asks for the next frame.
9. The click lands on the Waymark. The input hookup sends `click` for V3, the visit open, and V3 has started, so the click counts. The step is the last, so the rules tell `t:advance` and `t:finish`.

Events, in order: `other:start`, `other:interrupt`, `t:advance`, `t:start`, `t:advance`, `t:finish`.

At `181a36d` the same test fails at step 6. The look queued in C3 carried V2's step generation, so its `start` was dropped as stale once C4 had moved the step, and `looked` already named `t`'s machine, so no second look came. `t` never started, and the click did not count.

## The nine tests

Seven of the nine tests that fail at `181a36d` pass:

- `checklists/storage.test.ts`, "shows a record it cannot read as unreadable in each checklist": `loaded` turns `Recorded.storage` to `unreadable`, and each checklist's `storageStatus` is its `type`.
- `run/open.test.ts`, "starts a walkthrough a handler starts and advances in one go": see the flow above.
- `run/storage.test.ts`, "reports a record it cannot read once, starts afresh, and never saves over it": the load turns storage `unreadable`, so `recordUnreadable` is reported once. The saves after are refused by storage, and `refused` finds storage already `unreadable`, so nothing is reported again.
- `run/storage.test.ts`, "shows a record it cannot read as unreadable, heard or loaded, until it reads one it can": `heard` turns storage `unreadable` on a record it cannot read, and back to `ready` on one it can.
- `run/storage.test.ts`, "shows an unreadable record given as `initial` as unreadable, on the server too": the `initial` record is taken in as the Run is made, before the server's facts are kept.
- `run/storage.test.ts`, "puts a request made while loading straight on the waiting list": `requestStart` calls `wait` at the call. In the load's change, the held `start(tour)` finds nothing open and opens `tour`. `settle` finds `tour` open, so `whatsNew` waits until `tour` exits.
- `storage/adapter.test.ts`, "hands text that is not JSON on": the status is now `unreadable`, not `error`.

### Known contradiction

The two "held meanwhile as one change" tests, `run/storage.test.ts:352` and `checklists/storage.test.ts:154`, fail as expected and are not edited. Each subscribes while the record loads and asserts `toHaveBeenCalledExactlyOnceWith`, but `subscribe` calls a new listener at once. The listener is called exactly twice: the loading snapshot, then the final one. A scratch copy of both tests that asserts two calls, the second with the same object `getSnapshot()` hands back, passed, and was deleted before committing.

## Modules

The new modules replace `run.ts`, `rules.ts`, `run/state.ts`, `checklists/tasks.ts`, `checklists/statuses.ts` and `checklists/views.ts`, 1,947 lines at `181a36d`, with 1,777 lines, `state.ts` included. Line counts are from `count-state.ts`.

### `state.ts`, 111 lines

- Owns: the types of the four values, `Visit`, `Sighting`, `Work`, `Change`, `Phases` and `Message`. No code.
- The types stay together, not beside their writers. `Facts`, `Work` and `Change` name all four values, and every module imports them. With `Recorded` in `record.ts` and `Visit` in `rules.ts`, `state.ts` and each writer would import each other.

### `run/run.ts`, 271 lines

- Owns: the four values, `held`, the listeners and the checklist handles.
- Contract: the only place the four values are assigned. `commit` assigns `Recorded`, `Asked` and `Live` once per change. A call assigns `Given`, and `Asked` through `wait` and `unwait`. Every public method becomes a change's parts. While the record loads, a command's work is held, and the load's change runs every held work.
- Exports: `createRun`.

### `run/change.ts`, 36 lines

- Owns: nothing past one change.
- Contract: runs the parts in order, `finish` after each, `settle` once, and says where the save and the announcements are worked out from.
- Exports: `runChange`, the type `Ran`.

### `run/record.ts`, 133 lines

- Owns: making a `Recorded`. Storage's answers become one here.
- Contract: pure. `put`, `checked`, `setStatus`, `place` and `refused` hand back the same object when nothing changed.
- Exports: `recordedAt`, `LOADING`, `READY`, `turnedUnreadable`, `isUnchecked`, `loaded`, `heard`, `replaced`, `refused`, `put`, `checked`, `place`, `setStatus`, the type `Place`.

### `run/walkthroughs.ts`, 258 lines

- Owns: every decision about walkthroughs: which entry a change puts, `Asked.waiting`, `Live.visit` and `Live.beacons`.
- Contract: pure works. Which walkthrough is open is worked out, never written. `open` is the only way a walkthrough opens. It makes the entry and the visit together, and works out from the saved entry whether it opens fresh at step 1 or resumes where it was, so an open entry without a visit cannot be made.
- Exports: `openOf`, `openId`, `beaconCandidates`, `sightingOf`, `wait`, `unwait`, `checkAll`, `start`, `request`, `act`, `reset`, `obey`, `detached`, `sightBeacons`, `settle`, the type `Candidates`.

### `run/rules.ts`, 321 lines

- Owns: nothing. The rules of one step.
- Contract: pure. `apply(on, message)` takes the walkthrough, its entry and its visit, and returns the entry's next place, the next visit and what it said. The visit is `undefined` once the walkthrough ends, and new when the step moves.
- Exports: `apply`, `enter`, `running`, `ended`, `stepAt`, `unsighted`, `sight`, `restartUnseen`, `needsAdvanceRead`, `liveWatchers`, `NOTHING_LIVE`, `sameWaymarkAria`, `sameWaymarkEvents`, the types `OnStep`, `Outcome`, `WaymarkAria`, `WaymarkEvents`.

### `run/tasks.ts`, 177 lines

- Owns: every decision about Tasks: which status a change puts, and `Asked.startedFrom`.
- Contract: pure works. Completion conditions are asked through `change.verdicts`, which `run.ts` supplies, so no app code runs inside a work.
- Exports: `tasksOf`, `taskOf`, `taskIdFor`, `isComplete`, `markDone`, `markTodo`, `toggle`, `skip`, `startFrom`, `conditions`, `finish`, `eventsBetween`.

### `run/views.ts`, 132 lines

- Owns: the last snapshot of each view, and its caches.
- Contract: every snapshot is a function of the facts, the same object until something it shows moves. The Run's view caches on `Given`, `Recorded` and `Live`, and inside that on the open walkthrough, the beacons and the snapshot's four fields. A checklist's view caches on statuses, progress, storage and the open walkthrough, so a frame does not rebuild its rows.
- Exports: `runView`, `checklistView`, `candidatesOf`, the type `View`.

### `run/memo.ts`, 14 lines

- Owns: one cache slot per call of `memo`. Every cache is made inside `createRun`.
- Contract: hands back the last result while every argument is the same object, and gives `compute` the last result so it can keep identity when nothing shown moved.
- Exports: `memo`.

### `run/page.ts`, 232 lines

- Owns: the renderers attached, the four DOM hookups, the state-check errors reported on a visit, and the module-level `attachedRuns`.
- Contract: reads the facts and never writes them. What it sees goes to the Run as a change. Only the first look commits at once.
- Exports: `createPage`, the type `Page`.

### `storage/link.ts`, 92 lines

- Owns: the open connections, whether storage was asked, and how to stop hearing it.
- Contract: asks storage for the record once, on the first `connect`, hears other tabs while connected and the record is in, and sends saves. A save storage refuses as unreadable goes back to the Run as `refused`.
- Exports: `createLink`, the type `Link`.

### Unchanged

`run/input.ts`, `run/types.ts`, `checklists/checklists.ts`, `checklists/record.ts`, `checklists/validate.ts`, `storage/records.ts`, `storage/adapter.ts`, `queue.ts`, `subscribe.ts` and `problems.ts`. `checklists/types.ts` gains `"unreadable"` in `StorageStatus`. `.oxlintrc.json` now forbids page globals in `state.ts`, `change.ts`, `memo.ts`, `record.ts`, `rules.ts`, `tasks.ts`, `views.ts` and `walkthroughs.ts`.

## Measurements

### Tests and types

- `pnpm typecheck` passes.
- `pnpm --filter waymark-core test`: 275 passed, 2 failed, the two in "Known contradiction".
- `pnpm --filter react-waymark test`: 89 passed.
- `git diff 181a36d --stat -- '*.test.ts' '*.test.tsx' '*.perf.ts' 'packages/*/src/test/'` prints nothing.
- `pnpm exec oxlint packages/core/src packages/react/src` finds nothing. `pnpm lint` still fails, on E's sketches in `docs/design/run-architecture/option-e-owners-as-values/` only, as it did before this work.

### Public declarations

After `pnpm build`, `packages/react/dist/index.d.ts` matches `/tmp/run-designs/baseline/react.d.ts`. `packages/core/dist/index.d.ts` differs from `/tmp/run-designs/baseline/core.d.ts` only in `StorageStatus`:

```diff
-/** Of the stored record: `error` when it could not be read, and every Task starts todo. */
-type StorageStatus = "loading" | "ready" | "error";
+/**
+ * Of the stored record: `error` when storage failed, and `unreadable` when it
+ * holds a record this Waymark cannot read. In both, every Task starts todo.
+ */
+type StorageStatus = "loading" | "ready" | "error" | "unreadable";
```

and in the doc comment of `RunSnapshot.storageStatus`, which now names `unreadable`.

### Counts

- Mutable state from `count-state.ts`: 23 variables and 1 field, against 42 and 2 at `181a36d`. The prediction was about 25.
- Lines counted: 2,968, against 3,488 when the same script runs on an archive of `181a36d`.

### Size

`pnpm size` at `d0313fd`, gzip, against `181a36d`. Every target is missed:

- `core/all`: 12,612 B against 11,103 B, 1,509 B (13.6%) over.
- `core/run`: 12,156 B against 10,627 B, 1,529 B (14.4%) over.
- `react/all`: 19,249 B against 17,794 B, 1,455 B (8.2%) over.
- `react/walkthrough`: 16,352 B against 14,852 B, 1,500 B (10.1%) over.
- `react/headless`: 16,660 B against 15,169 B, 1,491 B (9.8%) over.
- `core/checklists`: 12,448 B against 10,931 B, 1,517 B (13.9%) over.

The design predicted "within 3%". Minified, the Run's own modules grow from 21,539 B to 25,847 B. The rest of the bundle is unchanged. By module, minified with esbuild: `rules.ts` 5,114, `walkthroughs.ts` 4,939, `run.ts` 4,037, `page.ts` 3,386, `tasks.ts` 2,770, `record.ts` 2,317, `views.ts` 2,101, `link.ts` 503, `change.ts` 495, `memo.ts` 185. At `181a36d`: `run.ts` 13,481, `rules.ts` 4,848, `run/state.ts` 1,097, `checklists/tasks.ts` 1,184, `checklists/views.ts` 734, `checklists/statuses.ts` 195.

Most of the growth is the immutable updates. Writing in place, `progress[id] = entry` is one statement. Here each write is a new `Recorded` inside a new `Facts`, behind a same-object check so a still frame stays still: `withRecorded`, `withAsked`, `withLive`, `put`, `setStatus`, and a lazily copied `Map` in `finish`, `detached`, `sightBeacons` and `keepBeacons`. Property names do not minify, and the nested values repeat them: `recorded`, `progress`, `asked`, `live`, `visit`, `sighting`. Every command is also a curried work, `(walkthrough) => (facts, change) => facts`, where today it is one function call.

### Performance

One run of `pnpm test:perf`, as a sanity check. `uptime` before: load average 2.91, 2.04, 1.88. After: 2.85, 2.05, 1.89. Other agents were running.

- "still waymark": 3,373 ns, against about 3,770 ns at `181a36d`, about 10% faster.
- "moving waymark (transform)": 13,133 ns, against about 13,490 ns, about 3% faster.
- "dirty layout": 22,608 ns. "still + state check": 3,525 ns.

A still frame builds no new fact, snapshot or `Facts` object, and skips `changesBetween`. It still makes a `Change` object, its lists, the message and the read, as today's frame makes its message, `moment()`s, lists and credits map.

## Design changes made while building

These differ from the design reviewed before building.

- **`settle` opens no request while storage is `loading`.** Otherwise the attach change, made while the record loads, opened a waiting request on the empty record, before a start held meanwhile could find it waiting.
- **No idle skip.** The design skipped views, notifications, the save and the events for a change that moved nothing. A group joining at a call changes `Given` outside any change, so the open walkthrough's `task` would have stayed stale. Every view is evaluated in every commit instead, behind a cache on `Given`, `Recorded` and `Live`, so a still frame costs three identity checks.
- **What is announced.** A change is silent when no command ran and it had a `storage` or `arrival` part. An empty command list counts as none, so the load's change with nothing held announces nothing. `savedFrom` is always the record at the end of `storage`, so anything `settle` does is saved.
- **`Change` is a plain object with lists.** The design had a sink of four functions. Works push to `change.events`, `change.problems`, `change.credits` and `change.scrolls`. That is four fewer closures per change. `commit` scrolls to each Waymark in the order asked, as today's `obey` did.
- **`StorageState` uses the public names**, `loading`, `ready`, `unreadable` and `error`, so the public status is its `type` and `storageStatus()` is gone.
- **`Phases.whole` is `Phases.replace`**, the name `StoredChanges` already uses.
- **No `due`, no `idle`, no `sameFields`, no `check`.** `checkAll` checks every definition's entry with `isUnchecked`. The Tasks are not cached: `tasksOf` runs in `finish` only when progress moved, in `conditions`, and in the open view's cache.
- **`StepRead`, `WaymarkRead` and `AdvanceRead` moved to `state.ts`**, as `Message` needs them and `rules.ts` imports `state.ts`.
- **The first look is one message**, `look`, not a read followed by `start`.
- **`settle` is three named steps**, `dropClosedVisit`, `openRequest` and `keepBeacons`.
- **No development assertion for an open entry without a visit.** `open` is the only work that makes an entry running and not collapsed, and it makes the visit in the same expression. `heard` collapses every entry open in another tab, and `loaded` and `replaced` make entries unchecked, which do not count as open until `checkAll` opens them through `open`.

## Constraints replaced

- **"Commit alone writes the state"** becomes: `commit` writes `Recorded`, `Asked` and `Live`; a call writes `Given`, and joins or withdraws a request in `Asked`. A definition clash must throw at the call that made it, and a request made while loading must be waiting before the held commands run.
- **"One writer per piece of state"** is read as one module, not one function. `Asked.waiting` is changed only through `wait`, `unwait` and `settle`'s steps, all in `walkthroughs.ts`. Every `Recorded` is made by `record.ts`. Which entry a change puts is decided by `walkthroughs.ts`, and which status by `tasks.ts`.
- **"Store only when deriving is too slow or impossible"** includes latches. That `start` went through, or that a click happened, is history the current facts no longer show.
- **Today's commit order.** `finish` runs after each part, and `settle` once at the end. Taking the record in with every held command is then one change, and a request made while loading waits behind a start held meanwhile.

## Behaviour that changes, besides the nine tests

The three the coordinator allowed:

- **A save storage refused as unreadable shows `unreadable`.** At `181a36d` it is reported and the status stays `ready`. Here `refused` is the same fact a load would have told, so storage turns `unreadable` and the report comes from that change, once.
- **Held commands are one change, announced as the net result.** A Task toggled twice while loading announces nothing.
- **A request joins the waiting list at the call.**

Two follow from them:

- **A record heard that Waymark cannot read changes the status to `unreadable`**, which one of the nine tests asks for, in a change of its own. At `181a36d` it was only reported.
- **The first look's read and its `start` are one change, not two**, so a listener sees one snapshot where it saw up to two. No test or event order changes.

## Risks

- **Identity discipline.** Every work must hand back the same object when nothing moved. One that does not makes every still frame a full change, and if the new object reaches a snapshot, every listener is notified each frame. No type error says so. The perf test would show it as a slower still frame.
- **`commitNow`.** The first look commits outside `queue.run`. That is safe only because `look` itself runs from the queue. `page.ts` is the only caller.
- **App code during a change.** `isComplete` runs inside `runChange` through `verdicts`. A condition that calls `run.requestStart` would have its `wait` overwritten when `commit` assigns `Asked`. Conditions must be pure, as the public type says.
- **Size**, above: 14% over on `core/all`.
