# Option D: a walkthrough core with layers plugged into it

## Problem

`createRun` is one 1,007-line closure that holds about 25 variables. The
walkthrough rules, task statuses, checklist views, DOM watchers and storage
can all read and write all of them. Most of the size came from moving the
checklist controller's state into the Run (see `grounding.md`). Its cost is
that a change to one concern can quietly break another. One case matters
most: the change pipeline (`commit`) has an order that callers depend on.
Tasks finish before snapshots are built, every snapshot is built before any
callback runs, problems are reported after listeners hear, and checklist
events come after walkthrough events. Today that order is kept by hand inside
the closure.

On `main` the split went the other way. The checklist controller owned the
Runs, and it had to rebuild what to save from a hand-kept list of event types
(`MOVES`). `docs/design/run.md` names that list as a bug source: a new kind of
move that one copy saved and the other forgot would lose the user's place.

Constraints:

- The public `Run` and `RunOptions` in `run/types.ts` stay as they are. Every
  test goes through them.
- The pipeline order above is kept exactly.
- The pure modules stay: `rules.ts`, `state.ts`, `input.ts`, `tasks.ts`,
  `views.ts`, `records.ts`, `adapter.ts` and `queue.ts`.
- No layer may be handed a curated list of events in place of the state.

## Usage (caller's view)

There are two callers. The app's code is unchanged:

```ts
const run = createRun({ storage: "waymark:alex", context, onEvent });
run.start(filtersHelp);
run.checklist(onboarding.checklists.main).skip("invite");
```

The second caller is new: the internal code that composes the core and its
layers, and the layers themselves. `createRun` is the only file that knows
every part (`run/run.ts`):

```ts
const core = createCore<Read>({ queue, report, empty: EMPTY_READ, loading, onEvent: options.onEvent });
const checklists = createChecklistLayer(core.host, { context: options.context });
const page = createPageLayer(core.host, { root: () => options.root ?? document });
const persistence = createPersistence(core.host, { adapter, onChange: options.onChange, queue, report });
core.plug({
  layers: [checklists.layer, page.layer, persistence.layer],
  ports: { attached: page.attached, taskOf: checklists.taskOf },
});
```

A layer claims a slice of the record (a named part of the saved record that it
alone writes), then reacts to each change through the record as it was before
and after the change. Here is the checklists layer (`checklists/layer.ts`):

```ts
const statuses = host.slice("tasks", {
  restore: (write, stored) => write.set(statuses, stored),
  hear: (write, heard) => write.set(statuses, heard),
  reconcile: (write) => conditions(write),
});

settle: ({ before, now }, write) =>
  finishTasks(tasks, before.saved, now.saved, statusesIn(statuses, write)),
publish: ({ before, after }) => ({
  notices: refresh(views.values()).changed.map((view) => notice(view.listeners, view.snapshot)),
  events: () => eventsBetween(tasks, before.saved, after.saved, (id) => credited.get(id)),
}),
```

A layer can also give the core commands. Each one goes inside a change, using
that change's `Tx`, so the walkthrough exit and the status write land in the
same change:

```ts
host.later(() => host.change((tx) => {
  statusesIn(statuses, tx).set(id, "skipped");
  host.act(tx, walkthrough, "exit");
}));
```

The persistence layer's save works from the diff alone (`storage/layer.ts`):

```ts
persist: ({ before, after }) => {
  const changes = changesBetween(before.saved, after.saved); // walkthroughs and tasks, one save
  ...
}
```

## Shape

### Module map

Estimated line counts are for the files once filled in. Today `run.ts` plus
`statuses.ts` come to about 1,040 lines.

| File | Knows | ~Lines |
| --- | --- | --- |
| `run/run.ts` | The composition, and the public `Run` façade | 90 |
| `run/layer.ts` | The extension interface: `Layer`, `Host`, `Slice`, `Write`/`Tx`, `Moment`, `Change`, `Ports`, `notice` | 240 (types and docs only) |
| `run/core.ts` | Definitions, progress, unchecked progress, the open machine, waiting requests, beacons' sightings, the record value, the record's status and held commands, the pipeline, the Run snapshot and its listeners | 440 |
| `run/progress.ts` | Pure decisions over progress: `recorded`, `arrival`, `heardEntry`, `mergeHeard`, `collapsedIn`, `nextSightings` | 140 |
| `run/snapshot.ts` | Pure Run snapshot, with its identity cache | 90 |
| `run/page.ts` | The page layer: measuring, state checks, input, frame loop, aria, Waymark events, attachments, the dev warning | 270 |
| `checklists/layer.ts` | The checklists layer: registry, views, `startedFrom`, credits, context and conditions, task commands, the `tasks` slice | 220 |
| `checklists/statuses.ts` | Changed: a change's view of the `tasks` slice | 35 |
| `storage/layer.ts` | The persistence layer: the load protocol, hearing, the save, `onChange` | 115 |

