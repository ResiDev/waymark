# waymark core — design notes

Two functions are the whole public surface: `defineTutorial` turns steps into a
Tutorial, `createRun` executes one. Everything else in this folder is machinery
you should be able to change without telling anyone.

```
types.ts      the vocabulary — the only file a user of the library reads
tutorial.ts   a Tutorial, and its steps with the sugar taken off
progress.ts   how far a Run has got: every transition, pure, no DOM
locator.ts    finding and following one Step's Waymark, while it is current
condition.ts  whether one Step's Advance condition has been met, while it is current
input.ts      what a click or keystroke means to a Run
run.ts        the only place the other five meet
```

## Where things are decided

Each question has exactly one file that answers it. If you are about to answer
one somewhere else, you have found the bug.

| Question                                        | Answered in  |
| ----------------------------------------------- | ------------ |
| May the user advance? Where does `previous` go?  | progress.ts  |
| What does `advance: "click"` actually mean?      | tutorial.ts  |
| Where is the Waymark?                            | locator.ts   |
| Has the Step's Advance condition been met yet?   | condition.ts |
| Was that click on the Waymark, our UI, or away?  | input.ts     |
| When do any of these get asked?                  | run.ts       |

## Where the types live

A type lives with the module that owns it; types.ts holds only the public
vocabulary. If a type is not in types.ts, it is internal and free to change.

| Type                                        | Lives in     | What it is                                  |
| ------------------------------------------- | ------------ | ------------------------------------------- |
| Step, Tutorial, Action, Location, Snapshot, RunEvent, RunOptions, Run, UiElements | types.ts | the public contract |
| Progress, Gates                             | progress.ts  | the Run's own state, and what gates it      |
| AdvanceRule                                 | tutorial.ts  | an AdvanceSpec with the sugar taken off     |
| Locator (+ its LocatorState)                | locator.ts   | per-Step: follows the Waymark               |
| ConditionTracker (+ its ConditionState)     | condition.ts | per-Step: watches the Advance condition     |
| RunState, Loop                              | run.ts       | what the Run stores, and the frame loop     |

`run.ts` enforces no rules of its own. It owns the frame loop, the subscriber
set, and the order in which the other five are consulted — nothing else.

## The three invariants

**A Run's own state is `Progress` and nothing else.** Four fields: phase, index,
collapsed, conditionMet. The Waymark's `Location` is an observation, kept
beside it; everything a renderer sees — `canAdvance`, the step count, the
snapshot itself — is derived from those two, memoized on their identity, so
there is no copy to fall out of step. Transitions return the *same object* when
they refuse, which is how `run.act` knows whether anything happened.

**The page is observed, never remembered.** The locator finds the Waymark every
frame; the Run keeps only the last `Location`, and compares before notifying,
so a still page produces no notifications. A Step's locator and condition
tracker are started when the Run enters the Step and released when it leaves,
and releasing them undoes everything they did to the page — ARIA attributes,
listeners, the lot. Nothing else in core touches the document.

**Watching costs nothing when nobody is watching.** The frame loop and the two
global listeners exist only while a Run has subscribers *and* is still running.
A finished Run is inert even if its renderer is still mounted.

## Two decisions worth knowing about

**A Step that states an Advance condition gates on it.** There is no separate
"gate this step" flag: saying what should happen is saying that it should
happen. `then: "unlock"` is the difference between the condition moving the
Run on and the condition merely letting the user move it on.

**Core does not know what the tutorial looks like.** It knows two elements — the
dialog and the beacon — through the `ui` option, and only so it can tell a
click on the tutorial from a click away from it. Anything else in the page can
opt out of counting as "away" with `data-waymark-ui`. Placement, styling and
markup belong to the adapter (see react-waymark).

## Adding to this

- A new Action: add it to `actions` in types.ts and give it a case in
  `progress.ts`. The renderer picks it up through `act`; nothing else changes.
- A new kind of Advance condition: extend `AdvanceCondition`, normalise it in
  `advanceRule`, and honour it in `trackCondition`. `progress.ts` and
  `locator.ts` never learn of it.
- A new thing the renderer needs to know: derive it in `buildSnapshot` rather
  than storing it.
