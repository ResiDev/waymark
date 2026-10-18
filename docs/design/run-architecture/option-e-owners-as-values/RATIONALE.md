# Option E: A's owners, B's values

## Problem

As in `grounding.md`: one 1,007-line closure holding about 25 variables,
any of which any function can write. Six pairs of them are kept in step by
hand, the worst being the open walkthrough's live `State` and its saved
progress entry. The public `Run` and `RunOptions` stay as they are.

A fixes who may write what, by giving each group of state one owner file. B
fixes how state is written: as values, by pure functions that take a value
and return the next. This option keeps both and drops what made each costly:

- From A, it drops the owners as closures, each holding its own mutable state.
- From B, it drops the `Command` and `Effect` unions and the pure `commit`.
  They are where most of B's extra lines come from, and why B lands only all
  at once.

## Usage (caller's view)

The app's view does not change. Inside, every Run method is a change whose
work takes the state and returns the next:

```ts
// run.ts
start: (walkthrough) => {
  const taken = take(walkthrough); // an edit, at the call: a clash throws here
  later(() => change((s, c) => ({ ...s, walkthroughs: W.start(W.arrive(s.walkthroughs, taken, c), taken, c) })));
},

// A command over two owners composes them in one expression.
skipTask: (id) => later(() => change((s, c) => ({
  ...s,
  checklists: C.skip(s.checklists, id, undefined, c),
  walkthroughs: W.act(s.walkthroughs, walkthroughOf(s, id), "exit", c),
}))),
```

A test can drive the state side of a change with no DOM, queue or frames:

```ts
const [c, gather] = openChange(1_000, true);
const next = settle(start(state, hint, c), state, c);
expect(next.walkthroughs.open?.walkthrough).toBe(hint);
expect(gather().events.map((e) => e.type)).toEqual(["interrupt"]);
```

## Shape

| File | Owns | Kind | Lines (est.) |
| --- | --- | --- | --- |
| `run/walkthroughs.ts` | definitions, progress, restored, open machine, waiting, lastGeneration | pure | 330 |
| `run/checklists.ts` | statuses, tasks, groups, startedFrom | pure | 220 |
| `run/beacons.ts` | sightings | pure | 110 |
| `run/model.ts` | `RunState`, `settle`, `selectRun`, `changesOf` | pure | 140 |
| `run/change.ts` | `Change`, `Source` | types + one maker | 70 |
| `run/page.ts` | attachments, watchers, frame loop, throw dedupe | shell | 230 |
| `run/run.ts` | `let state`, snapshots, queue, listeners, handles, held, context, adapter, `commit` | shell | 280 |

About 1,380 lines against 1,007, about A's size. `checklists/statuses.ts` and
`checklists/views.ts` go, and `checklists/tasks.ts` returns new records instead
of writing a mutable `Statuses`.

Load-bearing decisions:

1. **One value, one owner per field.** `RunState` is
   `{ walkthroughs, checklists, sightings, storageStatus }`. Each field's
   type is defined in its owner's file, and only that file has functions
   that return a new one. `run.ts` holds the one `let state` and assigns it
   once per change. Per single source of truth.
2. **The open machine and its progress cannot disagree.** `seat`, private to
   `walkthroughs.ts`, is the one writer of `open`, and it writes the open
   entry in the same step (B's idea). `record`/`release` syncing goes.
3. **State is returned; announcements are told.** A transition returns its
   owner's next value, and tells the `Change` its events, problems, credits
   and scrolls. Threading those through return values as B does would double
   every signature and make a dropped event as easy to miss as a dropped
   state. The `Change` holds no state, and `commit` reads it once.
4. **The state side of a change is one pure function.** `work`, then
   `settle` (walkthroughs, then beacons, then finished Tasks), then the first
   look. `commit` runs the outside world's side right after, in today's
   order. The order of effects lives in `commit`, as in A, not in a list of
   effect values, as in B.
5. **No author code inside a transition.** Completion conditions are asked
   in `run.ts` just before the change, and their answers come in as
   `Verdicts` (from B). State checks already run in `page.ts`.
6. **Flags follow from where a change came from.** `change(work, "storage")`
   is silent and unsaved, `"arrival"` silent, `"command"` neither (B's
   `flagsOf`). No caller passes `persist: false` by hand.
7. **Identity is the diff.** An unchanged field keeps its object, so
   `before.walkthroughs.progress === after.walkthroughs.progress` means
   nothing to save. When none of the four inputs to checklist snapshots
   changed, which is every frame-loop change, no checklist is looked at.
   Today every view is rebuilt on every change.
8. **Edits outside a change.** `take` (definitions), checklist `join`, and
   `withdraw` change the state between changes, as today. Each changes no
   published snapshot. Kept so a clash still throws at the call.

## Performance

Measured on `run-redesign-wip` with `pnpm test:perf`: a still frame is
2.25 µs, about 1.2 µs of it the Run's own code, against a 16,700 µs frame.
- **A still frame adds no allocation.** `rules.apply` returns the same
  `State`, so every owner returns the same object.
- **A moving frame adds two small objects** (`Walkthroughs`, `RunState`) to
  the new `State` it already makes today.
- **Skipping checklist snapshots on frame-loop changes removes work.**
Re-run the perf suite after each step.

## Synthesis decision

The base is A's ownership map, with each owner turned from a closure into a
value plus pure functions, as B has them. Taken from B: values, `seat`,
`Verdicts`, `flagsOf`, previous-snapshot-as-memory selectors. Taken from C:
merging `tasks`/`taskById` and `views`/`checklists`, and the first-look fix.
Taken from D: a test of the state side of a change with no DOM. Left out:
B's `Command`/`Effect` unions and pure `commit`; C's derived `open`; D's hooks.

## Tradeoffs accepted

- We accept about 370 more lines than today in exchange for one writer per
  field and a state side of a change that tests without a DOM.
- We accept that `interrupt(w, …);` written as a statement compiles and
  drops a change. It can only happen inside an owner file, since `run.ts`
  always assigns. Transitions are written as single-expression returns where
  they can be, and each owner gets tests of its own.
- We accept the order of effects being tested only by driving a Run, as
  today, in exchange for not carrying B's effect list.
- We accept copy-on-write for maps that change rarely (definitions, tasks).

## Alternatives considered

- **A as is, closures with mutable state.** Fewer allocations, but no
  before/after by identity, and no owner can be tested without wiring the
  others.
- **B as is.** Everything testable without a DOM, but a big-bang rewrite and
  ~120 more lines for the effect vocabulary.
- **Each owner a closure holding an immutable value.** Callers can't drop a
  result, but cross-owner commands can't be one expression, and the whole
  change is no longer one value to test.

## Open questions

- Should C's derived `restored` ("progress with no definition yet") follow
  later, inside `walkthroughs.ts`?
- B7, withdraw as a change: `withdraw` stays an edit for now. Should it
  become a change and fix the race?

## Next implementation step

Land the first-look test and fix on its own. Then move the walkthroughs
cluster into a pure `walkthroughs.ts` with `seat`, with `run.ts` holding
`state.walkthroughs`. Run the suite and the perf test before the next owner.