The total is about 1,640 lines, roughly 600 more than today. The interface
file, the host object and the per-file plumbing account for most of that.

Small edits to existing files:

- `records.ts`: `changesBetween(before: Read, after: Read)`,
  `storedRecord(record: Read)`, and a new `EMPTY_READ`.
- `tasks.ts`: `eventsBetween` and `finishTasks` take `Read`, so `tasks.ts`
  drops its own `Moment` type.
- `StorageStatus` moves to `run/types.ts`, so `core.ts` imports nothing from
  `checklists/`. `index.ts` re-exports it from the new place.

### Data structures

- **The record is one immutable value, `saved: Read`, held by the core.** It
  has one key per slice: `walkthroughs` is the core's, `tasks` belongs to the
  checklists layer. Every write replaces the whole value, so identity says
  whether anything changed. `Read` from `records.ts` is the single list of
  what is saved. The core is generic over it (`TRecord extends CoreRecord`),
  so `core.ts` never names `tasks`. The core's own slice cannot be claimed,
  because the slice key type excludes `walkthroughs`. `plug` throws in
  development if a key in `EMPTY_READ` has no owner.
- **`Moment` = `{ saved, open, recordStatus }`.** This is what a layer may
  compare. It replaces today's two shapes: `Moment` (`{statuses, progress}`)
  and `Seen` (that plus `open` and `storageStatus`). Live checklist views read
  `host.moment()`, and server views read `host.server()`.
- **Every write needs a token.** `Write` lets the holder set slices and report
  problems. `Tx` is a `Write` that may also move walkthroughs. The core mints a
  fresh one for each change and kills it once `after` is captured, after which
  using it throws. So no write can fall outside a diff. Today nothing enforces
  this, and a write made outside `commit` would be in no diff, so it would
  never be saved or announced.
- **Everything else is plain closure state in its one owner.** See the
  inventory below.

### The extension interface, exactly

There are two pieces: what a layer gives the core, and what the core gives a
layer (all in `run/layer.ts`).

```ts
type Layer<TRecord> = {
  begin?: () => void;                                          // a change starts: drop per-change scratch
  settle?: (change: Settling<TRecord>, write: Write) => void;  // write what follows to own slices
  publish?: (change: Change<TRecord>) => Publication;          // snapshots up to date; return notices and lazy events
  effect?: () => void;                                         // make the world match, before any listener
  persist?: (change: Change<TRecord>) => void;                 // after listeners, unless the change came from storage
};
type SliceRules<T> = { restore(write, stored: T); hear(write, heard: T); reconcile?(write, after: "restored" | "heard") };
type Ports = { attached(): boolean; taskOf(walkthroughId): string | null };
type Change<TRecord> = { before: Moment<TRecord>; after: Moment<TRecord> };
type Publication = { notices: Notice[]; events?: () => WaymarkEvent[] };
```

`Host<TRecord>` is what the core gives a layer: `change`, `later`, `slice`,
`moment`, `server`, the record operations (`restore`, `hear`, `reconcile`,
`runHeld`), the walkthrough commands (`take`, `definition`, `start`,
`request`, `withdraw`, `act`, `reset`, `arrive`), page reads and writes
(`open`, `collapsed`, `obey`, `sight`, `setAttached`), plus `fail` and
`listen`. Every member that moves state takes the live `Tx`. Each layer
declares a `Pick<Host<Read>, ...>` of the members it uses, which doubles as its
list of dependencies on the core.

Which layer uses each hook:

| Hook | Checklists | Page | Persistence |
| --- | --- | --- | --- |
| `begin` | reset credits | | |
| `settle` | `finishTasks`, prune `startedFrom` | | |
| `publish` | refresh views, then events: `eventsBetween`, then `checklistComplete` | | |
| `effect` | | `reconcile` watchers, `lookOnOpening` | |
| `persist` | | | `changesBetween` → `saveTo`, `onChange` |
| slice rules | `tasks`: restore and hear replace it whole; reconcile checks conditions | | |
| port | `taskOf` | `attached` | |

### How the core, not the layer author, guarantees the order

One function, `commit` in `core.ts`, runs the phases. It is written out in the
sketch because its order is the contract. Each phase calls every layer before
the next phase starts, and no layer calls another layer's hooks.

