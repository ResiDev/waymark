import { silent } from "./outcome";
import type { Announcement, Outcome } from "./outcome";
import { canAdvance, ended, enterStep } from "./state";
import type { Definition, State } from "./state";
import type { AdvanceRule } from "./tutorial";
import type { Action } from "./types";

/**
 * Every way a State deliberately becomes another State. Pure, and the only
 * file that answers "what does this Action do?" and "where does `previous` go?".
 *
 * A refused transition returns the State it was given, by identity, so the
 * driver can treat identity as "nothing happened".
 */

const announce = (type: Announcement["type"], stepIndex: number) =>
  [{ type, stepIndex }] as const;

/** Leave the current Step: on to the next one, or to a completed Run. */
export function advance(state: State, definition: Definition): Outcome {
  const from = state.index;
  if (from + 1 < definition.steps.length) {
    return {
      state: enterStep(from + 1, definition),
      announcements: announce("advance", from),
    };
  }
  return {
    state: ended("completed", from),
    announcements: [
      { type: "advance", stepIndex: from },
      { type: "finish", stepIndex: from },
    ],
  };
}

/**
 * The Advance condition has been met: open the gate, and move on as well if
 * the rule is an auto one. Opening the gate is a view change, not an event.
 */
export function meetCondition(
  state: State,
  rule: AdvanceRule,
  definition: Definition,
): Outcome {
  const unlocked = state.conditionMet ? state : { ...state, conditionMet: true };
  return rule.auto ? advance(unlocked, definition) : silent(unlocked);
}

/** What an Action does. The one answer to "may the user do this?". */
export function applyAction(
  state: State,
  action: Action,
  definition: Definition,
): Outcome {
  if (action === "reset") {
    return {
      state: enterStep(0, definition),
      announcements: announce("reset", state.index),
    };
  }
  if (state.phase !== "running") return silent(state);

  switch (action) {
    case "advance":
      return canAdvance(state, definition)
        ? advance(state, definition)
        : silent(state);

    case "previous":
      return state.index === 0
        ? silent(state)
        : {
            state: enterStep(state.index - 1, definition),
            announcements: announce("previous", state.index),
          };

    case "collapse":
      return state.collapsed
        ? silent(state)
        : {
            state: { ...state, collapsed: true },
            announcements: announce("collapse", state.index),
          };

    case "resume":
      return state.collapsed
        ? {
            state: { ...state, collapsed: false },
            announcements: announce("resume", state.index),
          }
        : silent(state);

    case "exit":
      return {
        state: ended("exited", state.index),
        announcements: announce("exit", state.index),
      };
  }
}
