# Option A: modules by ownership

## Problem

`createRun` is one closure of about 1,000 lines holding about 25 pieces of
mutable state, and any function in it can write any of them. Most of it was
moved in from the checklist controller. The public `Run` and `RunOptions` stay
as they are, and every test goes through them. The order of the change
pipeline is load-bearing (grounding, steps 1 to 11). The design doc's one rule
is that at most one walkthrough is running and not collapsed. Today four parts
of the closure can break that rule: `begin`/`interrupt`, `settle`, `arrive`
and `hear`. Three constraints make the split hard:

- `progress` is written from scheduling, from restoring and from hearing
  another tab.
- `statuses` is written from checklist commands, from conditions and from
  storage.
- The per-change accumulators are closure variables that every writer pushes
  to.

## Usage (caller's view)

The app's view doesn't change: `createRun(options)`, `run.start(tour)`,
`run.checklist(onboarding.checklists.main).toggle("invite")`.

The callers that do change are the modules themselves, and the next
contributor. Three call sites set the pattern.

The Run's own method in `run.ts` is wiring only. It takes the definition,
holds while loading, makes a change, and calls the owner:

```ts
start: (walkthrough) => {
  const taken = walkthroughs.take(walkthrough);
  storage.later(() => make((change) => walkthroughs.start(change, taken)));
},
```

A checklist command lives in `run/checklists.ts`, next to the statuses it
writes, and credits through the change:

```ts
toggle: command((change, id) => {
  const task = taskById.get(id);
  if (task === undefined) return;
  if (statuses.status(id) === "todo") statuses.set(id, "done");
  else reopen(task, statuses);
  change.credit(id, name);
}),
```

The page in `page.ts` turns what it sees into a message, sent as a change of
its own. It reads the open walkthrough and never keeps a copy:

```ts
const open = walkthroughs.open();
if (open !== undefined) send({ kind: "click", stepGeneration: open.state.stepGeneration, hit: whereClicked(event, inputContext()), now: performance.now() });
```

## Shape

Eight files under `packages/core/src/run/`. Each file owns one cluster of
state and lists it at its top. A variable that isn't listed there doesn't
belong in that file.

| File | Owns | Lines (est.) |
| --- | --- | --- |
| `walkthroughs.ts` | definitions, progress, restored, the machine, waiting, lastGeneration | 340 |
| `checklists.ts` | statuses, context, task registry, views, made checklists, startedFrom, server Seen | 260 |
| `page.ts` | DOM watchers, `looked`, state-check throw dedupe | 220 |
| `run.ts` | snapshot, serverSnapshot, listeners; `commit`; composition | 175 |
| `storage.ts` | adapter, storageStatus, held | 135 |
| `beacons.ts` | sightings | 100 |
| `change.ts` | nothing (seam types: `Change`, `Flags`, `MakeChange`, `Durable`, `RecordOwners`) | 60 |
| `attachments.ts` | attachments, attachedRuns | 55 |

The total is about 1,345 lines, up from 1,007. The growth is interface types
and doc comments at the seams. No behaviour is added.

Load-bearing decisions:

1. **The one rule has one owner.** `walkthroughs.ts` holds progress together
   with the machine, waiting, restored and definitions. Every writer of
   progress lives in this file, so every way to break "at most one open" is in
   one file. The open walkthrough's entry has exactly one writer, `project`. It
   runs as a walkthrough is let go (`release`) and at the end of each change
   (`settle`). Today `open` also writes the entry; deferring that write is
   safe, because nothing inside a change reads the entry of a walkthrough just
   opened. In development, `put` throws if it is aimed at the open
   walkthrough. Per single source of truth.
2. **`commit` owns the pipeline, and a change is a value.** Only `commit`
   makes a `Change`, through `openChange`, which is private to `run.ts`.
   `commit` hands it to the work, and the work hands it to every write. A
   write that can change what a snapshot shows, or what is saved, takes a
   `Change` parameter, so it can't compile outside a change. Modules can only
   write to a `Change`, not read it. `commit` reads it once, after the
   settling, and closes it; a later write throws in development. The
   `events`/`problems`/`credits` resets and the defensive `announced` copy go.
   Per encode-lessons-in-structure.
