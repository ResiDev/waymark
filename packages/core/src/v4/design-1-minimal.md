# Design 1 — Minimal interface

**Constraint given:** minimize internal seams (1–3 max), maximize leverage per entry point, kill every speculative generic. Visible mutation is fine if it shrinks what a maintainer must learn.

## Shape

```
public seam ──► Run (6 actions + subscribe/getSnapshot)     [frozen]
                  │
              run.ts        impure driver: senses the DOM, owns 4 resource
                  │         slots, mutates `state` in one place
                  ▼
internal seam ─► decide(prev, input, tutorial): Outcome     [pure, DOM-free]
```

Two seams total. The DOM gets **no adapter seam** — it crosses into the core as data (a `Reading` record). `decide` holds `Element` values purely as identity tokens and never dereferences one.

## The vocabulary (every type the two seams mention)

```ts
export const actions = ["advance", "prev", "focus", "unfocus", "reset", "exit"] as const;
export type Action = (typeof actions)[number];

export type AdvanceCondition =
  | { type: "click" }
  | { type: "state"; check: (el?: Element) => boolean }   // evaluated by the sensor, not decide
  | { type: "event"; event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> };

export type Step = {
  advanceWhen?: AdvanceCondition & {
    disableAutoAdvance?: boolean;  // condition unlocks the gate but does not move the run
    gateNext?: boolean;            // advance gate: manual advance locked until condition met
    delayMs?: number;              // condition must hold this long before advancing
  };
  scrollIntoView?: "always" | "once" | "never";           // default "once"
  callbacks?: Partial<Record<`on${Capitalize<Action>}`, RunCallback>>;
  callbackArgs: unknown;           // adapter-owned payload; the core stays generic-free
} & ({ waymark: string; selector?: never }                // target by data-waymark
   | { waymark?: never; selector: string }                // target by CSS selector
   | { waymark?: never; selector?: never });              // untargeted step

export type Tutorial = { getStep: (i: number) => Step };

/** What React sees through getSnapshot. Field names frozen with the public surface. */
export type RunSnapshot = {
  step: number;
  active: boolean;
  focused: boolean;                 // false = collapsed run (beacon showing)
  canAdvance: boolean;              // advance gate open?
  highlightTargetStatus: "searching" | "found" | "lost";
  highlightedElementRect: Rect | null;
};

/** Snapshot plus per-step scratch. decide resets the scratch on every step change. */
export type RunState = RunSnapshot & {
  el: Element | null;               // cached target — identity token only, never dereferenced
  scrolledOnce: boolean;
  conditionMetAt: number | undefined;  // clock deadline once the advance condition passes
};

export type RunConfig = {
  tutorial: Tutorial;
  root: Document | Element;
  callbacks: Partial<Record<`on${Capitalize<Action>}`, RunCallback>>;  // run-level
  highlightPadding: number;         // halo in px; clicks inside it count as target clicks
};

export type Run = { [A in Action]: () => void } & {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => RunSnapshot;
};
```

## The internal seam: `decide`

```ts
/** Plain-number rect. DOMRect satisfies it structurally; tests build literals. */
export type Rect = {
  x: number; y: number; width: number; height: number;
  top: number; right: number; bottom: number; left: number;
};

/** One coherent sample of the page. Produced by the driver's sensor each frame. */
export type Reading = {
  el: Element | null;
  rect: Rect | null;
  inView: boolean;
  conditionHolds: boolean;          // step's state-check result, pre-evaluated
  now: number;                      // driver's clock (performance.now())
};

export type Input =
  | { type: Action }                // the six public verbs
  | { type: "conditionMet" }        // advance condition observed by a listener
  | { type: "frame"; reading: Reading };

export type Outcome = {
  state: RunState;                                    // === prev ⇔ nothing observable changed
  scroll?: Element;                                   // bring this target into view, fire-and-forget
  callback?: { action: Action; stepIndex: number };   // pre-transition index, computed here
};

export function decide(prev: RunState, input: Input, tutorial: Tutorial): Outcome;
```

