# Option E: every piece of state

The types are in [state.ts](state.ts), each field with what it is for. That
file typechecks against today's `packages/core/src`. This file says where
state lives, the rule for what goes in `RunState`, and the questions still
open about it.

Nothing in `packages/` has changed. `packages/core/src/run/run.ts` is today's
code; option E's `run.ts` is the sketch in this folder.

## Where state lives

- **`RunState`**: what the Run knows. One immutable value, replaced once per
  change, by `commit` alone.
- **`run.ts`**: what the Run and each checklist last published, held
  commands, context, and the unreadable-record flag.
- **`storage/link.ts`**: the connection to storage. Internal: the app only
  sees `createRun({ storage })` and `run.connect()`.
- **`run/page.ts`**: the DOM. Renderers attached, what core listens to, and
  state-check errors already reported.
- **`queue.ts`**: work waiting to run. Unchanged.
- **The `Change`**: one change's events, problems, credits and scrolls,
  thrown away when it ends.

Today all of it is about 35 variables in one closure, which any of
`run.ts`'s 1,099 lines can write.

## What goes in `RunState`

All three must hold:

1. **It is an input**: the snapshot, the save or a rule's decision is drawn
   from it.
2. **A change needs it before and after**, to see what changed and announce it.
3. **It is plain data**, so comparing by identity means something.

Two things in it break rule 3 a little. `Machine.state.element` and
`Sighting.element` hold the Waymark's DOM element. Each is a cache, reused if
it still matches, compared by identity like everything else.

## Inputs and outputs

`RunState` is the input. `RunSnapshot` is an output: the read-only view a
renderer draws from (storage status, progress, the open walkthrough,
beacons), selected from `RunState`. `run: Published<RunSnapshot>` keeps the
last one, because React must get the same object back while nothing changed.

## Every frame

Each function hands back the object it was given when nothing changed. So
"did anything change?" is `next === before`, one comparison.

- **A still frame** allocates nothing. `commit` asks for the next frame and
  stops.
- **A frame where the Waymark moved** makes the new `State` it makes today,
  plus three small copies: `open`, `walkthroughs` and `RunState`. Nothing is
  saved, and no checklist is looked at.

## Open questions

### `restored`: derive it?

- **What it is:** ids whose progress loaded before their definition arrived.
  It waits until the definition comes, to be checked and drawn.
- **Proposal:** derive it as "has progress, has no definition".
- **Catch:** load restores, then checks, in two changes. They would have to
  become one, which saves only what the check changed.

### `looked`: drop it?

- **What it is:** the open walkthrough has had its first look (measured and
  sent `start` at once) since it opened or the Run attached.
- **Proposal:** drop it. A first look is due while open, attached and not
  `state.started`, or as attached turns true.
- **Gain:** one flag fewer, and it fixes the first-look bug.

### `lastGeneration`: rename it?

- **What it is:** a Run-wide counter of step generations, so a late message
  from a closed walkthrough's step cannot pass for the next one's.
- **Proposal:** call it what it is, `nextStepGeneration`.

### `groups`: move it out of `RunState`?

- **What it is:** which `defineChecklists` groups' Tasks have joined, so
  `join` returns at once after the first time.
- **Proposal:** move it to `run.ts`, beside the checklist handles. Nothing is
  drawn, saved or decided from it.

### `startedFrom`: where does it belong?

- **What it is:** the checklist whose Start opened each running walkthrough,
  so a Skip in the popover credits that checklist.
- **Options:** keep it in `checklists`, move it to `walkthroughs`, or put it
  on progress entries so it survives a reload.

### `sightings`: rename it?

- **What it is:** where each collapsed walkthrough's beacon Waymark was last
  found. It is not the open walkthrough.
- **Proposal:** `beaconWaymarks`.

### `unreadable`: a flag or state?

- **Now:** a report-once flag in `run.ts`.
- **Alternative:** a `RunState` field, "the last record seen was unreadable",
  reported when it flips. No flag, but an unreadable record from another tab
  becomes a change.

### The watchers: merge three?

- **What they are:** `input`, `aria` and `events` all follow the open step.
- **Alternative:** one watcher, rebuilt when the step changes. Fewer names,
  but aria attributes are removed and put back on changes that do not need
  it. Not measured.

### `attachedRuns`: keep the warning?

- Dropping it removes a module-level variable and loses the development
  warning for two Runs on one page.

## Download size

Brotli, React left out, measured from source with `pnpm size`'s settings.

- React, everything: 14.7 KB on main, 16.4 KB on this branch.
- React, walkthroughs only: 13.6 KB on this branch. Main has no `WaymarkRoot`
  to measure this way.
- Core, everything: 8.6 KB on main, 10.2 KB on this branch.
- Core, walkthroughs only: 5.5 KB on main, 9.7 KB on this branch.

Most of the walkthrough-only growth is checklist code, which `createRun` now
imports. Option E as sketched should be about today's size. Winning the
checklist code back needs one seam: `run.ts` does not import
`checklists.ts`, and `defineChecklists` hands its functions over on the first
`run.checklist(definition)`. Not decided.
