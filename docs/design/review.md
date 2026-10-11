# Design review

Status: review of 6065a5f, 9 October 2026. Where a claim rests on running the
code rather than reading it, its section says so.

The question was where the interfaces of `waymark-core` and `react-waymark`
make a caller know something they don't say. An interface here is everything a
caller has to know to use something correctly: its types, and also its side
effects, the order things must happen in, and how it fails.

## Terms

- A **walkthrough** is the list of steps, made by `defineWalkthrough`. A step
  may point at a **waymark**, an element on the page marked with
  `data-waymark`.
- A **Run** is one live play-through of a walkthrough: which step the user is
  on, and whether the tour is collapsed to a beacon. You drive it with `act`,
  read it with `getSnapshot` and hear it change with `subscribe`.
- The **checklist controller**, or controller, is the object `createChecklists`
  returns. It holds the status of every **task**, an item on a checklist such as
  "Invite a teammate", and starts a Run when the user picks a task's
  walkthrough.
- A **renderer** draws a Run: React's `<Walkthrough>`, or an app's own code.
- A tour **shown on its own** is a Run outside any checklist, made by
  `createRun` or by `<Walkthrough walkthrough={…}>`.
- **Problem handlers** are functions an app passes in to hear when something
  goes wrong, such as storage failing or a waymark going missing.

## What to keep

- The Run. Three members hide the waymark's location and its timers, the rule
  that keeps Next disabled until a step's condition is met, scrolling, input and
  storage. Inside, `run/rules.ts` works out
  the next state from the current one and a message, without touching the page,
  and `liveWatchers` decides from the state alone which listeners should exist,
  so the code that opens and closes them can't fall out of step. Tests go
  through `createRun`, which is right.
- `StorageAdapter`. Three members, and core does the parsing, versions and
  migration, so an adapter only moves values. It has real adapters on the other
  side: localStorage, the e2e server, and the test fakes.
- `placement.ts`, `queue.ts`, and the rule that tests go through `index.ts`.

## Summary

| | Problem | Today | Fix |
| --- | --- | --- | --- |
| 1 | Following a Run switches it on | A trap that only React's renderer avoids | One Run: see [run.md](run.md) |
| 2 | A task's renderer talks to the controller three ways | Fine in React; another renderer doesn't get the stop rule | Comes with `attach` |
| 3 | Remembering the user's step is written twice | No bug, but set up for one, and a fix has reached one copy only | One save rule, one restore function |
| 4 | One `Walkthrough` type does two jobs | Costs every option change; has caused one bug | Tasks take steps only |
| 5 | The styled checklist can't be translated | Visible in any app not in English | Build `<Checklist>` from the parts |

## 1. Following a Run switches it on

This is a trap in the Run's interface. React's renderer avoids it; anything
else that follows a Run does not.

Say an app sends each step of a tour to analytics, or shows "Tour: 2 of 5" in
its header, while the tour itself is drawn somewhere else or not at all:

```ts
const run = createRun(onboarding);
run.subscribe((snapshot) => analytics.track(snapshot));
```

`subscribe` is the only way to hear a Run change, and its doc says it calls you
on each change. It also switches the Run on. A Run that is on listens to the
page as if its tour were drawn: to clicks, to tell a click on the waymark from a
click away; to ←, → and Escape; and to where its waymark is, measured every
frame. Call these its page listeners. With nothing drawn, they take the user's
arrow keys, collapse the hidden tour at the first click anywhere and save that,
and tell screen readers the waymark has an open dialog.

Run against this code with one subscriber and nothing drawn, the Run kept
requesting animation frames, set `aria-expanded="true"` and
`aria-haspopup="dialog"` on its waymark, cancelled an ArrowLeft pressed on the
page, and collapsed when the page was clicked.

### Why it is built this way

A Run can't see the screen, so it counts subscribers. The first one switches it
on and the last one leaving switches it off. The code calls this `mounted`, in
`run/run.ts`; despite the name, it means "has a subscriber", not React
mounting. Every page listener checks that one flag, in `liveWatchers`.

For React this is a good fit. `useSyncExternalStore` subscribes when a component
mounts and unsubscribes when it unmounts, so "has a subscriber" means "is drawn"
with no extra code, and Svelte's stores behave the same. The flaw is that
anything else that subscribes looks the same to the Run.

### Who has hit it

The code already works around it in four places:

- `subscribeActive`'s doc warns to use it rather than `subscribe`.
- The controller can't subscribe to the Runs it starts, so it listens to their
  events instead ("Not through `subscribe`" in `checklists/checklists.ts`).
  Problem 3 follows from this.