Note `RunState`'s scratch fields (`el`, `scrolledOnce`, `conditionMetAt`) are the v2 `StepRuntime` folded into the model, so `decide` resets them on step change by construction — no `resetRuntime` to remember.

**Invariants a caller of `decide` must know — five, counted honestly:**

1. **Purity.** Same `(prev, input, tutorial)` → same `Outcome`. `el` is an opaque identity token; `Reading.now` is the only time it sees.
2. **Reference-equality contract.** `outcome.state === prev` iff nothing subscriber-visible changed. The "60 no-op frames notify nobody" guarantee hangs on this; `decide` owns it (rect deep-compare, settle-to-prev).
3. **Reading coherence.** All fields of a `Reading` sampled at the same instant; `now` non-decreasing across frames.
4. **Tutorial totality.** `getStep(i)` must return a step for every reachable index (including one past the last during a finishing advance). `decide` never bounds-checks.
5. **Outcome obedience & ordering.** Driver must: commit `state`, resync resources, notify subscribers, then fire `callback`, then/anytime `scroll`. `scroll` may appear even when `state === prev` (scroll-always steps). `callback.stepIndex` is pre-transition — the driver never computes it.

Error modes: none. Illegal transitions return `prev` (that's the contract, not an error).

**Public seam invariants — four:** resources live iff `subscriberCount > 0 && active`; `getSnapshot` reference-stable between notifications; callbacks fire after notify with pre-transition index; actions before first subscribe are legal (state moves, nothing senses).

Total: **one pure function with 5 invariants + one frozen facade with 4.** (v3: those plus ~8 more inside the generic runtime.)

## The driver (`run.ts`), sketched at real length

The one clever local mechanism — a *slot*:

```ts
// A slot is live iff its deps are non-null; changing deps restarts it.
type Slot = { deps: ReadonlyArray<unknown> | null; stop: () => void };
const slot = (): Slot => ({ deps: null, stop: () => {} });
const same = (a: ReadonlyArray<unknown> | null, b: ReadonlyArray<unknown> | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

function sync(s: Slot, deps: ReadonlyArray<unknown> | null, start: () => () => void) {
  if (same(s.deps, deps)) return;
  s.stop();
  s.deps = deps;
  s.stop = deps ? start() : () => {};
}
```

The engine:

```ts
export function createRun(config: RunConfig): Run {
  const { tutorial, root } = config;
  let state: RunState = initialState(tutorial);
  const listeners = new Set<() => void>();

  // ---- the four resources, named, visible, and nothing else -----------------
  const frameLoop = slot();
  const windowInputs = slot();
  const ariaMarks = slot();
  const targetEvents = slot();

  const syncResources = () => {
    const watched = listeners.size > 0 && state.active;
    const el = state.el;
    const aw = tutorial.getStep(state.step).advanceWhen;

    sync(frameLoop, watched ? [] : null, () => {
      let id = requestAnimationFrame(function tick() {
        dispatch({ type: "frame", reading: sense() });
        id = requestAnimationFrame(tick);
      });
      return () => cancelAnimationFrame(id);
    });

    sync(windowInputs, watched ? [] : null, () => {
      const c = new AbortController();
      const ctx = () => ({ snapshot: state, step: tutorial.getStep(state.step),
                           highlightPadding: config.highlightPadding });
      const fwd = (i: Input | undefined) => i && dispatch(i);
      window.addEventListener("click", (e) => fwd(readClick(e, ctx())),
        { capture: true, signal: c.signal });
      window.addEventListener("keydown", (e) => fwd(readKeyDown(e, ctx())),
        { signal: c.signal });
      return () => c.abort();
    });

    sync(ariaMarks, watched && el ? [el] : null, () => {
      el!.setAttribute("aria-haspopup", "dialog");
      el!.setAttribute("aria-expanded", "true");
      return () => {
        el!.removeAttribute("aria-haspopup");
        el!.removeAttribute("aria-expanded");
      };
    });

    sync(targetEvents,
      watched && el && aw?.type === "event" ? [el, state.step] : null,
      () => {
        const c = new AbortController();
        for (const name of [(aw as { event: string | string[] }).event].flat())
          el!.addEventListener(name, () => dispatch({ type: "conditionMet" }),
            { signal: c.signal });
        return () => c.abort();
      });
  };

  // ---- the sensor: the only per-frame DOM reads, packaged as data -----------
  const sense = (): Reading => {
    const step = tutorial.getStep(state.step);
    const selector = stepSelector(step);
    const el = !selector ? null
      : state.el?.isConnected ? state.el
      : root.querySelector(selector);
    const rect = el?.getBoundingClientRect() ?? null;
    return {
      el, rect,
      inView: rect !== null && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth,
      conditionHolds:
        step.advanceWhen?.type === "state" && step.advanceWhen.check(el ?? undefined),
      now: performance.now(),
    };
  };

  // ---- the single mutation site ---------------------------------------------
  const dispatch = (input: Input) => {
    const out = decide(state, input, tutorial);
    if (out.state !== state) {
      state = out.state;
      syncResources();
      listeners.forEach((l) => l());
      if (out.callback) fire(out.callback.action, out.callback.stepIndex);
    }
    out.scroll?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ... fire(), verbs via Object.fromEntries, subscribe calling syncResources()
}
```

What disappeared vs v3: no `Program`, no `Sub` type, no `subscriptionDeps`, no `runEffect`, no `onChange`, no `<Model, Msg, Effect>`. Vs v2: no `resetRuntime` called from the right four places, no hand-diffed `bindTargetListeners`, no "rest of this frame's events are stale" footgun (a frame is one atomic `Input`).

## Testing

All decision-logic tests need zero DOM — runs in node, no jsdom:

```ts
const el = {} as Element;   // identity is all decide uses
const rect = { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 };
const frame = (over: Partial<Reading>): Input => ({
  type: "frame",
  reading: { el, rect, inView: true, conditionHolds: false, now: 0, ...over },
});

let s = initialState(tutorial);
expect(s.canAdvance).toBe(false);                                   // gate closed
s = decide(s, frame({ now: 1000 }), tutorial).state;
expect(s.highlightTargetStatus).toBe("found");
s = decide(s, frame({ now: 1100, conditionHolds: true }), tutorial).state; // arms deadline
expect(decide(s, frame({ now: 1600, conditionHolds: true }), tutorial).state.step).toBe(1);

// the 60fps guarantee, as a one-line assertion:
expect(decide(s, frame({ now: 1200, conditionHolds: true }), tutorial).state).toBe(s);
```

Driver tests are few and integration-shaped (jsdom): subscribe starts the loop, unsubscribe strips aria, target swap migrates listeners, exit tears down.

## Trade-offs

**High leverage:** `decide` is the deep module — learn one function + five invariants and every regression test is object literals. The slot mechanism buys v3's "lifecycle correct by construction" for ~15 lines and zero exported types. Strong locality: a new advance-condition kind touches `decide` + one line of `sense`; a lifecycle bug can only live in `syncResources`.

**Thin:** `Reading` is wide-ish — adding a sensed fact touches `Reading` + `sense` + `decide` in lockstep. The driver is shallow-by-choice, checked only by jsdom tests and by reading it.

**Future hurts:** two simultaneous targets per step (breaks single `el` scratch/slots/`Reading` — real redesign, admitted); effects that feed back (async scroll completion) outgrow fire-and-forget `scroll?`; a second driver (SSR/no-raf host) would make the sensor worth promoting to a real injected seam — deliberately left one refactor away instead of prepaid.
