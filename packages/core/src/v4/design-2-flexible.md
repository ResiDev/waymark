# Design 2 — Maximum flexibility

**Constraint given:** design for plausible futures (new advance-condition kinds, serializable runs, non-React adapters, third-party step resources, non-DOM hosts) — but justify every seam against "one adapter means a hypothetical seam" and label speculation honestly.

Notable: despite the brief, this design *also* deleted the generic `Program<Model,Msg,Effect>` runtime. It keeps v3's reconciler as implementation and spends the interface budget on three domain seams — two real today, one labeled speculative.

> Base vocabulary (`Action`, `Step`, `Tutorial`, `Run`, `Rect`) is as defined in [design-1-minimal.md](design-1-minimal.md)'s vocabulary section, except where this design redefines it — notably the snapshot (split below) and `Step.target`/`advanceWhen.kind` (restructured for the driver seam).

## Module map

```
waymark-core
├── run.ts          createRun()            ← the one deep module; frozen public surface
├── decide.ts       pure reducer + hit-test (internal seam, no host, no DOM)
├── reconcile.ts    resource reconciler    (internal; v3's idea, kept verbatim)
├── host.ts         Host<Ref> interface    ← SEAM 1 (real: 2 adapters today)
├── conditions.ts   ConditionDriver        ← SEAM 2 (real: 3 built-in adapters)
├── resources.ts    StepResource           ← SEAM 3 (mechanism real, public param speculative)
├── host-dom.ts     DomHost adapter
└── host-fake.ts    FakeHost adapter (tests / SSR)
```

## Serializable by construction — the snapshot split

```ts
/** The durable half of a run: what survives a reload. Plain JSON. */
export type Progress = {
  step: number;
  active: boolean;
  focused: boolean;      // false = collapsed run (beacon, resumable)
  canAdvance: boolean;
};

/** The ephemeral half: re-derived from sensing, never persisted. */
export type Sensing = {
  targetStatus: "searching" | "found" | "lost";
  targetRect: Rect | null;
};

export type RunSnapshot = Readonly<Progress & Sensing>;
```

No `serialize()` method — an adapter persists the four `Progress` fields off any snapshot and passes them back as `resume`. Pause = last unsubscribe; resume = subscribe again. Zero new surface. (`resume` clamps `step`; gates re-lock on resume — a persisted `canAdvance` is never trusted for a gated step.)

## SEAM 1 — the Host (real: 2 adapters)

```ts
export interface Host<Ref = unknown> {
  now(): number;
  frames(onFrame: () => void): Teardown;         // browser: rAF; fake: manual pump
  query(selector: string): Ref | null;
  read(ref: Ref): TargetReading;                 // { connected, rect, inView }
  scrollTo(ref: Ref): void;
  markTarget(ref: Ref): Teardown;                // DomHost: aria attrs; teardown removes
  listen(ref: Ref, events: readonly string[], cb: () => void): Teardown;
  input(cb: (e: InputEvent) => void): Teardown;  // raw geometry/keys only
}
```

**Host invariants — five:** (1) `query`/`read` frame-cadence cheap, `read` on a disconnected ref returns `connected: false`; (2) `Ref` identity-stable while the same underlying target persists; (3) every `Teardown` called exactly once, safe after the thing is gone; (4) `input` delivers raw geometry only — halo hit-testing and "what does this click mean" is the engine's pure logic, so every host gets identical UX semantics; (5) only `query` may throw (malformed selector, fail fast).

Justified: `DomHost` and `FakeHost` both ship, and FakeHost is mandated by the "decision logic testable without a DOM" constraint. SSR/non-DOM hosts are the same adapter slot for free.

## SEAM 2 — advance-condition drivers (real: 3 built-in adapters)

```ts
export interface ConditionDriver<Spec extends ConditionSpec = ConditionSpec, Ref = unknown> {
  kind: Spec["kind"];
  /** Level-triggered: pure, evaluated every frame. */
  poll?(spec: Spec, reading: TargetReading | null): boolean;
  /** Edge-triggered: attach to live sources; torn down on step change / target swap. */
  attach?(spec: Spec, ctx: ConditionCtx<Ref>): Teardown;
}
```

The built-ins ride the same seam — that's what makes it real rather than hypothetical:

- `click` — `attach` subscribes to engine-resolved input intents, calls `met()` on `"targetClick"` (click stops being privileged/hard-wired through the window handler as in v2/v3).
- `event` — `attach` uses `host.listen(target, events, met)`.
- `state` — `poll: (spec, reading) => spec.check(reading)` — the check receives the *reading*, not the Element: pure by construction.