- The e2e `WatchLog` may only be mounted beside the renderer.
- The plain-JavaScript checklist page carries the same note.

React rarely meets it today. `<Walkthrough walkthrough={…}>` keeps its Run
private, so nothing else can subscribe to it, and React stops a task's Run when
its renderer unmounts (problem 2). A Svelte or plain-JavaScript renderer gets
neither protection, and neither does a React app that follows a task's Run with
`subscribeActive` while no `<Walkthrough checklists={…}>` is mounted.

[walkthrough-button.md](walkthrough-button.md) would make it worse. It counts a
Run as open while it is mounted, running and not collapsed, so a Run that
something only follows would claim the page and push aside the tour the user is
looking at.

### Fix

Split the two jobs. `subscribe` only tells you about changes, and a renderer
calls `attach(ui)` to say "I'm drawing this now", which is what switches the
page listeners on. Analytics calls only `subscribe` and stays out of the page.
[run.md](run.md) has the design, since grown into one Run per user, with its
costs and the alternatives.

## 2. A task's renderer talks to the controller three ways

Nothing breaks in React here. It is a trap for the next renderer.

To draw a task's Run, a renderer gives the controller three things, each by a
different route:

- its dialog and beacon elements, so a click on them isn't a click away,
  through `controller.bindUi(ui)`;
- the waymark padding, which the Run uses to decide what counts as a click on
  the waymark and the renderer uses to draw the shade, which the controller
  hands back from `config.run.waymarkPadding` as `controller.waymarkPadding`;
- word of when it goes away, so the controller stops the task rather than
  leaving it active with nothing on screen. Call this the stop rule.

A tour shown on its own takes its elements by a fourth route, `RunOptions.ui`,
when it is made.

The stop rule exists only in React. `ChecklistGuidance` in
`react/src/Walkthrough.tsx` waits a microtask after it unmounts, and stops the
task unless a renderer has bound again, so that StrictMode's remount and a
handoff between renderers don't count. To tell those apart it keeps its own
record of who holds the controller, a WeakMap of tokens called `holders`, though
`bindUi` already tracks the same thing inside the controller.

A Svelte or plain-JavaScript renderer doesn't get the rule. When it goes away
the task stays active, so the checklist still shows it in progress, and it comes
back mid-tour when a renderer returns. The repo's plain-JavaScript page binds
once and never unbinds. Whichever behaviour is right, it shouldn't depend on the
renderer.

### Fix

It comes with `attach`. A renderer attaches the Run it draws, `bindUi` and
`RunOptions.ui` go, and the controller applies the stop rule itself when the
last renderer detaches. The StrictMode and handoff tests in
`Walkthrough.test.tsx` already pin the behaviour. `controller.waymarkPadding`
could go too, if a renderer reads the padding from the Run it draws.
[run.md](run.md) makes it a prop on the root renderer.

## 3. Remembering the user's step is written twice

Nothing is broken today, but it is set up for a bug, and one fix has already
reached only one of the two copies.

If a user is on step 3 of a tour and reloads the page, Waymark puts them back
on step 3. So every time the tour moves, something has to notice and save its
place: the step, and whether it is collapsed.

A tour shown on its own saves its own place. After every change, `run/run.ts`
compares the place before and after (`sameStored`) and saves if it differs. A
task's tour is saved by the controller, whose record also names the task. The
controller can't watch the Run's state (problem 1), so it waits for the Run's
events, the Run announcing what it just did, and saves when the event's name is
in a list it keeps by hand: `MOVES` in `checklists/checklists.ts`, which holds
advance, previous, reset, collapse and resume.

Today both give the same result. Add a new way to move a tour, say a "jump to
step 5" button, and a tour shown on its own remembers the jump with no extra
work, while a task's tour remembers it only if someone also adds the new event
to `MOVES`. If they forget, a user who jumps to step 5 and reloads lands back on
the old step, and nothing reports it.

Restoring is written twice as well. When either copy loads a saved place it
can't use, because it is too old or was saved when the tour had a different
number of steps, it tells the app's problem handlers and deletes the record.
f0e7943 made the controller delete first, so that a task the app's handler
starts keeps the place it has just saved. The copy in `run/run.ts` (`startFrom`)
still reports first. Run against this code with an unusable record in each, the
standalone handler still saw the record and the controller's saw it deleted. I
could not make the standalone order lose data, since a loading Run holds its
actions until the record is in, but the fix reached one copy only.

### Fix

