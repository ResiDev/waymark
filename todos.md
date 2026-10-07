Events

## Missing Waymarks
- A collapsed run whose Waymark is lost or missing shows its beacon at the
  bottom centre of the screen. Showing it where the Waymark was lost might read better.
- Maybe later: go back automatically to the nearest earlier click step whose
  Waymark is on the page. Click steps can't advance by themselves, so it can't loop.

## Overlay
- Overlay clicks: make a click on the shade configurable to block, collapse or
  pass through.

## Docs and packaging
- No READMEs yet, for either package or the repo.
- Both packages are at 0.0.0.

## One error channel
- Problems reach an app three ways: `onStorageError` (on a walkthrough's
  definition, or on an owner), `lost` and `missing` as run events, and errors
  thrown when an app callback throws. Make one channel
  whose events are a typed union, with storage failures one member.
- It would also give a home to things that are not errors but an app may want
  to know: a walkthrough record dropped as too old, because its steps changed,
  or because its task is no longer todo. Today these go unreported.

## Maybe later
- Hints: beacons on elements, outside any run. The beacon and location code
  covers most of it.
- Other framework adapters. Core already meets Svelte's store contract.
- Waymarks inside iframes or shadow DOM. Only `root` is searched now.

## Perf tracking (`packages/core/src/run/run.perf.ts`)
- Assert ratios, not absolutes: core's own share of a still frame vs bare gBCR,
  moving frame overhead vs bare transform+gBCR. CI machines are too noisy for ns.
- Also record absolutes to a JSON artifact per run so regressions show as a trend.
- Baseline 2026-09-01 (local Chrome, warm): still 735ns (gBCR 484, innerH/W 121,
  now 95, core ~27); moving 6.8us vs 5.5us bare; real rAF registration 1.6us.
- Cheap wins not yet applied: cache innerHeight/innerWidth on resize; only call
  performance.now() when the condition clock can matter.