3. **Reads are live and narrow.** Each factory types its neighbours as a
   `Pick<>` of their interface, such as
   `walkthroughs: Pick<Walkthroughs, "open" | "obey">` in the page. A module
   reads the owner every time and never caches its state. Giving a module a
   new dependency shows up as a visible diff to the `Pick`. Per minimize
   reader load.
4. **Pipeline steps are owner methods that only `commit` calls**:
   `walkthroughs.settle`, `beacons.settle`, `checklists.settle` and `refresh`,
   `page.sync`, `storage.save`. Each step's logic sits with the state it
   protects, and the order is written down once, in `commit`. The order stays
   a sequence because it is a sequence. Grouping the steps by owner avoids
   temporal decomposition.
5. **The record crosses one seam.** Storage knows the adapter and the stored
   shape, and nothing about what any part means. Each owner implements
   `Durable` (`restore`, `hear`, `check`). `RecordOwners` is a mapped type
   over `Read`'s keys, so if `Read` gains a part with no owner, the build
   fails in `run.ts`. The merge rule for heard progress ("ours if open here or
   newer") stays in `walkthroughs.ts`, beside the rule it protects.
6. **Beacons take what they are handed.** `walkthroughs.settle` returns
   `Left`, which says where the walkthrough that just collapsed last saw its
   Waymark. Beacons don't reach into the machine to get it. Today `interrupt`
   also seeds a sighting, but `settle` always wipes it in the same change, so
   that seeding goes.
7. **Closures, not classes.** Every owner is a factory that returns a
   `Readonly<{…}>`, the way `createQueue`, `createStatuses` and `createView`
   already do. State is unreachable from outside, and methods can be wired
   onto `Run` as values (`attach: page.attach`) without binding `this`.

The two interfaces doing the most work behind the least surface:

- `page.ts` exposes two members, `attach` and `sync`, and hides all the DOM.
- `walkthroughs.ts` exposes 13 members and hides restoring, interrupting, the
  waiting list, step-generation carry-over, `changedAt` stamping and the hear
  merge.

`attachments.ts` is shallow, with four members. It exists only so that
`walkthroughs` can ask "attached?" as a walkthrough opens without forming a
cycle with the page.

What the design deliberately does not do:

- It doesn't change rules.ts, state.ts, input.ts, checklists/*.ts or
  storage/*.ts.
- It doesn't derive the open walkthrough from progress. The machine's State
  holds more than progress can.
- It doesn't make the pipeline generic, such as a list of steps.

### State inventory

| State today | New single owner | Note |
| --- | --- | --- |
| `definitions` | walkthroughs.ts | `take` |
| `progress` | walkthroughs.ts | open walkthrough's entry only via `project`; every other writer is in the same file |
| `restored` | walkthroughs.ts | all four writers (restore, hear, arrive, reset) now in one file |
| `machine` | walkthroughs.ts | handed out read-only as `OpenMachine` |
| `waiting` | walkthroughs.ts | |
| `lastGeneration` | walkthroughs.ts | |
| `statuses` | checklists.ts | |
| `context` | checklists.ts | |
| `groups`, `tasks`, `taskById`, `views`, `checklists` | checklists.ts | `checklists` renamed `made` |
| `startedFrom` | checklists.ts | |
| `server` (Seen) | checklists.ts | taken once by `captureServer` |
| `storageStatus`, `held`, adapter | storage.ts | |
| `sightings` | beacons.ts | seeded from `Left`; `interrupt`'s seeding deleted |
| `attachments`, `attachedRuns` | attachments.ts | |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | page.ts | |
| `looked`, `thrownStep`, `thrownErrors` | page.ts | |
| `snapshot`, `serverSnapshot`, `listeners` | run.ts | |
| `openShown` | deleted | the previous snapshot's `open` is the cache |
| `beaconsShown` | deleted | the previous snapshot's `beacons` is the cache; today's map also grows without bound |
| `events`, `problems`, `credits` | deleted as Run state | a per-change `Change` value |
| `announced` (commit's copy) | deleted | nothing can reset a per-change value |

### Where a change goes

| Adding | Goes in | The build tells you |
| --- | --- | --- |
| A field on a walkthrough's saved progress | `storage/records.ts`, then `entryFor` in walkthroughs.ts, the one place an entry is made from a State | `WalkthroughProgress` literals there stop compiling |
| A new part of the record | `storage/records.ts`, `Moment`, an owner implementing `Durable` | `RecordOwners` and `moment()` in run.ts |
| A checklist command | `TaskCommands`, then `checklistOf` in run/checklists.ts as `command((change, id) => …)`; pure status rules in checklists/tasks.ts | the made `Checklist` literal; its events come from `eventsBetween` with no edit |
| A Run command | `Run` in run/types.ts; wired in run.ts (take, `later`, `make`); policy as a `Change`-taking method on its owner | the returned `Run` literal |
| An event or a problem | `change.event` / `change.problem` in the owner that sees it | no `Change` in hand, no compile |
| A page listener | `liveWatchers` in rules.ts, then `reconcile` in page.ts | — |
| A pipeline step | `commit`, calling a method on the owner whose state it reads, marked "Only `commit` calls it" | — |

## Synthesis decision

To be filled in by arena.

## Tradeoffs accepted

- We accept about 340 more lines in exchange for each piece of state having
  one writer that its file names.
- We accept a `walkthroughs.ts` of 340 lines in exchange for the one rule
  living in one file. Splitting progress from the machine would split the
  rule.
- We accept a `Change` parameter on every write in exchange for the compiler
  refusing a write outside a change.
- We accept a start in two phases, in order in `run.ts`: `takeInitial`, then
  the server snapshot, then `load`. In exchange, storage imports no owner
  and every owner can read whether storage is loading.
- We accept `attachments.ts` as a shallow leaf in exchange for no cycle
  between the page and the walkthroughs. The other way round, telling the
  walkthroughs "attached" only through a message, changes which changes see
  an attach that is still queued.
- We accept that pipeline steps are public methods, guarded by `Pick<>` and a
  doc comment rather than by the type system. In exchange, each step's logic
  sits with its state.

## Alternatives considered

- **The hinted grouping**: a record module (progress, statuses, storage) and a
  stage module (machine, waiting, sightings). It lost because the one rule
  would live in both. Hearing a tab's open walkthrough collapses it in the
  record; `begin`, `interrupt` and `arrive` set walkthroughs aside in the
  stage. The stage would also write progress constantly through the record,
  which is split ownership under another name.
- **An accumulator per module**, drained by the root. It lost because problems
  come from two owners, the walkthroughs and storage, and must stay in the
  order they happened. Its resets would also be kept by hand in three places.
- **Owners that subscribe to each other's changes**, like an event bus. It
  lost because the pipeline's order would come from the order of
  subscriptions, which is invisible. That order is the one thing that must be
  visible.
- **Classes with `#private` fields.** They give the same privacy. They lost
  on consistency with the repo, which has no classes, and on binding `this`
  when methods are wired onto `Run`.

## Open questions and risks

- **Main risk:** the pipeline is still eleven steps written by hand, now
  calling into five owners. Some steps read another owner's state:
  `checklists.settle` reads progress after `walkthroughs.settle`, and
  `assemble` reads every owner. Those steps depend on `commit` calling in the
  right order, and nothing but `commit`'s comments and the tests enforces
  that order. Is that enough, or should the order be encoded, for example by
  having each step return a token the next one needs?
- Is deferring the open walkthrough's entry to `release`/`settle` acceptable?
  I believe no test or listener can see the difference. Inside a change, code
  must read the machine, not the entry.
- `skip` finds the Run's definition through `walkthroughs.take`, which is
  idempotent, instead of a new `definition(id)` read. Is that clear enough?
- `Moment` (`progress`, `statuses`) and `Read` (`walkthroughs`, `tasks`) are
  one record under two sets of names. Should they become one type, so a new
  part is named once?
- Is a growth of about 33% in lines acceptable for this direction?

## Next implementation step

Move the walkthroughs cluster into `walkthroughs.ts` behind `Walkthroughs`,
with `Change` threaded through and `openChange`/`commit` in `run.ts`. Then run
`open.test.ts` and `storage.test.ts`.
