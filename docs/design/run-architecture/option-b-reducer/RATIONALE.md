# Option B: functional core, imperative shell

## Problem

`createRun` is one closure of about 1,000 lines holding about 25 mutable
variables: the user's record, which walkthrough is open, the waiting
requests, beacon sightings, checklist views, snapshot caches, the
per-change lists of events and problems, and the page watchers. Every helper
can read and write every variable. So a reader can't tell what a function
changes without reading it, and a change made in one helper can be undone by
another that runs later in the same change. The order a change runs in (the
eleven steps of `commit` in the grounding doc) is load-bearing, but it can
only be tested by driving a whole Run against a DOM.

`rules.ts` already solves this for one walkthrough: `apply(state, message)`
returns the next `State` and what happened, and touches nothing. This option
lifts that to the whole Run. Constraints it honours: the public `Run` and
`RunOptions` in `run/types.ts` stay as they are; `rules.ts`, `state.ts`,
`input.ts`, `queue.ts` and the record helpers are reused; the commit order is
kept exactly; the app's own code (a step's `check`, a Task's `isComplete`,
listeners, `onEvent`) can throw or call back into the Run at any time.

Terms used below. A **transition** is a pure function from one state to the
next. The **core** is the transitions and selectors; the **shell** is
`run.ts` and `page.ts`, which hold the one mutable variable and do
everything that touches the outside. An **effect** is something the core asks
the shell to do, as data.

## Usage (caller's view)

The app's view does not change:

```ts
const run = createRun({ storage: "waymark:42", context, onEvent });
run.start(filtersHelp);
const stop = run.attach(() => ({ dialog }), { waymarkPadding: 8 });
```

The core's caller is the shell. Every public command becomes one `Command`,
built inside the queued job so it reads the latest state:

```ts
// run.ts: run.start
const start = take(walkthrough); // an edit: synchronous, throws on a clash in development
later(() => change(() => ({ kind: "start", walkthrough: start })));

// run.ts: one change
const change = (make: () => Command) =>
  queue.run(() => {
    const done = commit(model, make(), { now: Date.now(), attached: page.attached() });
    model = done.model; // every snapshot is in before any effect runs
    for (const effect of done.effects) perform(effect);
  });

// run.ts: setContext. The app's conditions are asked by the shell, before the change
change(() => ({ kind: "context", verdicts: verdicts() }));
```

The payoff is a third caller, tests, which can pin the commit order with no
DOM, no queue and no fake frames:

```ts
const world = { now: 1_000, attached: true };
const model = take(initial("ready"), tour).model;
const { model: next, effects } = commit(model, { kind: "start", walkthrough: tour }, world);
expect(effects.map((effect) => effect.kind)).toEqual(["watch", "look", "notify", "save"]);
expect(next.shown.run.open?.walkthrough).toBe(tour);

// Start B over A: A's interrupt is announced after notify and save.
const over = commit(take(next, hint).model, { kind: "start", walkthrough: hint }, world);
expect(over.effects.filter((e) => e.kind === "announce")).toMatchObject([
  { event: { type: "interrupt", walkthrough: "tour", interruptedBy: "hint" } },
]);
```

## Shape

### Module map

All under `packages/core/src/run/`. Lines are estimates once implemented.

| File | Role | Owns (one writer) | Lines |
| --- | --- | --- | --- |
| `model.ts` | Types: `RunState`, `Model`, `Draft`, `Command`, `Effect`, `World`; Draft helpers (`edit`, `say`, `warn`, `credit`, `scrollTo`) | nothing | ~190 |
| `core.ts` | Entry points: `initial`, `commit` (the pipeline), and four edits (`take`, `join`, `addView`, `withdraw`); `publish` | `known`, `storageStatus`, `shown` | ~250 |
| `schedule.ts` | Which walkthrough is where: `seat`, `open`, `release`, `settle`, `obey`, `interrupt`, `arrive`, `begin`, `request`, `resetOne`, `actOn`, `setAttached`, `sightBeacons`, `firstLook`, `restore`, `hear` | `open`, `record.progress`, `restored`, `waiting`, `lastGeneration`, `sightings` | ~280 |
| `statuses.ts` | Task statuses: `task` (markDone, markTodo, toggle, skip), `startedFrom`, `finish`, `settleConditions`, `takeStatuses` | `record.statuses`, `startedFrom`, credits | ~95 |
| `select.ts` | Pure reads: `selectRun`, `selectChecklist`, `collapsedNow`, `wanted`, `beaconTargets`, `conditionsDue`, `taskWalkthrough` | nothing | ~190 |
| `page.ts` (shell) | Attachments, watchers, frame loop, measuring, the step's check, input, dev warning | its watcher handles | ~240 |
| `run.ts` (shell) | `createRun`: model, queue, hold, listeners, checklist handles, storage I/O, effect interpreter | the `model` variable | ~270 |

