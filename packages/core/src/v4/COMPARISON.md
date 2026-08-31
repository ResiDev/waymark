# v4 design comparison

Four designs, each forced down a different direction:

| | Design | Brief | File |
|---|---|---|---|
| 1 | Minimal | 1–3 seams max, maximize leverage per entry point | [design-1-minimal.md](design-1-minimal.md) |
| 2 | Flexible | serve plausible futures, justify every seam | [design-2-flexible.md](design-2-flexible.md) |
| 3 | Reader-first | readable cold in one file, one concrete clever piece | [design-3-reader-first.md](design-3-reader-first.md) |
| 4 | Ports & adapters | DOM behind a Platform port, fake as second adapter | [design-4-ports-adapters.md](design-4-ports-adapters.md) |

## The unanimous verdict

The strongest finding is what all four did independently, including the one told to maximize flexibility:

1. **Deleted the generic `Program<Model,Msg,Effect>` runtime.** Nobody kept it. Its ~8 invisible invariants for one instantiation failed every design's cost test.
2. **Kept the reconciliation idea** (declare what should be alive; diff it) — but demoted it from public contract to implementation detail.
3. **Split the frame into a pure decision function fed by a data reading.** Every design has some form of `decide(state, reading) → next` with elements as opaque identity tokens, making decision logic testable with object literals.

That triple convergence settles the v4 core. The remaining live questions are narrower:

- **Q1: Does the DOM get a seam?** (4 and 2 say yes — a Host/Platform port with a fake adapter; 1 and 3 say no — the DOM crosses as data, the driver stays ambient.)
- **Q2: Concrete four-slot reconciler or keyed list?** (3: four named slots, four if-blocks, zero generics. 1: a 7-line `Slot`/`sync` helper. 2/4: a keyed `StepResource[]` diff closer to v3's shape, kept private.)
- **Q3: Extension seams now or later?** (2 says now for conditions, honestly-experimental for resources; 1/3/4 say later, and name the tripwire.)

## Depth (leverage at the interface)

Written-down invariant counts, as self-reported:

| | decision seam | lifecycle seam | platform seam | public Run | total |
|---|---|---|---|---|---|
| v3 (baseline) | — | ~8 invisible (Program/Sub) | — | ~4 unwritten | ~17, mostly folklore |
| 1 Minimal | 5 (`decide`) | 0 exported (private slots) | — | 4 | **9** |
| 3 Reader-first | 3 (`transition`/`frameDecision`) | 4 (`resources.sync`) | — | 6 | **13** |
| 2 Flexible | internal | 4 (`StepResource`) | 5 (Host) + 5 (drivers) | 9 | **~23** |
| 4 Ports | internal | 0 (private reconciler) | 9 (Platform) | 5 | **14** |

Raw counts mislead, though: 2's and 4's items are *contracts at real seams with second adapters and (in 4) a conformance suite that executes them* — a short contract you can run beats a long one you must remember. 1's and 3's are fewer because they refuse the seams entirely. The per-line deepest module in any design is `decide`/`frameDecision` (designs 1/3): one function hides the whole decision surface — presence, gates, delays, scroll bookkeeping, the settle-to-same-reference rule — behind 3–5 invariants.

## Locality (where change concentrates)

- **3 wins for a single maintainer**: "what mutates state, and when" is answered by reading `run.ts` linearly — `snap` only in `commit`, resources only via `sync(wanted())`, every caller in the same file. 1 is equivalent (its `dispatch` is the single mutation site).
- **4 trades read-locality for test-locality**: tracing "why didn't it scroll" is three hops instead of one grep, but any lifecycle regression is falsifiable with `expect(p.openResources()).toEqual([])` at the end of any test. It names this cost honestly.
- **2 spreads knowledge across three seams** — a win only when third parties actually write against them; a tax until then.
- New-resource cost: 3 touches three named places (`Wanted`, `Starters`, `wanted()` — compiler-guided); 2/4 push one entry into a keyed list; 1 adds one `sync(...)` call.

## Seam placement (the real disagreement)

Both sides argue from the same rule ("one adapter means a hypothetical seam"):

- **For the platform seam (4, 2):** the fake *is* the second adapter, mandated by the no-DOM-testing constraint; SSR/native hosts ride the same slot for free; the fake platform + ledger produces the best tests any design showed (deterministic clock, virtual page, leak detection, zero global stubs).
- **Against (1, 3):** if `decide` takes a plain `Reading` and treats elements as opaque tokens, the no-DOM testability constraint is **already satisfied without a port** — the fake is then only needed to test the driver, which is ~100 lines of deliberately boring code covered by a handful of jsdom integration tests. Two implementations plus a conformance suite to test 100 boring lines is a poor trade for one person.

Adjudication: **design 1 quietly defeats design 4's justification.** The port's remaining genuine advantages are the test ergonomics (no jsdom anywhere, `bench.test.ts` stops hand-stubbing rAF) and the leak ledger — real, but purchasable at a fraction of the price (see the ledger theft below).

Also worth keeping from the seam debate even if no port is built: 4's argument for **one wide port over three narrow ones** (same two adapters would implement all three; mixed real-DOM/fake-clock wiring is a bug class), and its guard against port creep (a new operation must be a *Run need about a Target*, meaningfully implementable by the fake).

## Distinctive ideas worth keeping regardless of base

- **2: `Progress`/`Sensing` snapshot split.** Serializable runs with zero new API — persistence falls out of the snapshot shape; pause = last unsubscribe, resume = a 4-field JSON object. Costs nothing now.
- **2: condition drivers report, engine owns policy.** Even without the pluggable seam, shaping `decide` so conditions merely signal "met" while the engine owns gate/delay/manual-only policy makes extracting a driver interface later mechanical instead of surgery.
- **4: the resource ledger.** `openResources()` turns "lifecycle correct by construction" from a claim into a one-line assertion — the exact v2 bug class, cheaply falsifiable.
- **1: `Rect` as plain numbers** (not `DOMRect`) and the written reference-equality invariant ("returns `prev` iff nothing observable changed") — the load-bearing rule, deserving its own test.
- **3: the boring concrete reconciler** — proof the reconciliation idea survives with zero type parameters.

## Recommendation

**Base v4 on design 3** (with design 1's `decide`-invariant discipline — the two share a skeleton, which is itself evidence), **plus three thefts:**

1. From **1**: plain-number `Rect` in `Reading`/snapshot; write down and test the `decide` invariants, especially reference-equality-means-no-change.
2. From **2**: the `Progress`/`Sensing` split, and condition handling shaped as report-vs-policy.
3. From **4**: the ledger idea only, miniaturized — the concrete reconciler counts its live slots and exposes a dev-only `__liveResources()`, so every integration test can end with "nothing leaked."

**Explicitly deferred, with tripwires named:**

- No Host/Platform port — revisit when a second real host (SSR, native, replay) appears, not before.
- No public resources/plugin param — revisit at the first concrete third-party consumer.
- No condition-driver seam — but `decide`'s shape makes extracting it mechanical when a second condition kind (route, network) becomes real.

Expected landing: roughly v2's readability with v3's lifecycle correctness, ~9–13 written invariants total, and every future design 2 served still one cheap refactor away instead of prepaid.
