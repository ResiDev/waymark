Events

## DONE Missing Waymarks: what's left
A lost Waymark, or one searched for 500ms without being found (`missing`), shows
the step centred with a note, and Next unlocks. Left to do:
- The 500ms searching grace is shorter than a slow page load. With the lab's
  slow decks page (1.5s), step 2 shows the "Can't find" note for 1s before the
  page arrives. Lengthen it, make it a run option, or both.
- A collapsed run whose Waymark is lost or missing shows its beacon at the
  bottom centre of the screen. Showing it where the Waymark was lost might read better.
- The note's text is hard-coded; it belongs with the popover labels below.
- Maybe later: go back automatically to the nearest earlier click step whose
  Waymark is on the page. Click steps can't advance by themselves, so it can't loop.

## Storage: async, the active run, standalone walkthroughs
- Designed in `docs/design/storage.md`. Settle its open questions, then build.

## Popover labels
- "Next", "Finish", "Previous" and "Skip task" are hard-coded in `view.tsx`. Add
  `labels` like the checklist has, so the default popover can be translated.

## Beacon and overlay
- Beacon styling, or let the app pass in its own beacon.
- Overlay clicks: make a click on the shade configurable to block, collapse or
  pass through.

## Placement
- Side placements should also check for height.
- Vertical placements should check for width.

## Docs and packaging
- No READMEs yet, for either package or the repo.
- Rename core from `waymark` to `waymark-core` before publishing. The bare name
  on npm is taken.
- Both packages are at 0.0.0.

## Maybe later
- Hints: beacons on elements, outside any run. The beacon and location code
  covers most of it.
- Other framework adapters. Core already meets Svelte's store contract.
- Waymarks inside iframes or shadow DOM. Only `root` is searched now.

## Perf tracking as a Playwright test (idea, not started)
- e2e/ is empty; add Playwright there, one spec that serves a page with real layout
  (a few thousand rows) and a data-waymark target, imports an esbuild bundle of core.
- Stub requestAnimationFrame in the page to capture the frame callback, warm 50k
  iterations, time 500k with one performance.now() pair around the loop (see
  scratchpad bench.html / prims.html from the 2026-09-01 session for the shape).
- Measure per frame: still, moving (transform), dirty layout; and the primitives
  alone (gBCR, innerHeight/Width, performance.now, real rAF) in the same page.
- Assert ratios, not absolutes: core's own share of a still frame vs bare gBCR,
  moving frame overhead vs bare transform+gBCR. CI machines are too noisy for ns.
- Also record absolutes to a JSON artifact per run so regressions show as a trend.
- Baseline 2026-09-01 (local Chrome, warm): still 735ns (gBCR 484, innerH/W 121,
  now 95, core ~27); moving 6.8us vs 5.5us bare; real rAF registration 1.6us.
- Cheap wins not yet applied: cache innerHeight/innerWidth on resize; only call
  performance.now() when the condition clock can matter.
