---
name: verify-advance-gate
description: Check a change against the TLA+ model of Waymark's advance gate and waymark Location. Use when a change touches packages/core/src/run/rules.ts, walkthroughs.ts, update.ts, page.ts or input.ts, the Gate, StepState or WaymarkState types in packages/core/src/state.ts, the advance helpers in packages/core/src/walkthrough/walkthrough.ts, or anything under packages/core/verification/advance-gate.
---

# Verify the advance gate

## What it promises

The advance gate keeps a step's Next locked until the step's advance condition is met, and opens it while the step's waymark is lost or missing (GLOSSARY.md, "Advance gate" and "Location"). The check holds the code to three rules:

- **NextOnlyWhenEarned.** Next shows as enabled (`canAdvance`) on a step with a condition only once a click, event or state read from this showing met it, or while its waymark is lost or missing. Harm if broken: a user skips a step they were meant to do, for example after a click on an earlier showing.
- **LeavesOnlyWhenEarned.** The walkthrough leaves a step with a condition, on Next or by itself, only on those same terms.
- **NeverStuck.** Once the user, page and app wait, a step whose condition needs a waymark that is not on the page unlocks Next in time. Harm if broken: the user can only exit.

## Run it

From the repository root:

```sh
pnpm verify advance-gate
```

`pnpm verify` alone runs every check under `packages/core/verification`. It needs Java 11 or later and the network on the first run. Vitest's global setup (`verification/tla/setup.ts`) fetches TLC 1.7.4 into `packages/core/node_modules/.cache/tla` and checks its sha256. Two test files then run side by side, in about 40 seconds:

1. `rules.test.ts`: TLC checks the three rules on every step definition that can be met (`MCAdvanceGate.cfg`, about 323,000 states).
2. `conformance.test.ts` runs TLC once for each of 36 pairs of step definitions, dumps the state graph, and walks every edge through the real `update()`. At each state it compares the code's walkthrough progress, `StepState`, `canAdvance`, and its frame, first look, input and waymark-event watchers with the model.

All tests passing means both parts passed.

## The files

All in `packages/core/verification/advance-gate`:

- `AdvanceGate.tla` is the model. Each action is one `Msg` through `update()`, and each rule operator names the code function it copies.
- `MCAdvanceGate.tla` and `MCAdvanceGate.cfg` hold the full check.
- `ConformanceAdvanceGate.tla` holds one pair of step definitions for each conformance run.
- `rules.test.ts` runs the full check.
- `conformance.test.ts` drives the real Run. Its `readStep`, `measure` and `clickOnWaymark` stand in for `page.ts`. They call the real `needsAdvanceRead`, `checkOf`, `whereClicked` and `liveWatchers`.

The plumbing every check shares is in `packages/core/verification/tla`: `setup.ts` fetches TLC, `tlc.ts` runs it and reads its state graph, `values.ts` parses TLA+ values, and `conform.ts` walks a graph on the real code.

## Read a failure

Read every TLC result with the `/statechart` skill. It turns an invariant violation into its shortest path in plain words, and it draws how the gate moves between states when the check passes. Give it `AdvanceGate.tla` with a config of one or two step definitions, because the full model is far over its chart budget.

- **`rules.test.ts` fails.** A rule breaks in the model. If you changed the model, the change is the suspect. If you did not, look at the conformance results too, because the rules check only reads the model.
- **`conformance.test.ts` fails.** It prints the pair of step definitions, the actions from the start in the model's names, and each field where the code and the model differ, such as `canAdvance: the code has true, the model false`.

To tell a bug from a modeling error, replay the printed path against the code by hand. Read the function the model's operator names, such as `rules.ts seeWaymark`, and decide which side is right in the words of GLOSSARY.md.

- If the code breaks the promise, it is a bug. Report it with the path. Do not change the model to match.
- If the code is right and the model was too simple, fix the model. An example from building this check: a click inside a found waymark's kept rect counts as on the waymark (`input.ts` `whereClicked`), and the model first said "away". Then rerun the check. A model fix must not weaken a rule.

