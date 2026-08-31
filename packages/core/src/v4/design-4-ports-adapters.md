# Design 4 — Ports & adapters (the Platform port)

**Constraint given:** put the browser behind an explicit port; the engine becomes pure-ish logic against it; the real browser is one adapter and a deterministic fake is the second — making the seam real by the two-adapter rule. The fake must be a first-class deliverable. Port operations phrased in domain terms, not DOM mirror-calls.

> Base vocabulary (`Action`, `Step`, `Tutorial`, `Run`, the snapshot shape) is as in [design-1-minimal.md](design-1-minimal.md)'s vocabulary section; this design's novel types are the port types below. `RunMsg` is the engine's internal message union (actions + frame reading, as in v3's `Msg`); `Ms` = milliseconds; `Stop = () => void` is a teardown.

## Granularity: one port, not three — the argument

The candidate split is Clock / Targetry / Input. Rejected: the two-adapter rule counts adapters *per seam*, and both real adapters (`browserPlatform`, `fakePlatform`) would implement all three narrow ports — nothing ever varies at Clock independently of Targetry. Three seams × the same two adapters = triple the interface, zero extra leverage. Worse, three ports invite mixed wiring (real DOM + fake clock), which is exactly the incoherent-clocks bug class invariant P6 forbids. If a third adapter ever appears that replaces only one facet (a recorded-session replayer replacing sensing), *that's* the day Clock earns its own seam.

Depth guard: each operation is a **Run need** in domain vocabulary — `sightTarget`, not `querySelector`+`getBoundingClientRect`+`isConnected`; `markTarget`, not `setAttribute`. The fusion into coarser operations is what keeps a wide-ish port deep.

## The port

```ts
export type Rect = { x: number; y: number; width: number; height: number };

export type TargetLocator =
  | { by: "waymark"; name: string }
  | { by: "selector"; selector: string };

/** Opaque token for a located Target. Reference identity IS the contract:
 * same live element ⇒ same handle every sighting; a replacement ⇒ a new handle.
 * The Run keys marks and listeners off it. */
export type TargetHandle = { readonly [brand]: "target" };

export type TargetSighting = {
  handle: TargetHandle;
  rect: Rect | null;              // viewport-relative; null when unmeasurable
  fullyOffScreen: boolean;
};

export type UserInput =
  | { kind: "point"; x: number; y: number }
  | { kind: "key"; key: string };

export type InputVerdict = { msg?: RunMsg; consume?: boolean };

export interface Platform {
  /** One callback per display frame, with the frame clock in ms. */
  frames(onFrame: (now: Ms) => void): Stop;
  /** Locate and measure a Step's Target in one reading. Reuses `prior`
   * while still live; null while absent. Read-only. */
  sightTarget(locator: TargetLocator, prior: TargetHandle | null): TargetSighting | null;
  /** Tell assistive tech this Target has an attached dialog. Stop restores as found. */
  markTarget(handle: TargetHandle): Stop;
  bringIntoView(handle: TargetHandle): void;
  onAdvanceEvent(handle: TargetHandle, events: ReadonlyArray<string>, met: () => void): Stop;
  /** Route page-wide input through the Run's pure interpreter, consuming when told. */
  onUserInput(interpret: (input: UserInput) => InputVerdict): Stop;
  stateConditionMet(handle: TargetHandle | null, check: (el?: Element) => boolean): boolean;
}
```

**Port invariants — nine, binding adapter authors:**

