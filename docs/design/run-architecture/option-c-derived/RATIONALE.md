# Option C: the record is the model, the rest is worked out from it

## Problem

`createRun` keeps a second copy of what the user's record already says, and
keeps the two in step by hand. The record is `progress` (each walkthrough's
step, phase and whether it is collapsed) plus the task statuses. Beside it sits
`machine`, the open walkthrough's `State`. That State holds its own copy of the
same step, phase and collapse. So every path that moves a walkthrough has to
remember to copy the State back into progress (`record`). Every path that
closes one has to let go of the machine, carry its step generation on in
`lastGeneration`, and hand its Waymark's position to `sightings` (`release`).
`restored` marks progress that hasn't yet been checked against its definition.
It has five writers that must agree with `progress` and `definitions`. `looked`
says whether the machine has had its first look, and is compared by object
identity. The design doc promised the opposite: which walkthrough is open, and
which beacons show, "are worked out from the progress each time, not stored, so
they can't fall out of step with it." Every hand-kept pair is a place a future
edit can update one side and not the other. The ~25 closure variables let any
concern write any of them.

Constraints carried over: the public `Run` and `RunOptions` stay as they are
(every test goes through them). `rules.ts`, `state.ts` and `input.ts` stay
unchanged. The commit order in the grounding doc is kept. The stored record
stays at version 4.

## Usage (caller's view)

The public surface doesn't change, so the callers that matter are the Run's
own code and the next contributor. A command reads as what it does, and leaves
nothing to keep in step:

```ts
// run.ts
start: (walkthrough) => {
  known(walkthrough); // a clashing definition throws at the call
  later(() => change((c) => begin(c, walkthrough))); // begin writes progress; the machine follows
},
```

The page reads the Model and reports what it sees. It can't write the Model,
because it doesn't import `change.ts`:

```ts
// page.ts, a frame
const machine = machineOf(deps.model()); // the open walkthrough's State, or none
if (machine === undefined) lookAtBeacons(); // → deps.seeBeacons(reads, now)
else sendRead(); // → deps.send(stepRead)
```

A contributor adding "open the walkthrough named in the URL hash" writes one
line. Which walkthrough is open, its machine, the beacons and the checklist
rows all follow from progress:

```ts
change((c) => begin(c, fromHash));
```