About 1,500 lines in seven files, the largest ~280, against 1,120 today
(`run.ts` plus the `views.ts` and `statuses.ts` it uses). The extra is new
vocabulary: the `Command` and `Effect` unions, `perform`, the effect
interpreter and per-file imports. `checklists/statuses.ts` and
`checklists/views.ts` are deleted; `checklists/tasks.ts` returns new records
instead of writing to a mutable one (see `elsewhere.ts`). Tracing a change:
`run.ts` → `core.ts` → `schedule.ts`/`statuses.ts`/`select.ts`, three files.

### The data

- `RunState` is the single source of truth: `known` (definitions, tasks,
  groups), `record` (progress + statuses, the existing `Moment`), `restored`,
  `storageStatus`, `open` (a `Machine`: walkthrough, `State`, `looked`),
  `waiting`, `lastGeneration`, `sightings`, `startedFrom`. All readonly,
  copied on write, and the same object when a transition changes nothing.
- `Model = { state, shown }`. `shown` holds the snapshots last published.
  It sits beside `state`, not inside it, so transitions, which take a `Draft`
  of `RunState`, cannot read it: what was shown decides identity, never
  behaviour.
- `Draft = { state, world, events, problems, credits, scrolls }` is one
  change in progress. Every transition is `(draft, …) => Draft`. What today is
  pushed onto `events`, `problems` and `credits` is carried in the draft and
  read once at the end.
- `World = { now, attached }`: the clock and "a renderer is attached", read
  by the shell once per change. The core never asks the clock or the page.
- `Command` is a closed union, one kind per thing that can change the Run.
  Targets are resolved by the shell when the command is given, as today. The
  silent and persist flags follow from the kind (`flagsOf`, exhaustive).
- `Effect` is an ordered list: `scroll`, `watch`, `look`, `notify`,
  `notifyChecklist`, `save`, `report`, `announce`. The shell runs it in
  order and never reorders.

### A change, start to finish

`commit(model, command, world)` writes the grounding doc's pipeline as one
pure function (see `core.ts`):

1. `before = state.record`; an empty draft (step 1).
2. `perform(draft, command)` (step 2).
3. `settle` (3), then `finish`: `finishTasks` and the `startedFrom` prune (4, 5).
4. `firstLook` decides the first look and marks the machine looked.
5. `publish` works out every snapshot from the previous ones (6).
6. Effects, in order: scrolls; `watch` always (7, reconcile); `look` (7);
   `notify`, then each changed checklist (8); `save` unless not persisted (9);
   `report` each problem (10); `announce` run events, then, unless silent,
   checklist events and `checklistComplete` (11).

The shell assigns `model` before the first effect, so every snapshot is in
before any callback runs, as today.

### Answers to the brief's questions