**Driver invariants — five:** `poll` pure (60×/s); `attach` runs only while active + target found, re-attached on step/target change; `met()` is edge semantics (first signal arms `delayMs`, further ignored, cancelled by step change); what "met" *does* (gate unlock vs auto-advance vs manual-only) is engine policy — **a driver only reports, it never advances** (that asymmetry is the depth); DOM-coupled drivers downcast to `DomHost.element(ref)` — deliberately not on the neutral `Host`.

A third-party route-change condition, complete:

```ts
type RouteSpec = ConditionSpec & { kind: "route"; pattern: string };

export const routeCondition: ConditionDriver<RouteSpec> = {
  kind: "route",
  attach(spec, { met }) {
    const check = () => {
      if (new RegExp(spec.pattern).test(location.pathname)) met();
    };
    window.addEventListener("popstate", check);
    check();
    return () => window.removeEventListener("popstate", check);
  },
};

// Step: { target: { waymark: "settings-link" },
//         advanceWhen: { kind: "route", pattern: "^/settings", gate: true } }
```

## SEAM 3 — contributed step resources (speculative, admitted)

```ts
export type StepResource<Ref> = {
  key: string;
  deps?: readonly unknown[];       // identity-compared; change ⇒ restart
  start(ctx: ResourceCtx<Ref>): Teardown;
};
```

The *mechanism* is real — the engine's own target-marking, condition attachments, and frame loop all run through this same reconciler. The **public `resources` param has zero external adapters today** (confetti, analytics beacons are hypothetical); exposed anyway because the marginal cost is one type over an already-load-bearing internal seam. Explicit advice from the design: ship `@experimental`, and build no plugin registry / priority system / inter-resource communication until a second real consumer exists.

```ts
// per-step analytics beacon
resources: ({ snapshot }) => [{
  key: "beacon",
  deps: [snapshot.step],
  start: () => { analytics.track("step_seen", { step: snapshot.step }); return () => {}; },
}],
```

## Non-seams (deliberate)

- **Multiple simultaneous runs:** N runs = N `createRun` calls; a "focus arbiter" is an ordinary caller of two frozen surfaces. No engine hook.
- **Non-React adapters:** `subscribe/getSnapshot` *is* the framework seam; a vanilla adapter is ~3 lines. Not a v4 feature — a v2-era property not broken.

## The engine core (shape)

```ts
const dispatch = (ev: RunEvent) => {
  const prevStep = model.step;
  const out = decide(model, ev, opts);        // pure: {model, commands}
  if (out.model === model) return;            // no-op frames are silent here
  model = out.model;
  rec.sync(desiredResources(model));          // reconcile before notify
  for (const cmd of out.commands) runCommand(cmd);
  listeners.forEach(l => l());
  fireCallbacks(ev, prevStep, opts);          // pre-transition index
};

/** Engine internals and contributed resources ride the SAME reconciler. */
const desiredResources = (m: Model): StepResource<Ref>[] => {
  if (!m.active || listeners.size === 0) return [];
  const step = opts.tutorial.getStep(m.step);
  return [
    { key: "frames", start: () => opts.host.frames(() => dispatch(readFrame(model, opts))) },
    { key: "input",  start: () => opts.host.input(e =>
        dispatch(deriveIntents(e, snap(model), opts.haloPadding ?? 0))) },
    ...(m.targetRef ? [{ key: "mark", deps: [m.targetRef],
        start: () => opts.host.markTarget(m.targetRef!) }] : []),
    ...conditionResources(step, m, drivers, dispatch),
    ...(opts.resources?.({ snapshot: snap(m), step, target: m.targetRef }) ?? []),
  ];
};
```

## Invariant count

Run surface: **9** (lifecycle-by-subscription, snapshot-identity=change, actions-never-throw, callback timing, one-transition-per-frame, terminal advance/finish, gate semantics incl. resume re-lock, resume clamping, invalid-selector-throws). Host: 5. Drivers: 5. Resources: 4. More total surface than Designs 1/3 — but they are *domain statements* an adapter author needs anyway, none about feeding a generic machine.

## Trade-offs

**High leverage:** the Host seam (~8 methods buy DOM-free tests, SSR, any future render surface; the mandated fake means the second adapter is maintained forever, not rotting in fixtures). Condition drivers (built-ins ride the public seam, so third-party drivers land on proven ground).

**Thin:** `resources` (admitted speculation, priced at one type); `Intent` has two members and exists mainly so `click` could stop being privileged.

**Future hurts:** cross-run coordination (no seam — consciously); multi-target steps (singular `targetRef`/halo hit-test ripple everywhere — genuine v5); rich async effects (`met()` is fire-and-forget; real async choreography would rebuild some of v3's generality — but then with a second instantiation, i.e. the evidence v3 lacked).