| Today's step | Where it runs now |
| --- | --- |
| 1. `before`; reset the accumulators | core, then every `begin` |
| 2. the work | the `work(tx)` passed in |
| 3. `settle()` | core |
| 4. `finishTasks`, 5. prune `startedFrom` | every `settle(…, write)`, after the core's |
| 6. Run snapshot, then views | core `build`, then every `publish` |
| 7. `reconcile`, `lookOnOpening` | every `effect` |
| 8. Run listeners, then view listeners | core `queue.notify`, then each publication's notices |
| 9. save and `onChange` | every `persist`, skipped by the core when `persist: false` |
| 10. problems | core |
| 11. run events, then checklist events | core's events, then each publication's `events()`, which the core drops when `silent` |

The types make this hard to get wrong:

- `settle` gets a `Write`, not a `Tx`, so it cannot move a walkthrough after
  the core has settled which one is open.
- `publish`, `effect` and `persist` get no `Write`, so `after` is final once
  it is captured.
- `publish` returns notices and events as data, so a layer has no means to
  notify early: the core delivers them in its own turn.
- `effect` runs before notify, so anything it queues runs ahead of whatever a
  listener queues. This is the "start before anything a subscriber does" rule.
- The core enforces both flags, so a layer cannot forget them.

The pipeline gets a test of its own: a fake layer that records every hook
call, run through `core.test.ts`.

### One atomic save and one diff

Every slice lives inside the core's single `saved` value. `before` and `after`
are taken across all of them at once, with the core's own progress included.
The persistence layer's `persist` sees one `Change`, makes one
`changesBetween`, issues one `adapter.save` and makes one `onChange` call. A
slice's owner decides only how its part takes a record from outside
(`restore`, `hear`, `reconcile`). The core hands out a whole record to every
slice in claim order, with its own slice first. That keeps today's order: on
load the core's arrivals run before the checklists' conditions.

### Why this does not bring back `MOVES`

A `Change` holds only Moments: the record before and after, plus `open` and
`recordStatus`. It carries no events. Checklist events (`eventsBetween`),
finished tasks (`finishTasks`) and the save (`changesBetween`) all come from
the record diff. So a new way for a walkthrough to move needs no edit in any
layer.

The page reconciles to the current state (level-triggered), not to deltas.
There is one per-change input that is not state: the checklists layer's
`credits`, which records the checklist a command came from. It stays inside
that layer, affects only event payloads, and never affects what is saved. The
rules' request to scroll is not in `Change` either: `host.obey` returns it to
the page, which sends the only messages that can produce one, and the page
scrolls inside the same change, as today.

### Fixed, not open

`createRun` composes exactly these three layers, and `Layer` is not exported
from the package. Reasons:

1. The record is a versioned wire format (`version: 4`, with migration from
   v2 and v3 in `parseRecord`). An app-supplied slice would need a format and
   versioning story of its own.
2. Layer order within a phase is part of the contract. Today each phase has at
   most one layer besides the core, which is safe. An open list would need
   priorities.
3. No one has asked for plugins. Because the interface exists, opening it
   later would be a small step, but nothing calls for it now.

### Deviation from the brief: held commands and record status live in the core

The brief placed held commands with persistence. They live in the core, as
`recordStatus` and `held`, for two reasons. `storageStatus` shows in both the
Run snapshot and every checklist snapshot, and both the façade and the
checklists layer wrap their commands in `later`. If persistence owned them,
the core's snapshot and the checklists layer would each depend on a layer. In
the core, every dependency points at the core. Persistence is the only caller
that changes the status, through `host.restore`.

### State inventory

| State today | Goes to | Notes |
| --- | --- | --- |
| `definitions` | core | still written outside a change: nothing compares it |
| `progress` | core, as `saved.walkthroughs` | the core's slice |
| `statuses` | checklists, as `saved.tasks` | the value sits in the core's record; only the layer writes it, through `Write` |
| `restored` | core, as `unchecked` | |
| `storageStatus` | core, as `recordStatus` | written by `host.restore` |
| `held` | core | `later`, `runHeld` |
| `context` | checklists | |
| `waiting` | core | |
| `machine` | core | `host.open()` hands it out; the same object while one walkthrough stays open |
| `lastGeneration` | core | |
| `sightings` | core | the page hands over measurements through `host.sight` |
| `startedFrom` | checklists | |
| `groups`, `tasks`, `taskById`, `views`, `checklists` | checklists | |
| `snapshot`, `openShown`, `beaconsShown` | core; the cache in `snapshot.ts` | |
| `listeners` (Run) | core | view listeners stay on each `View` |
| `server`, `serverSnapshot` | core, as `server` | taken by `freezeServer` |
| `events`, `problems` | core, per change | |
| `credits` | checklists, per change | reset in `begin` |
| `attachments` | page | the source behind the `attached` port |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | page | |
| `looked` | page | reset inside the detach change, as today |
| `thrownStep`, `thrownErrors` | page | |
| `attachedRuns` (module) | page (module) | |
| `adapter` | persistence | |
| new: `layers`, `ports`, the live `Tx` | core | |

