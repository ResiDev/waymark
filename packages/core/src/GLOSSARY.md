# Waymark core — glossary

Two halves. The **public** terms are what an application author or a renderer
speaks (all declared in `types.ts`, and shared with the project's
[CONTEXT.md](../../../CONTEXT.md)). The **machinery** terms are what the
code inside core speaks; there are eleven of them, and no others.

## Public terms

**Walkthrough** — An ordered definition of guidance, built by
`defineWalkthrough`. Runnable more than once. Its only content is `steps`.
_Avoid_: tutorial, tour, flow.

**Step** — One instruction. May name a Waymark, may state an Advance
condition, and says how to scroll. Carries no content: an adapter extends the
type with whatever it renders.
_Avoid_: screen, stage.

**Waymark** — The element a Step points the user at, marked `data-waymark`
(or reached by `selector`). A Step without one is general guidance.
_Avoid_: target, highlight, selector.

**Run** — One live execution of a Walkthrough: `act`, `getSnapshot`,
`subscribe`. It watches the page only while Mounted (below).
_Avoid_: store, instance.

**Location** — Where the Run believes the current Step's Waymark is:
`absent` (the Step has none), `searching` (never seen), `found` (with its
rect) or `lost` (seen, then gone). Once found, never `searching` again.

**Advance condition** — What must happen before the Run may leave a Step:
a `click` on the Waymark, a DOM `event` from it, or a `state` check that must
hold. A `delayMs` says the condition must hold that long, unbroken.
_Avoid_: trigger, auto-advance.

**Advance gate** — Shut while a Step's condition is unmet; `canAdvance` in the
Snapshot. Meeting the condition either moves the Run on (`then: "advance"`,
the default) or only opens the gate (`then: "unlock"`). A Step that states a
condition cannot be skipped past.
_Avoid_: ready, gate-next.

**Collapsed run** — A Run whose popover is hidden behind a beacon while it
stays resumable. Clicking away collapses; `resume` brings it back.
_Avoid_: unfocused.

**UI** — The walkthrough's own elements (dialog and beacon), which a click on
is not a click away. Any element can opt in with `data-waymark-ui`.

**Action** — One of the six things a Run can be asked to do: `advance`,
`previous`, `collapse`, `resume`, `reset`, `exit`. The Run may refuse.

**Snapshot** — Everything a renderer needs, and nothing about how core found
it out. A new object only when something in it changed, so identity means
"nothing to redraw".

**Run event** — Something the Run did, handed to `onEvent`: `start`, each
Action it took, and `finish`. Named after the Step it happened *on*, with the
Snapshot as it stands *after*.

**Checklists** — The owner `createChecklists` returns: it defines Tasks by
id, hands out a named Checklist view per selection, keeps the one shared
completion record, and holds at most one active Run. See checklists.ts.
_Avoid_: onboarding, registry.

**Task** — One thing the user should accomplish. May carry a Walkthrough and
a completion condition `isComplete(context)`; anything else on it is adapter
content that core keeps and ignores.
_Avoid_: item, milestone, step.

**Checklist** — A named, ordered view of Tasks with their shared completion:
`getSnapshot`, `subscribe`, and the commands `start`, `markDone`, `skip`.
Done is the same in every view; skipped is the view's own.
_Avoid_: progress, session.

**Context** — Application data given to `update`, checked once against each
non-done Task's condition. Conditions run only then.
_Avoid_: facts, state.

**Stored** — The persisted record: done ids, and skipped ids per checklist
name. No version field; a storage adapter wraps it.

## Machinery terms

**State** — The whole of what a Run knows: the Snapshot, two facts about the
Run as a whole (`started`, `mounted`), and Scratch. Immutable; only `enter`
and `end` build one from nothing, and both carry the Run-wide facts across.
`state.ts`.

**Scratch** — The part of State about the current Step only, which no
renderer sees: the Waymark `element`, whether a condition has been
Satisfied, whether the once-scroll has happened, and `heldSince`. Entering a
Step resets it by construction, because entering a Step *is* a fresh State.

**Step generation** — The counter `state.stepGeneration`, incremented whenever
`enter` or `end` changes the step, including reset and returning to the same
index. Each read is stamped with it and ignored if it has since changed.

**Rule** — A pure function that turns a State into an Outcome. `act` handles
user actions, `observe` applies a StepRead, `satisfy` records clicks and
events, `start` announces startup, and `mount` handles subscription changes.
`observe` is two smaller rules in order: `observeWaymark` for location and
scrolling, then `observeAdvance` for the condition's clock. `rules.ts`.

**StepRead** — One look at the current Step, taken by the Driver once a
frame and handed to `observe` as plain data. It has two optional halves,
and the Driver includes only what the State needs.

**WaymarkRead** — The measured Waymark element, its rect, and whether it
intersects the viewport. Present when the Step has a Waymark. `observeWaymark`
uses it without reading the DOM or touching the advance condition. Elements
inside it are identity tokens, never read from.

**AdvanceRead** — Whether the state check holds, and the observation time.
Present while advancement is shut and there is a check or a running delay.
The check is run on the element the same look measured. `observeAdvance`
uses it to update the condition's clock and advance or unlock. A satisfied
click or event uses the same half to check its delay, with no predicate or
geometry involved.

**Satisfied** — The user has done what a click or event condition asked. The
page holds no trace of a click, so it arrives as its own Message (`click` or
`event`, with the time), and `satisfy` latches it into Scratch: from then on
the condition holds for good and never needs meeting again. A `state` check,
by contrast, only ever holds for the look it was true. Both share one clock.

**Outcome** — What a Rule hands back: the next State, the Run events to
announce, and perhaps an element to scroll to. The *same* State by identity
means "nothing happened", which is also how a Rule says "refused".