1. **P1 Handle stability.** `sightTarget` returns `prior` (same reference) while the target is still live; new handle only on absent/stale/replaced. Handle identity is the Run's sole change-detection key.
2. **P2 Sighting read-only.** ~60×/s; no mutation, no expensive relayout beyond one measure. `rect` may be fresh objects — the Run value-compares (that's the zero-notify guarantee).
3. **P3 Mark restoration.** `markTarget`'s Stop leaves the Target byte-for-byte as found. The Run guarantees stop-old-before-start-new.
4. **P4 Listener window.** `met` may fire between call and Stop, never after.
5. **P5 Synchronous verdicts.** `interpret` called synchronously during the platform event; `consume` honored before the page's own handlers (capture + preventDefault). Calling it twice per input is a bug.
6. **P6 One coherent clock.** `frames` delivers monotonic `now`; all Run timing computed against it only. A fake must not mix virtual clock with wall time.
7. **P7 No caching of condition checks.** `check` called fresh every time.
8. **P8 Idempotent, exactly-once Stop.** Port calls after last-unsubscribe indicate a Run bug; adapters may assert (the fake does).
9. **P9 Error mode.** Malformed locator throws synchronously from first `sightTarget` (fail fast); a valid locator with no match returns null — the Run's presence logic owns the meaning.

Caller-facing Run surface: five facts (actions + store shape; lifecycle by subscription; notify only on value change; pre-transition callback index; advance no-op while gated). Total learnable v4 surface: 14 items across both seams — and a React user only ever learns the five. Key claim vs v3: same count-ballpark, but *written down*, at a seam with two shipped adapters and a conformance suite, instead of folklore inside one instantiation. The v3 reconciler survives as `makeReconciler` — concrete, private; its eight invariants become implementation facts. "Eight caller-facing invariants converted into zero."

## The engine's impure shell (complete)

```ts
export function createRun<A>(tutorial: RunConfig<A>, platform: Platform): Run {
  let model = initModel(tutorial);
  const listeners = new Set<() => void>();

  const send = (msg: RunMsg) => {
    const prev = model;
    const { model: next, commands = [] } = update(prev, msg, tutorial);
    model = next;
    for (const c of commands)
      if (c.type === "bringIntoView") platform.bringIntoView(c.handle);
    if (next === prev) return;
    reconcile();
    listeners.forEach((l) => l());
    if (isAction(msg.type)) fireCallback(msg.type, prev.step);
  };

  // The whole per-frame sensor: three port calls, one message.
  const onFrame = (now: Ms) => {
    const step = tutorial.getStep(model.step);
    const locator = stepLocator(step);
    const sighting = locator ? platform.sightTarget(locator, model.handle) : null;
    send({
      type: "frame", now,
      handle: sighting?.handle ?? null,
      rect: sighting?.rect ?? null,
      fullyOffScreen: sighting?.fullyOffScreen ?? false,
      conditionMet: step.advanceWhen?.type === "state" &&
        platform.stateConditionMet(sighting?.handle ?? null, step.advanceWhen.check),
    });
  };
  // wanted()/makeReconciler: frames, input, mark (keyed on handle), advance events.
}
```

`interpretInput` — the old window-handler logic — becomes a pure function of `(UserInput, snapshot, step, highlightPadding)`: the click-in-halo / Escape-to-exit logic is plain function tests, no synthesized DOM events.

## The fake platform — first-class deliverable (`waymark-core/testing`)

Not a bag of `vi.fn()`s: a virtual page, a deterministic clock, and a **resource ledger**.

```ts
export type FakePlatform = Platform & {
  page: {
    placeTarget(name: string, rect: Rect): void;
    moveTarget(name: string, rect: Rect): void;
    removeTarget(name: string): void;
  };
  frame(advanceMs?: number): void;      // advance virtual clock, deliver one frame
  click(x: number, y: number): boolean; // returns whether the run consumed it
  key(key: string): void;
  fireTargetEvent(name: string, event: string): void;
  marks(): string[];                    // targets currently marked (P3)
  scrolls: string[];                    // bringIntoView log, in order
  openResources(): string[];            // leak detector: [] after teardown (P8)
  now(): Ms;
};
```

A test — contrast with `rafLoop.test.ts`'s harness (no `scrollIntoView` monkeypatch, no `vi.stubGlobal("requestAnimationFrame")`, no fake timers, no `document.body.innerHTML`):

```ts
it("state condition with delayMs: gate opens, delay honored, silent steady state", () => {
  const p = fakePlatform();
  let saved = false;
  const run = createRun({ getStep: () => ({ waymark: "save", callbackArgs: undefined,
    advanceWhen: { type: "state", check: () => saved, delayMs: 100, gateNext: true } }),
    tutorialCallbacks: {}, highlightPadding: 8 }, p);
  const notify = vi.fn();
  const unsub = run.subscribe(notify);

  p.frame();
  expect(run.getSnapshot().targetStatus).toBe("searching");

  p.page.placeTarget("save", { x: 10, y: 10, width: 80, height: 24 });
  p.frame();
  expect(run.getSnapshot().targetStatus).toBe("found");
  expect(p.marks()).toEqual(["save"]);
  expect(run.getSnapshot().canAdvance).toBe(false);       // gate closed

  notify.mockClear();
  for (let i = 0; i < 60; i++) p.frame(16);               // one silent second
  expect(notify).not.toHaveBeenCalled();

  saved = true;
  p.frame();                                              // condition met → armed
  p.frame(99);
  expect(run.getSnapshot().step).toBe(0);                 // 99 < 100ms
  p.frame(1);
  expect(run.getSnapshot().step).toBe(1);                 // deadline crossed

  unsub();
  expect(p.openResources()).toEqual([]);                  // nothing leaked
});
```

**Conformance suite:** one shared spec runs P1–P9 against both adapters — the fake directly, the browser adapter under jsdom. This is the mechanism that keeps two adapters honest and the fake from drifting into fiction; it's also the only place jsdom still earns its keep.

## What each seam hides

**Behind `Platform`:** selector syntax incl. the `[data-waymark=…]` convention; `isConnected` re-query; `DOMRect` + viewport arithmetic; exact aria names; `scrollIntoView` options; `AbortController` plumbing; capture-phase/consumption mechanics; `performance.now` vs virtual time; jsdom quirks (confined to the conformance suite). Delete the port and all of it re-smears through the engine — passes the deletion test.

**Behind the fake:** the virtual page model, the clock, the ledger — its interface speaks the same domain vocabulary as the port, so a test author never learns a second dialect.

## Trade-offs

**High leverage:** every behaviour test runs with no jsdom, no fake timers, no global stubs (`bench.test.ts` currently hand-stubs rAF and `getBoundingClientRect` — the fake *is* that stub, done once). `openResources()` turns "lifecycle correct by construction" from a claim into a one-line assertion — the exact v2 bug class, cheaply falsifiable everywhere. `interpretInput` pure.

**Thin:** `bringIntoView`/`markTarget` are near pass-throughs (one DOM call behind a renamed operation; the names carry intent, not much else). `stateConditionMet` is the soft spot: the author's `check(el?: Element)` (frozen surface) means the fake passes `undefined` or a stub — a check that genuinely inspects the element can't be exercised by the fake. Documented limitation.

**Future hurts:** port creep toward a DOM mirror (occlusion, IntersectionObserver, popover anchoring — guard: a new op must be a *Run need about a Target*, implementable meaningfully by the fake, with a conformance test, or it stays out); richer input (gestures, focus-trap tabbing) strains the two-variant `UserInput` union and touches both adapters; the hybrid-test wish (real jsdom sensing + fake clock) bites the single-port decision — extraction is mechanical when a third adapter demands it.

**Cost for the single maintainer (named honestly):** "why didn't it scroll" is three hops (run → command → adapter) where v2 was one grep. `TargetHandle` is opaque in a debugger where `el` was inspectable (dev builds should expose the element on the handle). Nine port items to keep true in **two** implementations plus a conformance suite — the tax the two-adapter rule charges. The design's closing argument: for one maintainer, a short contract you can *run* beats a long one you must *remember*.