### Screened against the red flags

- **Split ownership.** Each slice has one writer. Persistence writes no state
  directly; it calls `host.restore` and `host.hear`. `attached` has one source
  (the attachments), which the core reads through a port.
- **Hand-synced lists.** `Read` lists the slices. `plug` checks that each has
  an owner. The layer list appears once, in `run.ts`.
- **Importable internals.** `core.ts` exports only `createCore`, and the
  package exports none of this.
- **Shallow module.** The `Layer` interface is narrow: five optional hooks plus
  the slice rules. The `Host` is wide, with about 25 members (see Risks).

## Synthesis decision

*Filled in by arena.*

## Tradeoffs accepted

- We accept about 600 more lines and one extra file to read per concern. In
  exchange, `core.ts` never imports a checklist, page or storage module, and
  the pipeline order is written once and tested with fake layers.
- We accept a generic `TRecord` threaded through `Host`, `Layer` and `Moment`
  in exchange for keeping `tasks` out of `core.ts`. It only ever takes one
  type, `Read`.
- We accept that each phase hook has a single user today. The hooks name
  guarantees ("before any listener", "after every write"), not layers. A
  reader might take them for speculative generality.
- We accept two ports (`attached` and `taskOf`) where the core reads a layer.
  The Run snapshot's `open.task` is a public field, and opening a walkthrough
  needs to know whether it is attached. Both are read live, never copied.
- We accept passing a `Tx` to every write in exchange for a guarantee: a write
  outside a change throws instead of silently missing the save.
- We accept that the registries (definitions, tasks, views) still change
  outside changes, as today. Nothing diffs them.

## Alternatives considered

- **Direct composition with no `Layer` interface.** Here `commit` would call
  `checklists.settle()`, `page.reconcile()` and `persistence.save()` by name.
  It is shorter (no `layer.ts`, no hook loops), and the order would still sit
  in one function. It lost because the core would then import every layer's
  types, which is what this direction exists to stop, and the order could not
  be tested without real layers. It is the obvious fallback if the hooks prove
  to be ceremony.
- **The core holds no snapshot: the Run snapshot is a fourth layer.** This
  would remove the `taskOf` port and make the core headless. It lost because
  beacons and the open walkthrough are the core's own concepts. Splitting their
  snapshot from their state would put the identity cache one file away from
  the state it caches.
- **Slices as separate cells, each held by its owner, captured by handle.**
  This would avoid the generic `TRecord`. It lost because `before` and `after`
  would stop being plain `Read` values. Then `changesBetween`, `eventsBetween`
  and `finishTasks` could not take them as they are, and "one record" would be
  a capture loop, not a value.

## Open questions and risks

- **Hook creep (the main risk).** The next layer need with a new timing could
  add a sixth hook, then a seventh, until the interface is a lifecycle
  framework. Should adding a hook require a matching row in the pipeline test,
  so every new timing is argued for in one place?
- **The `Host` is wide.** Its 25 members are mostly the walkthrough commands
  the façade needs too. Is a `Pick` per layer enough of a fence, or should the
  core hand each layer only its `Pick`, typed at `plug`?
- **Held commands moved to the core**, against the brief. Is that the right
  owner, given that the status shows in both snapshots?
- **The drift from the design doc stays.** `machine` is stored beside
  progress and kept in step by `record` and `release`; it is not worked out
  from progress. This option confines the drift to `core.ts` but does not fix
  it. Should the core derive `open` from progress, with the machine keyed by
  id?
- **`silent` still lets the core's own run events through.** This matches
  today's behaviour. Silent changes produce none today, so silencing
  everything would be simpler. Is that worth a behaviour change on paper?

## Next implementation step

1. Write `core.test.ts`'s ordering test against a fake layer that records
   every hook call.
2. Move `run.ts`'s walkthrough operations into `core.ts` unchanged, and its
   progress decisions into `progress.ts`, keeping `run.test.ts` green.
3. Split out the persistence layer, then checklists, then the page, one at a
   time, running the full suite after each.
