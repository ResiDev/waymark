# Redesigning `run.ts`: the options

## Problem

`run.ts` is 1,007 lines because the checklist controller (687 lines on
`main`) moved into the Run. The Run grew from one walkthrough to every
walkthrough and checklist one user has. The size is mostly that move. The
harm is the shape: one `createRun` closure holds about 25 variables, and any
function in it can write any of them. Six pairs of them are kept in step by
hand. The worst pair is `machine` (the open walkthrough's live state) and
`progress` (the saved record). The design doc promised that which walkthrough
is open would be worked out from progress, never stored. A future edit that
updates one of a pair and not the other breaks the Run without a type error.

`grounding.md` lists every piece of state, who writes it, and the order of
the change pipeline. Each option has its own folder with a RATIONALE.md and
type sketches. Bodies are `not implemented`.

## The four options

| | A: modules by ownership | B: pure reducer | C: derive from the record | D: core plus layers |
| --- | --- | --- | --- | --- |
| Idea | Split the closure into owners (walkthroughs, checklists, storage, page, beacons). `commit` in `run.ts` calls them in order. | One immutable `RunState`, and a pure `commit(model, command) → { model, effects }`. `run.ts` only runs the effects. | Keep only the facts nothing else can give. Which walkthrough is open, `restored`, `lastGeneration` and `looked` are all worked out from progress. | The core knows walkthroughs only. Checklists, page and storage are fixed layers plugged in through five hooks. |
| Files / lines | 8 files, ~1,345 | 7 files, ~1,500 | 4 files, ~1,100 | 9 files, ~1,640 |
| State | Same pieces, each with one owner | Same pieces in one value, each with one writer | 35 → 24, no hand-kept pairs left | Same, with the machine/progress pair still kept by hand |
| Behaviour change | None | None (one `Date.now()` per change) | Seven, B1 to B7 | None |
| Lands | One owner per commit, tests green | All at once | Fixes first, then one large swap | One layer per commit |
| Main risk | The 11-step order is still written by hand | A dropped `Draft` compiles and loses a change | A stray write to the open entry silently resets the step in production | Hook creep, and a 25-member `Host` |
| Judge's score /30 | 23 | 19 | 20 | 17 |

## Recommendation: A, with ideas from B and C

A is the only option that lands one commit at a time with no behaviour
change, and it keeps today's way of thinking about the code. Its
`walkthroughs.ts` ends up holding exactly the state C wants to remove. So C's
derivations become a later refactor inside one file, not a rewrite. The
cross-judge and I picked the same base independently.

Ideas to bring in:

1. **From B, `seat`:** the one function that changes the machine also writes
   its progress entry. The two then agree even mid-change, and A's deferred
   `project` goes.
2. **From C, the first-look fix (B4).** This is a real bug today, reproduced
   on `run-redesign-wip`: a handler that calls `run.start(t)` then
   `run.act("advance", t)` leaves `t` never started. It gets no `start`
   event, and clicks and state checks are ignored from then on. Write the
   failing test first, whichever option is chosen.
3. **From C, B3 and B7, one commit each.** B3: check a heard entry against a
   definition that is already here. Today an entry with another `stepCount`
   is taken unchecked. B7: make withdrawing a request a change.
4. **From C, the merges:** `tasks` and `taskById` into one Map, and `views`
   and `checklists` into one handle map.
5. **From B, `flagsOf`:** silent and persist follow from where a change came
   from, not from what each caller passes.
6. **From D, the pipeline-order test** against fake owners. Also unify
   `Moment` and `Read`, which A and D both ask for.

## Why not the others

- **B** buys a pipeline you can test with no DOM, but it lands all at once.
  It deletes `statuses.ts` and `views.ts` and adds a field to the public
  `ChecklistDefinition`. It also brings a new silent failure: a discarded
  draft.
- **C** removes the most state, but needs seven behaviour changes. One of
  them, B2(c), throws a definition clash from inside a queued change, which
  discards the rest of the queue.
- **D** adds about 600 lines of framework for three fixed layers, and keeps
  the machine/progress drift. Its own fallback is direct composition, which
  is A.

## Open questions

- Does the line count matter on its own, or only the state? A is about a
  third longer than today, spread over files of 50 to 340 lines.
- Should C's derived model follow A later, inside `walkthroughs.ts`, or is
  "one owner, one writer" enough?
- Which of C's behaviour changes do you want, whatever the shape: B3 (check
  heard entries), B4 (first look, a real bug), B7 (withdraw as a change)?
