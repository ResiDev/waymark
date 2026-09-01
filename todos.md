Events
overlay click behaviour
Beacons styling or pass in your own
Pass in dont collapse when target is these
ONly next advance - default
Storing progress - and let user choose, default local storage

Side ones should also check for height
Vertical ones should check for width

Perf tracking as a Playwright test (idea, not started)
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
