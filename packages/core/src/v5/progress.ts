import type { Action } from "./types";

/**
 * How far a Run has got. This is the whole of a Run's own state: where the page
 * is, where the popover is and what the DOM is doing are all observations made
 * elsewhere and never stored here.
 *
 * Every transition is in this file, it is pure, and it knows nothing about the
 * DOM — which is what makes "when may a user advance?" a question with one
 * answer rather than one per caller.
 */
export type Progress = Readonly<{
  phase: "running" | "completed" | "exited";
  index: number;
  collapsed: boolean;
  /** The current Step's Advance condition has been met. */
  conditionMet: boolean;
}>;

/** What the Tutorial says, reduced to the two facts transitions depend on. */
export type Gates = Readonly<{
  stepCount: number;
  /** A Step with an Advance condition keeps its gate shut until it is met. */
  gated: (index: number) => boolean;
}>;

export function startAt(index: number): Progress {
  return { phase: "running", index, collapsed: false, conditionMet: false };
}

export function canAdvance(progress: Progress, gates: Gates): boolean {
  return (
    progress.phase === "running" &&
    (progress.conditionMet || !gates.gated(progress.index))
  );
}

/** Records that the current Step's Advance condition has been met. */
export function meetCondition(progress: Progress): Progress {
  return progress.conditionMet ? progress : { ...progress, conditionMet: true };
}

/**
 * Applies an Action. Returns the same object when the Action is refused — a
 * shut gate, a `previous` on the first Step, anything at all once the Run has
 * ended — so callers can treat identity as "nothing happened".
 */
export function transition(
  progress: Progress,
  action: Action,
  gates: Gates,
): Progress {
  if (action === "reset") return startAt(0);
  if (progress.phase !== "running") return progress;

  switch (action) {
    case "advance": {
      if (!canAdvance(progress, gates)) return progress;
      return progress.index + 1 < gates.stepCount
        ? startAt(progress.index + 1)
        : { ...progress, phase: "completed", collapsed: false };
    }
    case "previous":
      return progress.index === 0 ? progress : startAt(progress.index - 1);
    case "collapse":
      return progress.collapsed ? progress : { ...progress, collapsed: true };
    case "resume":
      return progress.collapsed ? { ...progress, collapsed: false } : progress;
    case "exit":
      return { ...progress, phase: "exited", collapsed: false };
  }
}
