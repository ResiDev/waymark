# Design 3 — Reader-first

**Constraint given:** optimize for the single maintainer reading it cold in six months (and a coding agent navigating it). Control flow followable top-to-bottom; "what mutates state, and when" answerable by reading one file linearly. One clever piece allowed if it demonstrably pays — concrete, no type parameters. Everything else the dumbest correct version.

> Base vocabulary (`Action`, `Step`, `Tutorial`, `RunConfig`, `Run`, `Rect`, `Reading`, and the snapshot/scratch split) is as defined in [design-1-minimal.md](design-1-minimal.md)'s vocabulary section — this design shares design 1's skeleton and differs in file layout and reconciler style, not types. Its snapshot uses the shorter field names `targetStatus`/`targetRect`.

## Shape

```
packages/core/src/v4/
  types.ts       — vocabulary + frozen public surface
  sense.ts       — every DOM read and write, as named functions. ~60 lines.
  resources.ts   — the ONE clever piece: concrete keyed-resource reconciler. ~70 lines.
  run.ts         — THE engine. Pure decisions at the top, one commit() in the middle,
                   wiring at the bottom. Read top-to-bottom.
  handlers.ts    — unchanged (pure: browser event + ctx → action | undefined)
```

The v3 `Model`/`Msg`/`Effect`/`Program`/`Sub` vocabulary is deleted.

## External contract (written down — 6 invariants)

1. `subscribe`/`getSnapshot` satisfy `useSyncExternalStore`; a no-op frame never notifies.
2. All sensing/listening live iff `active && subscribers > 0`; last unsubscribe tears down everything including aria attributes on the page.
3. Every action safe at any time; illegal ones are no-ops. No action throws.
4. Action callbacks fire **after** notification, with the **pre-transition** step index. Auto-advance fires no `onAdvance` (inherited v2/v3 behavior, now written down).
5. Callbacks may call actions reentrantly; they observe the committed snapshot.
6. Error modes: malformed selector throws from the frame tick; `getStep` past the end is the caller's contract; a throwing callback propagates after state is committed.

## Internal seams

**Pure decisions** (exported for tests): `transition(snap, action, meta)` — what each verb means — and `frameDecision(snap, scratch, reading, stepMeta)` — what one frame's reading means. Three invariants: same-reference means no change; `Scratch` replaced never mutated; `frameDecision` never advances the step itself — it reports `conditionMet` and the caller dispatches, so a frame is one atomic decision (kills v2's "rest of this frame's events are stale" rule — there's no event list to go stale).

**`resources.ts`** — the one clever piece, fully concrete (4 invariants: `sync` idempotent; restart when descriptor changes; stop-before-start; all-off = sync an empty `Wanted`):

```ts
export type Wanted = {
  frameLoop: boolean;
  windowInput: boolean;
  aria: Element | null;
  targetEvents: { el: Element; step: number; events: ReadonlyArray<string> } | null;
};

export function createResources(start: Starters) {
  let frameLoop: Stop | undefined;
  let windowInput: Stop | undefined;
  let aria: { el: Element; stop: Stop } | undefined;
  let targetEvents: { el: Element; step: number; stop: Stop } | undefined;

  return {
    sync(w: Wanted): void {
      if (!w.frameLoop && frameLoop) { frameLoop(); frameLoop = undefined; }
      if (w.frameLoop && !frameLoop) frameLoop = start.frameLoop();

      if (!w.windowInput && windowInput) { windowInput(); windowInput = undefined; }
      if (w.windowInput && !windowInput) windowInput = start.windowInput();

      if (aria && aria.el !== w.aria) { aria.stop(); aria = undefined; }
      if (w.aria && !aria) aria = { el: w.aria, stop: start.aria(w.aria) };

      const te = w.targetEvents;
      if (targetEvents && (!te || targetEvents.el !== te.el || targetEvents.step !== te.step)) {
        targetEvents.stop(); targetEvents = undefined;
      }
      if (te && !targetEvents)
        targetEvents = { el: te.el, step: te.step, stop: start.targetEvents(te) };
    },
  };
}
```

Four named slots, four if-blocks, zero type parameters. The *pattern* (derive wanted-set from state, diff, restart) is what's clever, not the code.

**`sense.ts`** — shallow by design, a vocabulary seam: `senseFrame` does every DOM read of a frame and no writes; `scrollTo`/`annotateTarget` are write-only actuators. Exists for locality (all DOM greppable in one file), not substitution.

## The engine — `run.ts` (the file you read cold)