Once `subscribe` no longer switches a Run on, the controller can watch its Runs'
state, so `sameStored` becomes the one save rule and `MOVES` goes. Restoring
shares one function that deletes before it reports, and the controller adds its
own two checks: the task is unknown, or no longer todo.

## 4. One `Walkthrough` type does two jobs

This costs something on every change to a walkthrough's options, and it has
already caused one bug.

A walkthrough is either shown on its own or a task's. One shown on its own may
have storage and its own problem handlers. A task's must not, because the
controller stores its place and hears its problems. Both are one type,
`Walkthrough`, and the difference is written on top as fields of type `never`,
which TypeScript rejects if they are set:

```ts
export type UnstoredWalkthrough<TStep extends Step = Step> = Walkthrough<TStep> &
  Readonly<{ storage?: never; problemHandlers?: never }>;
```

To return the right one, core declares `defineWalkthrough` three times, once per
kind of options. No options gives a walkthrough tasks accept, problem handlers
alone give one they reject, and storage gives the full standalone walkthrough.
`react/src/definition.ts` declares all three again, and its body branches three
ways only so that TypeScript picks the matching core declaration.
`createChecklists` also throws at runtime, twice, for apps without TypeScript.
Adding or renaming an option means editing six declarations and that branch.

The bug: before 63816bd, `defineWalkthrough(steps, {})` returned a walkthrough
tasks rejected. The fix made `{}` a type error, which no caller would guess.

A task gains nothing from a `Walkthrough` object over a plain array of steps,
since inline steps are already checked where they are written
(`ExactInlineSteps`). The object does bring `reset()` along. Run against this
code, calling `reset()` on a task's walkthrough moved the controller's Run from
step 2 back to step 0, a way to drive a task's Run that the controller's
interface doesn't mention.

### Fix

Tasks take steps only, a small `defineSteps` checks them, and
`defineWalkthrough` makes walkthroughs shown on their own only. That deletes
`UnstoredWalkthrough`, `UnstoredWalkthroughOptions`, two of the three
declarations in each package, the branch in React, both throws and `isSteps`.
Both packages are at 0.0.0, so the break is cheap now and gets expensive once
they are published.

## 5. The styled checklist can't be translated

This is visible today in any app that isn't in English.

An app can translate the walkthrough's popover, through `labels`, and the
unstyled checklist parts, since `ChecklistCheckbox` takes `statusText`. It can't
fully translate the styled `<Checklist>`. Screen readers still hear "To do",
"Done" and "Skipped", the count says "2 of 5 done", and the list is named
"Checklist". `ChecklistLabels` covers only the start, replay and skip buttons.

The cause is that `<Checklist>` doesn't use the parts. Its `DefaultRow` writes
the checkbox again: its role, `aria-checked`, the ids that name and describe it,
and the hidden status text. Translation went into the parts and never reached
the copy, and an accessibility fix to the checkbox has to be made in both.

It can't simply use them. Every part needs `ChecklistRoot`, whose shared state
mixes the popover's (open, hover, pinned, the trigger and panel elements) with
the checklist's (the active task, toggle). `ChecklistTask` and
`ChecklistCheckbox` need only the checklist's.

### Fix

Split `ChecklistRoot`'s state into a provider for the checklist and a popover
root for the rest. `<Checklist>` becomes the provider plus the parts with
default styles, and its text comes from one place.

## Smaller

- The controller's `commit(run, { silent, persist, from })` makes each call site
  say where its change came from by choosing flags. Storage arriving is
  `{ silent: true, persist: false }`; a condition checked after an unreadable
  record is `{ persist: !storedUnread }`. An `origin` of `"user"`, `"storage"`
  or `"condition"` would keep those rules inside `commit`. Nothing is wrong
  here; it is only harder to read than it needs to be.
- Resolved during the review: each module wired problem reporting by hand, and
  ec39c90 gave each controller one reporter.

## Order

1. `attach`, for problems 1 and 2. It fixes the one problem users can meet
   through the core interface and removes the three routes. It should land
   before the walkthrough button, which would otherwise build on `mounted`.
2. One save rule and one restore function, for problem 3. Small once `attach`
   is in.
3. Tasks take steps, for problem 4, before the packages are published.
4. Split `ChecklistRoot`, for problem 5. It stands alone and can happen any
   time.

## How this was checked

Problems 1, 3 and 4 were run against this code in a throwaway test, since
deleted: what a hidden Run does to the page, the order of deleting and reporting
in each restore, and `reset()` on a task's walkthrough. The rest comes from
reading the code.
