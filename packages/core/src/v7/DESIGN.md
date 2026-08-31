# waymark core — design notes

Two functions are the whole public surface: `defineTutorial` turns steps into a
Tutorial, `createRun` executes one. Everything else in this folder is machinery
you should be able to change without telling anyone.

```
types.ts        the vocabulary — the only file a user of the library reads
tutorial.ts     a Tutorial, and its steps with the sugar taken off
state.ts        what a Run knows: the State, and the two ways one is built
outcome.ts      what a decision hands back: a State, announcements, a scroll
transitions.ts  what an Action does — every deliberate move, pure
observe.ts      what one look at the page means — presence, scrolling, the clock
decide.ts       the switchboard: which of the two answers this Input
input.ts        what a click or keystroke means to a Run
resources.ts    a live thing that exists only while its deps say so
run.ts          the driver: the DOM, the loop, and nothing decided
```

## The shape

One `State` holds everything a Run knows. One pure function, `decide`, holds
every rule. The page crosses into it as a `Reading` — plain data, with elements
carried as identity tokens rather than things to read — and crosses back out as
an `Outcome` the driver obeys.

```
              readPage() ─┐                      ┌─ notify subscribers
                          ├→ decide(state, …) ──→├─ announce events
  act / click / key ──────┘                      └─ scroll, listen, mark ARIA
```

`run.ts` enforces no rules of its own. It owns the DOM, the frame loop, the
subscriber set, and the resources — nothing else.

## Where things are decided

Each question has exactly one file that answers it. If you are about to answer
one somewhere else, you have found the bug.

| Question                                         | Answered in    |
| ------------------------------------------------ | -------------- |
| May the user advance? Where does `previous` go?   | transitions.ts |
| What does `advance: "click"` actually mean?       | tutorial.ts    |
| Where is the Waymark? Should we scroll to it?     | observe.ts     |
| Has the Advance condition come due yet?           | observe.ts     |
| Was that click on the Waymark, our UI, or away?   | input.ts       |
| Which of those is being asked?                    | decide.ts      |
| What must be live right now?                      | run.ts         |

## Where the types live

A type lives with the module that owns it; types.ts holds only the public
vocabulary. If a type is not in types.ts, it is internal and free to change.

| Type                                     | Lives in       | What it is                                |
| ---------------------------------------- | -------------- | ----------------------------------------- |
| Step, Tutorial, Action, Location, Snapshot, RunEvent, RunOptions, Run, UiElements | types.ts | the public contract |
| AdvanceRule                              | tutorial.ts    | an AdvanceSpec with the sugar taken off   |
| State, Definition                        | state.ts       | all a Run knows, and all a Tutorial says  |
| Announcement, Outcome                    | outcome.ts     | what a decision hands back                |
| Reading                                  | observe.ts     | one sample of the page                    |
| Input                                    | decide.ts      | everything that can happen to a Run        |
| Resource                                 | resources.ts   | one live thing, and the way to undo it    |

## The four invariants

**A Run's own state is one `State` and nothing else.** Where the Waymark is,
whether the gate is open, whether we have scrolled — all of it is in one
object, so there is no second copy to fall out of step. `console.log(state)`
shows everything.

**Nothing has to remember to clean up.** A State is built from scratch by
`enterStep` or `ended`, so the per-Step scratch — the element, `hasScrolled`,
`dueAt` — cannot outlive its Step. Live things are `Resource`s derived from the
State: give one deps and a way to open it, and changed deps close and reopen
it, `CLOSED` deps close it for good. There is no release ordering to get right,
because there is nothing to release by hand.

**Refusing costs nothing.** Every rule returns the State it was given when it
refuses, so `outcome.state === state` means nothing happened. A still page
produces no new State, no snapshot, no notification.

**Scratch is invisible.** `rendersTheSame` says whether two States produce the
same Snapshot; arming a clock or catching hold of an element does not, so those
frames go by without waking the renderer.

## Two decisions worth knowing about

**A Step that states an Advance condition gates on it.** There is no separate
"gate this step" flag: saying what should happen is saying that it should
happen. `then: "unlock"` is the difference between the condition moving the Run
on and the condition merely letting the user move it on.

**Core does not know what the tutorial looks like.** It knows two elements —
the dialog and the beacon — through the `ui` option, and only so it can tell a
click on the tutorial from a click away from it. Anything else in the page can
opt out of counting as "away" with `data-waymark-ui`. Placement, styling and
markup belong to the adapter (see react-waymark).

## Adding to this

- **A new Action**: add it to `actions` in types.ts and give it a case in
  `applyAction`. The renderer picks it up through `act`; nothing else changes.
- **A new kind of Advance condition**: extend `AdvanceCondition`, normalise it
  in `advanceRule`, and honour it in `observe`. transitions.ts never learns
  of it.
- **A new thing to watch or attach**: add a `Resource` in `syncResources` with
  the State it depends on. Do not start it anywhere else.
- **A new thing the renderer needs to know**: derive it in `buildSnapshot`
  rather than storing it — and if it can change independently, add it to
  `rendersTheSame`.

## Testing

`decide.test.ts` covers every rule with plain objects: no document, no frame
loop, no elements. `run.test.ts` covers the driver — that the loop stops, that
the ARIA attributes come off, that a click in the halo counts. If a new test
needs jsdom to check a *rule*, the rule is in the wrong file.