```ts
// State is two variables: `snap` (public) and `scratch` (per-step, private).
// The ONLY place `snap` is assigned is commit(). Everything funnels there.

/** What each verb means. Returns `snap` itself when nothing changes. */
export function transition(snap, action, meta): RunSnapshot {
  switch (action) {
    case "advanceConditionMet":
      if (meta.canAutoAdvance) return goTo(snap, snap.step + 1, meta.hasGate);
      return snap.canAdvance ? snap : { ...snap, canAdvance: true };
    case "advance":
      return snap.canAdvance ? goTo(snap, snap.step + 1, meta.hasGate) : snap;
    case "prev":
      return snap.step === 0 ? snap : goTo(snap, snap.step - 1, meta.hasGate);
    case "reset":   return goTo(snap, 0, meta.hasGate);
    case "focus":   return snap.focused ? snap : { ...snap, focused: true };
    case "unfocus": return snap.focused ? { ...snap, focused: false } : snap;
    case "exit":    return snap.active ? { ...snap, active: false, focused: false } : snap;
  }
}

/** What one frame's reading means. One atomic decision per frame. */
export function frameDecision(snap, scratch, r, step) {
  let next = snap;
  const set = (patch: Partial<RunSnapshot>) => { next = { ...next, ...patch }; };

  // presence transitions: searching -> found -> lost
  if (r.el && snap.targetStatus === "searching")
    set({ targetStatus: "found", focused: true });
  if (!r.el && step.targeted) {
    if (snap.targetStatus === "found") set({ targetStatus: "lost" });
    if (next.focused) set({ focused: false });
  }
  if (!sameRect(next.targetRect, r.rect)) set({ targetRect: r.rect });

  const scroll = !!r.el && !r.inView && next.focused && next.targetStatus === "found" &&
    step.scrollIntoView !== "never" &&
    (step.scrollIntoView === "always" || !scratch.scrolledOnce);

  const conditionMetAt = r.checkPassed && step.stateDelayMs !== undefined
    ? (scratch.conditionMetAt ?? r.now + step.stateDelayMs)
    : scratch.conditionMetAt;

  return {
    snap: next,
    scratch: { el: r.el, scrolledOnce: scratch.scrolledOnce || scroll, conditionMetAt },
    scroll,
    conditionMet: conditionMetAt !== undefined && r.now >= conditionMetAt,
  };
}

export function createRun<CallbackArgs>(config: Config<CallbackArgs>): Run {
  let snap: RunSnapshot = /* initial, gate-aware */;
  let scratch = freshScratch();
  const listeners = new Set<() => void>();

  /** The single write point for `snap`. */
  function commit(next: RunSnapshot, action?: Action) {
    if (next === snap) return;                 // no-op frames stop here
    const before = snap;
    if (next.step !== before.step) scratch = freshScratch();
    snap = next;
    resources.sync(wanted());
    listeners.forEach((l) => l());
    if (action) fireCallbacks(action, before.step);
  }

  const dispatch = (a: Action | "advanceConditionMet") =>
    commit(transition(snap, a, meta(snap.step)), isAction(a) ? a : undefined);

  function tick(now: number) {
    const step = config.getStep(snap.step);
    const r = senseFrame(step, scratch.el, config.root, now);
    const d = frameDecision(snap, scratch, r, stepMeta(step));
    scratch = d.scratch;
    if (d.scroll && r.el) scrollTo(r.el);
    commit(d.snap);
    if (d.conditionMet) dispatch("advanceConditionMet");
    resources.sync(wanted());   // covers: element swapped without a snapshot change
  }

  /** What should be alive right now, derived from state. */
  function wanted(): Wanted {
    if (!snap.active || listeners.size === 0)
      return { frameLoop: false, windowInput: false, aria: null, targetEvents: null };
    const aw = config.getStep(snap.step).advanceWhen;
    return {
      frameLoop: true,
      windowInput: true,
      aria: scratch.el,
      targetEvents: scratch.el && aw?.type === "event"
        ? { el: scratch.el, step: snap.step, events: [aw.event].flat() }
        : null,
    };
  }

  const resources = createResources({ /* four starters: rAF loop, window
    listeners via handlers.ts, annotateTarget, target listeners */ });

  return { getSnapshot: () => snap, subscribe: /* add + sync; remove + sync */,
           advance: () => dispatch("advance"), /* ...the other five verbs */ };
}
```

The reader's question — "what mutates state, and when" — is answered by `run.ts` alone: `snap` only in `commit`, `scratch` in `commit` (reset) and `tick` (frame result), resources only through `sync(wanted())`, every caller visible in the same file.

## Testing

- **Logic (no DOM):** import `transition`/`frameDecision`, feed hand-built `Reading`s; `const el = {} as Element` works (identity only). The 60fps guarantee is `expect(d.snap).toBe(found)`.
- **Reconciler:** starters that log start/stop into arrays; drive `sync` with `Wanted` sequences; assert stop-before-start, idempotence, migration.
- **Integration (few):** happy-dom, real `createRun`, assert aria attrs appear/disappear across subscribe/advance/exit.

## Trade-offs

**High leverage:** the `Run` surface (six invariants buy the whole engine — same price as v2 but written down) and `resources.sync` (one 70-line mechanism retires the lifecycle bug class; deletion test passes emphatically — delete it and start/stop/migrate/cleanup re-scatter across commit, tick, subscribe, exit).

**Thin, knowingly:** `sense.ts` (interface ≈ implementation; exists for locality); `transition` alone (earns its keep as the DOM-free test surface).

**Worse than v3:** adding a new resource kind touches three named places (`Wanted`, `Starters`, `wanted()`) instead of pushing one `Sub` into an array — the price of no generics, and a compiler-guided edit. No reusable runtime if a second engine appears (extract v3's again *with two real instantiations* if that day comes). No `Msg` log, so no free replay/devtools story.

**Future hurts:** async effects (commit is synchronous; async work forces a queue and reopens ordering); a second frame consumer (IntersectionObserver sensing) would promote `sense.ts` to a real seam — cheap then, wasteful now. `wanted()` silently depends on `scratch.el` freshness — that's why `tick` ends with an unconditional `sync`; that one line is the residue of the old bug farm and deserves its comment.
