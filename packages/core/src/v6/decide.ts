/**
 * v6 PROTOTYPE — the "design 1" shape from v4/design-1-minimal.md, speaking
 * v5's vocabulary (types.ts, tutorial.ts and input.ts are reused unchanged).
 *
 * One State object holds everything a Run knows, scratch included. One pure
 * function — decide — holds every rule: transitions, presence, scrolling,
 * gating, delays, auto-advance. The DOM crosses in as a Reading (plain data;
 * elements are identity tokens, never dereferenced here) and crosses out as
 * an Outcome the driver obeys.
 *
 * Invariants:
 *  1. decide is pure: same (prev, input, ctx) → same Outcome.
 *  2. outcome.state === prev ⇔ nothing changed. No-op frames cost nothing.
 *  3. Scratch resets on step change by construction: every move goes
 *     through goTo, which rebuilds the whole State.
 *  4. sameView(a, b) ⇔ a and b render identically; the driver notifies and
 *     rebuilds snapshots only across a view change, so scratch-only changes
 *     (arming dueAt, caching el) stay silent.
 */
import { selectorFor } from "../v5/tutorial";
import type { AdvanceRule } from "../v5/tutorial";
import { sameLocation } from "../v5/locator";
import type { Action, Location, Rect, Step } from "../v5/types";

/** The whole of a Run's state. `console.log(state)` shows everything. */
export type State = Readonly<{
  phase: "running" | "completed" | "exited";
  index: number;
  collapsed: boolean;
  /** The current Step's Advance condition has been met. Also the once-latch. */
  conditionMet: boolean;
  /** Where the Waymark is. Replaced only when it actually changed. */
  location: Location;
  // ---- per-Step scratch. goTo resets it; nothing else has to remember to. ----
  /** The Waymark element — an identity token for the driver's slots. */
  el: Element | null;
  scrolledOnce: boolean;
  /** Clock deadline once the Advance condition first held. */
  dueAt: number | undefined;
}>;

/** What the Tutorial contributes: fixed for the life of the Run. */
export type Ctx = Readonly<{
  steps: readonly Step[];
  rules: readonly (AdvanceRule | undefined)[];
}>;

/** One coherent sample of the page, taken by the driver's sensor. */
export type Reading = Readonly<{
  el: Element | null;
  rect: Rect | null;
  inView: boolean;
  /** The Step's `state` check, pre-evaluated by the sensor. */
  conditionHolds: boolean;
  now: number;
}>;

export type Input =
  | Readonly<{ type: Action }>
  | Readonly<{ type: "conditionMet"; now: number }>
  | Readonly<{ type: "frame"; reading: Reading }>;

/** Something to announce through onEvent; stepIndex is pre-transition. */
export type Note = Readonly<{
  type: "start" | Action | "finish";
  stepIndex: number;
}>;

export type Outcome = Readonly<{
  /** === prev ⇔ nothing happened. */
  state: State;
  /** Bring this element into view. Fire-and-forget. */
  scroll?: Element;
  notes: readonly Note[];
}>;

const ABSENT: Location = { status: "absent" };
const SEARCHING: Location = { status: "searching" };
const LOST: Location = { status: "lost" };

/** A fresh State at a Step. The only way to move; resetting scratch is free. */
export function goTo(index: number, ctx: Ctx): State {
  return {
    phase: "running",
    index,
    collapsed: false,
    conditionMet: false,
    location: selectorFor(ctx.steps[index]) === undefined ? ABSENT : SEARCHING,
    el: null,
    scrolledOnce: false,
    dueAt: undefined,
  };
}

export function canAdvance(state: State, ctx: Ctx): boolean {
  return (
    state.phase === "running" &&
    (state.conditionMet || ctx.rules[state.index] === undefined)
  );
}

/** True ⇔ a and b produce identical snapshots. Scratch is invisible. */
export function sameView(a: State, b: State): boolean {
  return (
    a.phase === b.phase &&
    a.index === b.index &&
    a.collapsed === b.collapsed &&
    a.conditionMet === b.conditionMet &&
    a.location === b.location
  );
}

type Step_ = { state: State; notes: readonly Note[] };

const none = (state: State): Outcome => ({ state, notes: [] });

/** Move on from the current Step: to the next one, or to "completed". */
function advanceNow(state: State, ctx: Ctx): Step_ {
  const i = state.index;
  if (i + 1 < ctx.steps.length) {
    return { state: goTo(i + 1, ctx), notes: [{ type: "advance", stepIndex: i }] };
  }
  return {
    state: { ...state, phase: "completed", collapsed: false },
    notes: [
      { type: "advance", stepIndex: i },
      { type: "finish", stepIndex: i },
    ],
  };
}