**What is in RunState, and what stays in the shell.** The rule: RunState holds
everything a transition reads and everything that decides an effect. The
shell holds what is needed to carry an effect out (listener sets, watcher
handles, the attachments' `ui` getters, the adapter), deferred calls (`held`,
each request's `withdrawn` flag), and the inputs only the app's code reads
(`context`). Definitions, which carry functions and JSX, are in RunState as
references: `State` already holds Step objects and Elements. The core may test
them (`checkOf(step) !== undefined`, element identity) but never calls a
function or reads the DOM through them.

**Per-change accumulators.** They are fields of `Draft`, threaded through
every transition and returned. `commit` turns them into `report` and
`announce` effects. `credits` is a `ReadonlyMap` on the draft and reaches
`eventsBetween` as a lookup. Scroll requests from `rules.ts` ride along in
`scrolls` and become the first effects, which is where `scrollIntoView`
runs today relative to every callback.

**Author code that ran mid-transition.** No author code runs inside a
transition any more. Each of today's cases moves to the shell, at the same
point in the order:

- `isComplete` ran inside the work, in `conditions()`. The shell now asks
  each due condition inside the queued job, just before `commit`, and passes
  the answers as `Verdicts`. That is equivalent because conditions read only
  statuses and the context, and the work they followed (`arrive`) never
  changes statuses. A throw is reported at once through `queue.fail`, as
  today, and the verdicts are `undefined`, so nothing is recorded, as
  today.
- The step's `check` ran in `lookOnOpening`, inside commit step 7. It now
  runs in the `look` effect, after `watch` and before `notify`, so it is
  still in step 7. A `run.act` from inside it is queued during a drain. In
  the frame loop it runs at once, before the read goes. The read carries the
  step generation stamped before the check, so a stale read is rejected, as
  today.
- DOM reads (`querySelector`, `getBoundingClientRect`) happen in `page.ts`,
  inside the `make` thunk, and reach the core as `WaymarkRead` values.
- Listeners, `onEvent`, `onChange` and problem handlers are effects, after the
  model is in.

The core cannot be re-entered: `commit` has returned before any effect runs.

**Identity-preserving snapshots without mutable caches.** What was published
is the memory. `selectRun(state, previous)` and `selectChecklist(state,
definition, previous)` hand back `previous`, or its parts, when nothing in
them changed. `publish` stores the results in `Model.shown`. `openShown`
becomes `previous.open`, `beaconsShown` becomes `previous.beacons`, and each
view's mutable `snapshot` becomes an entry of `shown.checklists`. Checklists
are skipped outright when the record, the open walkthrough's id and the
storage status are the objects they were. That is every change the frame loop
makes, which today rebuilds every view each frame.

**Watcher keys.** `wanted(state, attached)` is `rules.liveWatchers` on the
open machine plus "a beacon's step has a Waymark". The `watch` effect carries
it, and the shell's `syncWatcher` opens or closes to match by key equality
(`sameWaymarkAria`, `sameWaymarkEvents`). The keys are values made from the
state (an element plus a flag, an element plus events plus a generation), so
the same state wants equal keys and nothing reopens. It is sent on every
change, so a frame that has just fired is asked for again.

**Loading and held commands.** `storageStatus` is state, and `loaded` in
`core.ts` is its only writer. `held` stays in the shell: a held command is a
deferred call, like the queue's work, and it closes over values from when it
was given (the definition it took, the request's `withdrawn` flag). The core
never sees a held command, only the commands they turn into when they are
replayed. Two things are skipped while the record loads rather than held:
`join`'s arrive and `setContext`'s check. The `arrive: "all"` change that
follows the load covers both, as today. The server snapshot is the `Model`
captured before the load, a value nothing can change.

### State inventory

| Today | Goes to |
| --- | --- |
| `definitions` | `RunState.known.walkthroughs` |
| `progress` | `RunState.record.progress` |
| `statuses` (mutable `Statuses`) | `RunState.record.statuses`, an immutable `Stored`; `checklists/statuses.ts` deleted |
| `restored` | `RunState.restored` |
| `storageStatus` | `RunState.storageStatus` |
| `held` | shell (`run.ts`) |
| `context` | shell (`run.ts`); only the shell calls conditions |
| `waiting` | `RunState.waiting` |
| `machine` | `RunState.open` |
| `lastGeneration` | `RunState.lastGeneration` |
| `sightings` | `RunState.sightings` |
| `startedFrom` | `RunState.startedFrom` |
| `groups` | `RunState.known.groups` |
| `tasks` + `taskById` | one insertion-ordered `RunState.known.tasks` map: order and lookup in one structure |
| `views` | snapshot: `Model.shown.checklists`; listeners: shell handle; server snapshot: shell handle; `View`/`ViewSource`/`sourceFor`/`Seen` deleted |
| `checklists` (handles) | shell (`run.ts`) |
| `snapshot` | `Model.shown.run` |
| `openShown`, `beaconsShown` | deleted: the previous snapshot is the memory |
| `events`, `problems`, `credits` | `Draft` fields, per change, returned |
| `Flags` argument | deleted: derived from the command's kind |
| `attachments` | shell (`page.ts`); enters the core as `World.attached` |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | shell (`page.ts`) handles; their keys derived by `wanted` |
| `looked` | `Machine.looked`, decided in `commit` |
| `thrownStep`, `thrownErrors` | shell (`page.ts`): they filter errors from code the shell ran |
| `attachedRuns` | module WeakMap in `page.ts` |
| `server` (`Seen`), `serverSnapshot` | shell: `server = model` before the load; `Seen` deleted |
| `moment()` | deleted: `state.record` is the moment |
| `Date.now()` calls | `World.now`, once per change |

### Invariants, and where they are held

- Type-level: transitions cannot read `shown` (a `Draft` holds `RunState`
  only). A command's flags cannot be wrong (`flagsOf` is exhaustive over its
  kinds). Every effect kind is handled (exhaustive switch in the shell).
  `conditionsDue` returns Tasks narrowed to have a condition.
- One writer per field (table above). `seat` is the only writer of `open`
  and writes `progress[open.id]` with it, so the two never disagree, even
  mid-change. Today they are kept in step by hand and agree only at the end
  of a change. `release` then needs no `record` of its own.
- By construction: `commit` is deterministic in its inputs. A transition that
  changes nothing returns the same draft, so a frame that sees nothing new
  allocates no state and diffs no record (`after === before` skips
  `changesBetween` and `eventsBetween`).

### Interface depth

The shell changes the model through six functions (`initial`, `commit`,
`take`, `join`, `addView`, `withdraw`) and asks it four questions
(`conditionsDue`, `taskWalkthrough`, `beaconTargets`, `selectChecklist` for
server snapshots). It also reads `model.shown`, `state.open` (to stamp
generations, measure and classify input), `state.storageStatus` (to hold) and
`state.known.groups` (so `join` takes a group's walkthroughs once). Behind
that sits all the scheduling, record merging, task rules and snapshot
identity. A new kind of change is a new `Command` kind, one `perform` case
and its transition. TypeScript points at every place it must be handled.

### What changes in behaviour

Nothing intended. Small differences from the trace:

- One `Date.now()` per change, so every entry a change writes gets the same
  `changedAt`. Today they can differ by a millisecond.
- Progress is written each time the machine changes rather than at `open`
  and `release`. No code reads the open walkthrough's progress between those
  points within a change, so nothing can see the difference.
- A beacon hidden and later shown again with the very same Waymark object gets
  a new, equal object. `settle` rebuilds sightings whenever a walkthrough
  opens, so this is rare, and no test or renderer depends on it.
- Without `onEvent`, checklist events are still worked out and then dropped.
  This only runs when the record changed.

## Synthesis decision

Filled in by arena.

## Tradeoffs accepted

- We accept about 35% more lines (~1,500 against ~1,120) and two new unions
  in exchange for a pipeline order that is one readable, unit-testable
  function, and fields that each have one writer.
- We accept four edits that change the model outside `commit` (`take`,
  `join`, `addView`, `withdraw`). In exchange, a clash still throws at the
  call site and a withdrawal lands at once, as today. Each is
  documented as changing no snapshot already published.
- We accept the shell reading `state.open` directly (page.ts measures and
  classifies input against the machine) in exchange for not wrapping each
  read in a one-line selector.
- We accept copy-on-write allocations in each change (a draft, an effects
  array, `wanted`'s object) in exchange for purity. The frame loop gains
  short-circuits it lacks today (no view rebuilds, no record diff), so we
  expect parity or better. `run.perf.ts` must confirm it.
- We accept that definitions with the app's functions live inside the
  "pure" state as references. Stripping them would split the registry
  between core and shell.

## Alternatives considered

- **Mutable draft inside `commit` (Immer-style `produce`).** It reads like
  today's code and shares structure for free. But it puts a proxy layer on
  the frame path, Elements and Steps would have to be marked non-draftable,
  and the accumulators turn back into arrays pushed mid-change. It hides
  less than it costs.
- **Effects as a fixed record that the shell plays in a fixed sequence**
  (`{ runChanged, viewsChanged, changes, problems, events }`). This makes the
  core simpler, but the load-bearing order then lives in the shell, where it
  can only be tested by driving a Run. That is the problem we started with.
- **A core that suspends to ask the shell** (a generator yielding
  `askConditions` or `measure` and resuming with the answer). It would run
  author code at the exact mid-work point. But it adds machinery for an
  equivalence a trace already shows, and any generator step could be
  re-entered.
- **Derive the open walkthrough from progress, as `run.md` says, with the
  machine's `State` keyed by id.** That is still two sources (the progress
  entry and the transient `State`), synced by hand. A single writer, `seat`,
  gives the same guarantee with one field.

## Open questions and risks

- **Main risk: a discarded draft compiles.** `arrive(draft, w);` as a
  statement silently drops a change, and TypeScript has no "must use".
  Writing transitions as single-expression returns (as `begin` and `actOn`
  do) helps a reviewer see it. Should we add a lint rule against call
  statements whose result is a `Draft`?
- Should `run.ts` and `page.ts` be barred by a lint boundary from importing
  `schedule.ts` and `statuses.ts`? Nothing stops a shell calling a transition
  on a hand-built draft.
- `withdraw` stays a synchronous edit to keep today's behaviour. That keeps
  today's race: a request queued in the same drain as its withdrawal is still
  pushed to `waiting` after it. Should withdraw become a `Command`, which
  fixes the race and changes when it lands?
- Is `ChecklistDefinition.defined` (each row's `DefinedTask`) acceptable on a
  public type that already exposes `group`? Otherwise `selectChecklist`
  searches `group.tasks` for each row.
- Is a new, equal beacon object after a gap acceptable?
- The rewrite moves everything at once. The existing suite guards behaviour,
  but are the pure `commit` tests a replacement for any slow DOM tests, or
  only an addition?

## Next implementation step

Write `model.ts`, then `core.ts`'s `commit` with `schedule.ts` ported from
`run.ts`, and pin the order with pure tests of `commit`'s effect lists for the
grounding doc's flows (start over open, collapse with a waiting request,
reload with restored progress) before swapping the shell in.