## When the change is intended

1. Change `AdvanceGate.tla` to say what the code now does, in the operator that names the code function.
2. Add a variable or action to the model when the code gains one, and give it a case in `act` and `differences` in `conformance.test.ts`.
3. Run `pnpm verify advance-gate` until both test files pass.
4. Break the code once on purpose, for example by deleting the `isGone` half of `canAdvance` in `rules.ts`. Confirm that `conformance.test.ts` fails, then revert.
5. Update the coverage record below. Move the sync commit forward only after you have read every covered function at the new commit and confirmed that the model still describes it.

## Steps the validation rejects

A step with `advance: "click"` or an event condition and no `waymark` or `selector` could never be met. TLC found it stuck with Next locked forever. Commit `96c03c2` fixed it: the `Step` type rules such steps out, and `checkedWalkthrough` in `packages/core/src/walkthrough/walkthrough.ts` throws on them. `MCAdvanceGate.cfg` and the conformance pairs leave them out for that reason. If the validation ever accepts them again, put them back in both and expect `NeverStuck` to break.

## Scope

The model covers one walkthrough of two steps. The first step is any definition the validation accepts. The second waits for a click or an event on its waymark, then unlocks. The model also covers:

- time in 250ms ticks, with lost at 200ms, waiting at 500ms, `missingAfterMs` of 750ms and `delayMs` of 0 or 250ms
- each waymark not in the page, in it with an empty box, or shown
- a state check that flips
- attach and detach, the first look and frames
- Next, Back, collapse and resume, and starting again once finished
- one click or event waiting in the queue, sent from a callback during a drain, that arrives after the step changed

It leaves out:

- storage, and other tabs that move progress
- exit, reset, `dismiss: "exit"`, `requestStart`, checklists, and several walkthroughs interrupting each other
- beacons' own waymark tracking, scrolling, and a waymark that moves or is replaced by a new element
- keyboard activation of the waymark, whose click has no pointer position
- more than two steps, other orderings of the thresholds (such as `missingAfterMs` below 500ms), and longer delays
- time passing while a message waits in the queue

A pass covers this model only.

## Coverage record

Last confirmed that the model describes the code at commit `96c03c2`.

- `packages/core/src/run/rules.ts`: `enter`, `canAdvance`, `advanceStep`, `act` (advance, previous, collapse, resume), `seeWaymark`, `restartUnseen`, `whenDue`, `checked`, `observeAdvance`, `observe`, `look`, `satisfy`, `detach`, `apply`, `needsAdvanceRead`, `liveWatchers`, and the constants `WAITING_AFTER` and `LOST_AFTER`
- `packages/core/src/run/walkthroughs.ts`: `openOf`, `open`, `begin`, `start`, `act`, `obey`, `follow`, `detached`, `settle` (drop of the closed step state)
- `packages/core/src/run/update.ts`: `update` for `start`, `act`, `page`, `attached`, `detached`
- `packages/core/src/run/page.ts`: `readStep`, `measure`, `look`, `openFrame`, `sync`, and the click and waymark-event listeners, mirrored in `conformance.test.ts`
- `packages/core/src/run/input.ts`: `whereClicked`
- `packages/core/src/walkthrough/walkthrough.ts`: `checkedWalkthrough`, `isClick`, `checkOf`, `eventsOf`, `isAuto`, `delayOf`, `hasWaymark`, `selectorOf`
- `packages/core/src/state.ts`: `Gate`, `StepState`, `WaymarkState`, `Message`

To see whether the model needs another look:

```sh
git diff 96c03c2 -- packages/core/src/run/rules.ts packages/core/src/run/walkthroughs.ts packages/core/src/run/update.ts packages/core/src/run/page.ts packages/core/src/run/input.ts packages/core/src/walkthrough/walkthrough.ts packages/core/src/state.ts
```