The one write that could make the machine disagree with the record is writing
the open walkthrough's progress from anywhere but the machine. `put` refuses
that in development. The open-test assertion
`open[0]?.[0] === openId(run)` ("keeps at most one walkthrough running and
not collapsed") now holds by construction, because `open` is computed from
progress.

## Shape

### The basis

`Model` (model.ts) holds only what can't be worked out from anything else:

- `definitions`: these arrive as code runs, and can't be saved.
- `progress` and `statuses`: the record.
- `storageStatus`.
- `waiting`: app intent, deliberately unsaved.
- `last`: the State of the walkthrough opened most recently.
- `sightings`: where beacons' Waymarks were seen. Tracking integrates over
  time, so it can't be recomputed.
- `startedFrom`: UI history that isn't in the record.
- `tasks`.

Everything else is a pure function of the Model:

| Worked out | From | Why it can't drift |
| --- | --- | --- |
| `openId` | the progress entry running and not collapsed, whose definition is here | There is no second copy. `put` refuses a second open entry in development. |
| `isPending` (was `restored`) | has progress, no definition | Exact because of the one door below. |
| `machineOf` (was `machine`) | `last`, if `last.progress === progress[openId]` | Checked by identity on every read. Any other write to the entry retires it. |
| `epochOf` (was `lastGeneration`) | `last.state.stepGeneration` | It is the value. |
| a beacon's sighting | the stored one if its epoch and step match; else read from `last` if that walkthrough just collapsed; else unsighted | Replaces both the copy made in `release` and the rebuild in `settle`. |
| first look due (was `looked`) | an open machine that is attached, and either `!state.started` or attached in this change | No flag to reset on detach. |
| `Shown` (was `snapshot`, `openShown`, `beaconsShown`) | `show(previous, model)` | A memo, never read back into the Model. |

### One door for definitions

A definition joins the Run only through `meet`, and only inside a change.
`meet` is also the one place restored progress is checked: it drops stale
progress, and an open entry is kept open or set aside as its `dismiss` says.
Entries that arrive for definitions already here (from `load` or `hear`) are
checked in the same change they arrive in. So at the end of every change,
progress is unchecked exactly when its definition hasn't arrived, and
`restored` is unnecessary.

The window this closes matters once `open` is derived. Today `take` adds the
definition at the call and checks it in a later change. In between, an
unchecked restored entry with a definition would count as open. The public
commands still call `known` (the same `canonical` check) at the call, so a
clash throws where it does today.

### The machine is a checked cache

`last` keeps the full `State` that `rules.ts` works on. It still holds a copy
of step, phase and collapse, because `rules.ts` reads them from
`State.snapshot`. But that copy is never synced. `keep` is the only writer of
the open entry, and it writes both together. Any other write to that entry
changes its identity, and the machine stops counting. A walkthrough that is
open without a valid machine gets one at the end of the change (`pickUp`):
it is picked up where progress says, so it sends no `start`. Only
`startFresh` opens a walkthrough that will send `start`. As a result, `open`,
`release`, `record`-as-sync and `begin`'s "restore" branch all disappear.
Retired machines stay in `last`. The next machine continues from their step
generation, and a beacon that has just collapsed takes its Waymark from there.

### A Change is the only writer

`change.ts` keeps the mutable draft private to `createModel`. Every transition
takes a `Change`. That covers `begin`, `request`, `withdraw`, `actOn`,
`resetOne`, `meet`, `meetGroup`, `load`, `hear`, `obey`, `setAttached`,
`seeBeacons`, `settle` and the task commands. A Change carries the change's
own output: `events`, `problems`, `credits`, `attaching` and `scrollTo`. It
also carries its save baseline, `savedFrom`, which `inStorage` moves forward.
The baseline replaces the `persist: false` flag, and it lets `load` and `hear`
each be a single change (behaviour change B1). `run.ts` and `page.ts` read
`Model`. `page.ts` must not import `change.ts`, which is checkable as a fallow
boundary, per boundary-discipline.

### The pipeline (order kept)

`commit` in run.ts runs these steps in order:

1. Open the change.
2. Run the work.
3. `settle`: a waiting request opens, the open walkthrough gets its machine,
   finished tasks are recorded, `startedFrom` is pruned. These were grounding
   steps 3 to 5.
4. `show`, then refresh the checklist views (grounding step 6).
5. `page.afterChange`: scroll, reconcile, first look (grounding step 7).
6. Notify the Run's listeners, then the views' listeners.
7. Save the diff from `savedFrom`, then call `onChange`.
8. Report problems.
9. `onEvent`: the walkthrough events, then the checklist events unless the
   change is `silent`.

### Module map

| File | Owns | Sketch | Implemented (est.) |
| --- | --- | --- | --- |
| `run/model.ts` | the basis types, every derivation, `show`. Pure | 225 | ~250 |
| `run/change.ts` | `Change`, the draft, every transition | 384 | ~340 |
| `run/page.ts` | attachments, measuring, frame, input, aria, Waymark events, first look | 141 | ~250 (56 moved as is) |
| `run/run.ts` | `commit` order, public Run, checklist handles, load/hear plumbing | 240 | ~290 |
| total | | 990 | ~1,100, against 1,007 today |

Lines stay about flat. About 85 lines of keeping-in-step logic go: `release`,
`open`'s record, the `settle` rebuild, `restored` bookkeeping, load's and
hear's second changes, `looked`, the `taskById`/`tasks` and
`views`/`checklists` double writes. Module boundaries come back in, as
`Change`, `Page` and imports. This option wins on state, not lines. Folding
model.ts into change.ts saves about 40 lines, at the cost of the visible
read/write split.

### Red-flag screen

- **Split ownership.** Fixed: the Model has one writer.
- **Hand-synced list.** `tasks` (in the Model) lags `groups` (in run.ts) while
  loading. This is deliberate, and it mirrors definitions.
- **Two ways to do one task.** Opening has two paths: `startFresh` (sends
  `start`) and `pickUp` (doesn't). They share one constructor, and each has
  exactly one meaning.
- **Importable internals.** `Change.draft` is reachable from run.ts. The
  guard is convention plus the page import rule. Making `Change` opaque would
  cost one cast.
- **Pass-through.** `seeBeacons` and `send` in run.ts only add "as a change".

## State inventory

| Today | Fate | From what, or why kept |
| --- | --- | --- |
| `definitions` | Kept | Arrive over time and can't be saved. Now added only by `meet`, in a change. |
| `progress` | Kept | The record. Now the only home of the open walkthrough's step, phase and collapse too. |
| `statuses` | Kept | The record. |
| `restored` | **Derived** | `isPending`: has progress, no definition. |
| `storageStatus` | Kept | The lifecycle of one load. |
| `held` | Kept | Commands waiting for the load. |
| `context` | Kept | App input. Sampled by each change. |
| `waiting` | Kept | App intent, unsaved. |
| `machine` | **Replaced** by `last` | Which walkthrough is open is derived. Its machine is `last` while keyed to the open entry. |
| `lastGeneration` | **Derived** | `epochOf`. |
| `sightings` | Kept, less to do | Tracking is time-integrated. Validity is now derived (epoch and step), and the release copy and settle rebuild are deleted. |
| `startedFrom` | Kept | UI history. It can't go in the v4 record, and it isn't the user's progress. The per-change credit can't hold it, because it must survive collapse and resume. Its prune stays: with no run id in the record, the prune is the one exact bound on how long it lives. |
| `groups` | Kept | Checklists arrive over time. |
| `tasks`, `taskById` | **Merged** into one Map | The same index twice. A Map keeps order. |
| `views`, `checklists` | **Merged** into `handles` | Same key, made together. The views hold listeners. |
| `snapshot`, `openShown`, `beaconsShown` | **Merged** into `shown` | A pure memo. It also carries `seen`, worked out once per change. |
| `events`, `problems`, `credits` | **Moved** into the Change | Output of one change, not Run state. |
| `attachments` | Kept (page) | Renderers registered. |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | Kept (page) | Effect handles. What they should be is derived. |
| `looked` | **Derived** | From `state.started` and `Change.attaching`. |
| `thrownStep`, `thrownErrors` | **Merged** (page) | Which errors have been reported. History. |
| `attachedRuns` | Kept (module) | Counts across Runs, development only. |
| `server`, `serverSnapshot` | Kept | Frozen before the load. |
| `listeners` | Kept | Subscriptions. |
| `State.attached` | Kept: the one copy left | Mirrors `attachments.length > 0`. `rules.ts` needs the attach and detach edges to drop clocks. Written only by `pickUp` and `setAttached`. |

That is 35 pieces of state down to 24. Of the six pairs kept in step by hand
(machine and progress, restored and progress/definitions, sightings and
machine, lastGeneration and machine, looked and machine, tasks and taskById),
none is left. One copy remains, `State.attached`.

## Behaviour changes proposed

- **B1. `load` and `hear` are one change each, not two.** Listeners hear one
  snapshot per load. No snapshot ever shows restored progress as read but not
  yet checked. This is required by checking progress in the change it
  arrives in.
- **B2. Definitions join inside the command's change, not at the call.**
  - (a) A `requestStart` withdrawn while loading no longer reopens its
    restored walkthrough when the record arrives. Today that happens, because
    `take` already added the definition.
  - (b) Suppose restored-open A is met by a held command that runs after a
    held `start(B)`. Today A opens and is then interrupted by B, sending
    `interrupt`. Now A is set aside silently, as its `dismiss` says.
  - (c) In development, a clashing definition handed over while loading or
    from a callback throws from the change, not from the call.
- **B3. An entry heard for a walkthrough already here is checked, as a loaded
  one is.** A stale entry is dropped locally and reported as `recordDropped`.
  The drop isn't saved, so the other tab's entry survives. Today such an
  entry is taken unchecked. If its `stepCount` differs (another tab running
  another release), opening it later can call `stepAt` past the last step.
- **B4. The first look is due whenever the open machine hasn't started, not
  when a flag says so.** This fixes what looks like a latent bug, worth a
  test. While attached, say one handler calls
  `run.start(t); run.act("advance", t)`. Both are queued, so the advance runs
  before the first look. The look then carries the old step
  generation and is dropped, and `looked` stops a second look. The walkthrough
  never starts: no `start` event, and clicks and state checks are ignored on
  every later step. The cost of the fix is that, in a rare ordering, a second
  read is sent.
- **B5. The first look's read and `start` are applied in one change.** No
  callback should see a difference, because the second change only ever set
  `started`, which no snapshot shows. B4 needs this.
- **B6. A step's scroll runs in `afterChange`, after the work, not inside
  `obey`.** It still happens before notify.
- **B7. Withdrawing a request is a change.** Withdrawn from a callback, it
  lands after a request still queued, so the request can't come back after
  being withdrawn.
- **Dropped as code that exists only to keep two copies in step:** `release`,
  the `record` call in `open`, `begin`'s "restore" branch (reachable only when
  the machine and progress disagreed), the sightings rebuild in `settle`, and
  every `restored.add` and `restored.delete`.
- **Preserved deliberately:** `reset` of progress that hasn't been checked
  forgets it without a check and without `recordDropped`. Heard changes are
  not saved.

## Synthesis decision

Filled in by arena.

## Tradeoffs accepted

- We accept that the open walkthrough's State still holds a copy of its step,
  phase and collapse. In exchange, `rules.ts` stays as it is. The copy is
  checked by identity on every read rather than synced.
- We accept that an unexpected write to the open entry costs the user
  transient state, in exchange for never showing a State that disagrees with
  the record. The machine is picked up again, so the gate, timers and element
  reset. `put` refuses such a write in development.
- We accept that definitions join the Run later (inside the change), in
  exchange for `restored` being derivable exactly (B2).
- We accept roughly flat line counts, in exchange for 11 fewer pieces of state
  and a Model only one file can write.
- We accept that `openId` scans progress a few times per change and per
  frame, in exchange for not storing it. N is the walkthroughs one user has
  started. Today `collapsedNow` already scans it on every change.

## Alternatives considered

- **Split State into saved and unsaved halves, so `rules.ts` works on a
  progress entry plus an overlay.** This removes the last copy. It lost
  because every rule would rebuild `Running`, and the pure machine would lose
  "a rule that changes nothing visible leaves the snapshot the same object"
  (state.ts). It would also need a field-by-field memo. That moves complexity
  into the best-tested module and buys no new capability.
- **Make the State the truth for the open walkthrough, and derive
  `progress[open]` from it.** Closing a walkthrough would then have to move its
  entry from the live copy to the stored one. That is `release` again under
  another name.
- **Keep `restored` with one writer (`meet`), and keep `take` at the call.**
  It is a smaller change, but it leaves the window in which an unchecked entry
  with a definition counts as open once `open` is derived.
- **An immutable Model, with transitions that return a new one.** It gives the
  same single-writer guarantee, but threading the Model through nested
  transitions (`begin` → `interrupt` → `startFresh`) doubles every call site.

## Open questions and risks

- **Main risk: the machine is keyed by identity.** A future write to the open
  entry that bypasses `keep` silently restarts the step's transient state in
  production. Is the development-only refusal in `put` enough? Or should
  production drop such a write?
- Are B2 (a) to (c) acceptable? In particular, a definition clash during
  loading would throw from the change, after the load.
- B3: should heard entries for walkthroughs already here be checked and
  dropped locally? Or should the Run keep taking them unchecked?
- B4 rests on reading the code, not on a failing test. Should a test land
  first, so the fix shows?
- Does `run.perf.ts` show the `openId` scans? If it does, memoise `openId` on
  the progress object's identity, which is exact because entries are
  replaced, never changed.

## Next implementation step

Write model.ts's derivations with unit tests that need no DOM. Then write
change.ts's `put`, `keep`, `pickUp` and `meet`, port `begin`, `request` and
`settle` onto them, and run `open.test.ts` and `storage.test.ts` against the
new shape.