/** The condition is met: open the gate, and move on if the rule says to. */
function applyMet(state: State, rule: AdvanceRule, ctx: Ctx): Step_ {
  const unlocked = state.conditionMet ? state : { ...state, conditionMet: true };
  return rule.auto ? advanceNow(unlocked, ctx) : { state: unlocked, notes: [] };
}

function decideAction(prev: State, action: Action, ctx: Ctx): Outcome {
  if (action === "reset") {
    return { state: goTo(0, ctx), notes: [{ type: "reset", stepIndex: prev.index }] };
  }
  if (prev.phase !== "running") return none(prev);

  switch (action) {
    case "advance": {
      if (!canAdvance(prev, ctx)) return none(prev);
      const { state, notes } = advanceNow(prev, ctx);
      return { state, notes };
    }
    case "previous":
      return prev.index === 0
        ? none(prev)
        : {
            state: goTo(prev.index - 1, ctx),
            notes: [{ type: "previous", stepIndex: prev.index }],
          };
    case "collapse":
      return prev.collapsed
        ? none(prev)
        : {
            state: { ...prev, collapsed: true },
            notes: [{ type: "collapse", stepIndex: prev.index }],
          };
    case "resume":
      return prev.collapsed
        ? {
            state: { ...prev, collapsed: false },
            notes: [{ type: "resume", stepIndex: prev.index }],
          }
        : none(prev);
    case "exit":
      return {
        state: { ...prev, phase: "exited", collapsed: false },
        notes: [{ type: "exit", stepIndex: prev.index }],
      };
  }
}

/** A click or a Waymark event said the condition holds. */
function decideMet(prev: State, now: number, ctx: Ctx): Outcome {
  if (prev.phase !== "running" || prev.conditionMet) return none(prev);
  const rule = ctx.rules[prev.index];
  if (!rule) return none(prev);

  const dueAt = prev.dueAt ?? now + rule.delayMs;
  const armed = dueAt === prev.dueAt ? prev : { ...prev, dueAt };
  if (now < dueAt) return armed === prev ? none(prev) : { state: armed, notes: [] };
  const { state, notes } = applyMet(armed, rule, ctx);
  return { state, notes };
}

/** What one frame's Reading means. One atomic decision per frame. */
function decideFrame(prev: State, r: Reading, ctx: Ctx): Outcome {
  if (prev.phase !== "running") return none(prev);
  const step = ctx.steps[prev.index];
  const rule = ctx.rules[prev.index];

  // Presence: searching → found → lost; never searching again.
  const seen: Location =
    selectorFor(step) === undefined
      ? ABSENT
      : r.rect
        ? { status: "found", rect: r.rect }
        : prev.location.status === "found" || prev.location.status === "lost"
          ? LOST
          : SEARCHING;
  const location = sameLocation(seen, prev.location) ? prev.location : seen;

  // Scroll: once (or always), only while expanded, only when off-screen.
  const scroll =
    r.el && r.rect && !r.inView && !prev.collapsed && step.scroll !== "never" &&
    (step.scroll === "always" || !prev.scrolledOnce)
      ? r.el
      : undefined;
  const scrolledOnce = prev.scrolledOnce || scroll !== undefined;

  // The condition clock: armed while the check holds, cleared when it stops.
  let dueAt = prev.dueAt;
  if (rule?.byCheck) dueAt = r.conditionHolds ? (dueAt ?? r.now + rule.delayMs) : undefined;

  let state = prev;
  if (
    location !== prev.location ||
    r.el !== prev.el ||
    scrolledOnce !== prev.scrolledOnce ||
    dueAt !== prev.dueAt
  ) {
    state = { ...prev, location, el: r.el, scrolledOnce, dueAt };
  }

  // Deadline passed and still armed? Then the condition is met, now.
  let notes: readonly Note[] = [];
  if (rule && !state.conditionMet && state.dueAt !== undefined && r.now >= state.dueAt) {
    ({ state, notes } = applyMet(state, rule, ctx));
  }

  return { state, scroll, notes };
}

export function decide(prev: State, input: Input, ctx: Ctx): Outcome {
  switch (input.type) {
    case "conditionMet":
      return decideMet(prev, input.now, ctx);
    case "frame":
      return decideFrame(prev, input.reading, ctx);
    default:
      return decideAction(prev, input.type, ctx);
  }
}