**Message** — Data queued by the Driver: an Action, a StepRead, a click with
what it hit, a Waymark firing one of the Step's events, startup, or the Run
being mounted or unmounted. Reads, clicks and Waymark events carry the Step
generation they happened in. `apply` is the one door: it routes a Message to
its Rule, and it alone knows what a click or an event means to the current
Step. Because a Message is data, a Run is a fold over its Messages, and a
recorded session can be replayed with no DOM.

**Driver** — The impure half, all of it in `run.ts`: take StepReads, turn
frames, clicks, keys and Waymark events into Messages, reconcile the Live
watchers. It decides nothing. It obeys one Message in full (scroll, store,
reconcile, notify, announce) before the next.
A Message sent from inside a notification joins the back of the queue, so
every event of a change carries the Snapshot that change produced. Between
drains the queue is empty.

**Mounted** — A Run with at least one subscriber, recorded in State by the
`mount` Rule. The Driver sends `mounted` when the first subscriber arrives
and `unmounted` when the last leaves; nothing in between. Unmounting closes
every Live watcher and drops a `state` check's clock, since no look can prove
it kept holding in the gap. Progress, the collapsed flag and a Satisfied
condition survive.

**Live watchers** — The four things that exist only while the Run is
Mounted and running: the window's *input* listeners, one animation *frame*
request, the Waymark's ARIA attributes, and the Step's event listeners while
the gate is shut. ARIA attributes and event listeners have separate watchers. `liveWatchers(state)` is the pure
description of which should exist. The Driver stores each as a `Watcher` with the
key it was opened for, and `reconcile` is four calls to `syncWatcher`: same key,
leave it; else close and reopen. Nothing live is ever started or stopped by
hand.

## How a Run starts

1. The first `subscribe` sends `mounted`, then a StepRead of the current
   Step with `start` queued behind it, so `start` precedes anything a
   subscriber does on seeing the first look.
2. `mount` records the Run as Mounted. `reconcile` opens the input
   listeners and, if the Step needs one, requests a frame.
3. The first look only locates: a Run that has not started needs no
   AdvanceRead, so nothing can move the Run on before `start`.
4. `start` records `started` and announces it. Once started it is a no-op,
   so a later subscribe after unmounting sends it again harmlessly.

## How one frame flows

1. The frame fires. The Driver takes a StepRead and sends it.
2. If the Step has a Waymark, `measureWaymark` reuses the cached element if
   it is still connected, inside the root and matching the selector, else
   queries for it; then measures it. If advancement is still shut and there
   is a check or a running delay, the check is run on that element. A
   throwing check counts as false, and its error is thrown once the read
   has been sent, so the next frame is still requested.
3. `apply` drops the read if the Step generation has moved on; otherwise
   `observe` works out the Location and whether to scroll, then the
   condition's clock. If nothing changed it returns the very same State.
4. The Driver stores the State, reconciles (which re-requests the frame if
   the Step still wants one), notifies subscribers only if the Snapshot is a
   new object, and announces the Outcome's events.

A click is a `click` Message carrying what it hit and the Step generation
it happened in; `apply` turns a hit on the Waymark of a click Step into
`satisfy`, and a hit away into `collapse`. A Waymark event is an `event`
Message, likewise. A key press or an `act()` call is an Action Message. Any
of them sent from inside a notification waits its turn in the queue.

## The condition clock

There is one clock for every kind of condition. The condition *holds* while
the check says so, or once it has been satisfied. `heldSince` is set when
holding starts and cleared the moment it stops. It is *due* when it has held
for `delayMs`; with no delay, holding is being due. Because a satisfied
condition never stops holding, a click still counts after its delay; because
a check can stop holding, a flickering check starts its delay over.

## What the Message queue changed

- `Work` (a closure that read the State ambiently) became `Message` (data).
  The queue is now a log, and `apply` the only way through it.
- `started` and the subscriber count left the Driver. Both are facts a Rule
  needs, so both are in State, and `start` and the unmount clock
  reset are Rules rather than Driver bookkeeping.
- `sync`, which compared the live things to the State by hand, became
  `reconcile` against `liveWatchers(state)`, a pure description. Whether a
  frame is wanted, whether to listen for the Step's events, and what
  `aria-expanded` should say are all fields of that description.
- The self-rescheduling frame loop became one frame at a time, requested
  only while the Step has something the next look could change. A Step
  with no Waymark and no shut `state` check costs no frames.
- A click stopped measuring the page on the spot. It is a Message of its
  own, and what it means is decided in `apply`, not in the click handler.
  Only the frame and the first subscribe take StepReads.

## Design choices, and what they replaced

- The `decide` switchboard and the `Input` envelope: two named Rules instead
  of three input kinds, one of which bypassed the switchboard anyway. (The
  Message queue brings an envelope back, but only at the queue boundary,
  where it carries the Step generation and makes a session replayable.)
- The second condition clock: click and event conditions used to arm the
  clock through a separate path with different disarm rules. Now `observeAdvance`
  and `satisfy` share `whenDue`, and `heldSince` is the only clock.
- `buildSnapshot` and `rendersTheSame`: the Snapshot is held in the State,
  so "did the renderer's view change?" is an identity check.
- `Announcement`: a Run event is stamped with the Step index of the State it
  left, which is the same for every event, so a Rule just names the type.
- `Definition` and `AdvanceRule`: a Step is read on the spot through five
  small accessors in `walkthrough.ts`, with nothing precomputed or cached.
- The `Resource` / `keepInSync` / deps system and its memo layer: four live
  watchers described by one pure function and reconciled in one place.
- The reused Reading buffer: measured as noise.
