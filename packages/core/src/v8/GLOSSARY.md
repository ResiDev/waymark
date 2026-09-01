# Waymark core v8 — glossary

Two halves. The **public** terms are what an application author or a renderer
speaks (all declared in `types.ts`). The **machinery** terms are what the code
inside core speaks; there are eight of them, and no others.

## Public terms

**Tutorial** — An ordered definition of guidance, built by `defineTutorial`.
Runnable more than once. Its only content is `steps`.
_Avoid_: tour, flow.

**Step** — One instruction. May name a Waymark, may state an Advance
condition, and says how to scroll. Carries no content: an adapter extends the
type with whatever it renders.
_Avoid_: screen, stage.

**Waymark** — The element a Step points the user at, marked `data-waymark`
(or reached by `selector`). A Step without one is general guidance.
_Avoid_: target, highlight, selector.

**Run** — One live execution of a Tutorial: `act`, `getSnapshot`, `subscribe`.
It watches the page only while Watched (below).
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

**UI** — The tutorial's own elements (dialog and beacon), which a click on is
not a click away. Any element can opt in with `data-waymark-ui`.

**Action** — One of the six things a Run can be asked to do: `advance`,
`previous`, `collapse`, `resume`, `reset`, `exit`. The Run may refuse.

**Snapshot** — Everything a renderer needs, and nothing about how core found
it out. A new object only when something in it changed, so identity means
"nothing to redraw".

**Run event** — Something the Run did, handed to `onEvent`: `start`, each
Action it took, and `finish`. Named after the Step it happened *on*, with the
Snapshot as it stands *after*.

## Machinery terms

**State** — The whole of what a Run knows: the Snapshot, plus Scratch.
Immutable; only `enter` and `end` build one from nothing. `state.ts`.

**Scratch** — The part of State no renderer sees, all of it about the
current Step: the Waymark `element`, whether a Signal has latched, whether
the once-scroll has happened, and `heldSince`. Entering a Step resets it by
construction, because entering a Step *is* a fresh State.

**Rule** — One of the two pure functions that turn a State into an Outcome:
`act(state, action)` for what the user asked, `observe(state, reading)` for
what the page shows. Every behaviour in Waymark is in one of them. `rules.ts`.

**Reading** — One coherent look at the page, taken by the Driver in a single
frame and handed to `observe` as plain data: the element, its rect, whether
it is in view, how the condition stands, and the time. Elements inside it
are identity tokens, never read from.

**Satisfied** — The user has done what a click or event condition asked. The
page holds no trace of a click, so the Driver reports it on a Reading
(`condition: "satisfied"`) taken on the spot, and it latches into Scratch:
from then on the condition holds for good and never needs meeting again.
A `state` check, by contrast, only ever `"holds"` for the look it was true.

**Outcome** — What a Rule hands back: the next State, the Run events to
announce, and perhaps an element to scroll to. The *same* State by identity
means "nothing happened", which is also how a Rule says "refused".

**Driver** — The impure half, all of it in `run.ts`: read the page, commit an
Outcome, keep the live things in line. It enforces no rules.

**Watched** — A running Run with at least one subscriber. Only then do the
two live things exist: *watching* (the frame loop and the window's clicks and
keys) and the *attachment* to the Waymark (ARIA attributes and the Step's
event listeners). Both are derived from the State after every change, never
started or stopped by hand.

## How one frame flows

1. The frame loop calls `look()`.
2. `readPage` makes a Reading: reuse the cached element if still connected,
   else query for it; measure it; run the Step's check.
3. `observe` works out the Location, whether to scroll, and the condition's
   clock. If nothing changed it returns the very same State.
4. `commit` stores the State, calls `sync` (which usually finds nothing to
   do), and notifies subscribers only if the Snapshot is a new object.

A click on the Waymark is the same flow with the condition `"satisfied"`. A key press or
an `act()` call goes through `act` instead of `observe`, then the same
`commit`.

## The condition clock

There is one clock for every kind of condition. The condition *holds* while
the check says so, or once it has been satisfied. `heldSince` is set when
holding starts and cleared the moment it stops. It is *due* when it has held
for `delayMs`; with no delay, holding is being due. Because a satisfied
condition never stops holding, a click still counts after its delay; because
a check can stop holding, a flickering check starts its delay over.

## What v8 took out of v7

- The `decide` switchboard and the `Input` envelope: two named Rules instead
  of three input kinds, one of which bypassed the switchboard anyway.
- The second condition clock: click and event conditions used to arm the
  clock through a separate path with different disarm rules. Now a click is
  a Reading whose condition is satisfied.
- `buildSnapshot` and `rendersTheSame`: the Snapshot is held in the State,
  so "did the renderer's view change?" is an identity check.
- `Announcement`: a Run event is stamped with the Step index of the State it
  left, which is the same for every event, so a Rule just names the type.
- `Definition` and `AdvanceRule`: a Step is read on the spot through five
  small accessors in `tutorial.ts`, with nothing precomputed or cached.
- The `Resource` / `keepInSync` / deps system and its memo layer: two live
  things, each an open-and-return-close function, compared by hand in `sync`.
- The reused Reading buffer: measured as noise.
