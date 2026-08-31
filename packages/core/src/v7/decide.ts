import { observe } from "./observe";
import type { Reading } from "./observe";
import { silent } from "./outcome";
import type { Outcome } from "./outcome";
import type { Definition, State } from "./state";
import { meetCondition } from "./transitions";
import { applyAction } from "./transitions";
import type { Action } from "./types";

/**
 * The switchboard. Every rule in Waymark is reached through this one function,
 * and it is pure: the same (state, input, definition) gives the same Outcome.
 *
 * It decides nothing itself — it says which of transitions.ts and observe.ts
 * answers this Input.
 */

/** Everything that can happen to a Run. The driver sends nothing else. */
export type Input =
  | Readonly<{ kind: "act"; action: Action }>
  | Readonly<{ kind: "conditionMet"; now: number }>
  | Readonly<{ kind: "frame"; reading: Reading }>;

export function decide(
  state: State,
  input: Input,
  definition: Definition,
): Outcome {
  switch (input.kind) {
    case "act":
      return applyAction(state, input.action, definition);
    case "conditionMet":
      return startTheClock(state, input.now, definition);
    case "frame":
      return observe(state, input.reading, definition);
  }
}

/**
 * A click or a Waymark event says the condition holds. With no delay that is
 * the condition met, now — a click should not wait for the next frame to be
 * felt. With a delay, the clock is armed and a later frame will find it due.
 */
function startTheClock(
  state: State,
  now: number,
  definition: Definition,
): Outcome {
  if (state.phase !== "running" || state.conditionMet) return silent(state);
  const rule = definition.rules[state.index];
  if (rule === undefined) return silent(state);

  const dueAt = state.dueAt ?? now + rule.delayMs;
  if (now >= dueAt) return meetCondition(state, rule, definition);
  return silent(dueAt === state.dueAt ? state : { ...state, dueAt });
}
