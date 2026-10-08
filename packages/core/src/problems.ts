import type { Step } from "./walkthrough/types";

/** The app's own functions that Waymark calls. */
export type CallbackName = "subscriber" | "onEvent" | "onChange" | "stateCheck" | "isComplete";

/** Why a stored walkthrough was not picked up again. */
export type DropReason =
  /** Older than `maxAge`. */
  | "expired"
  /** Saved when the walkthrough had a different number of steps. */
  | "stepsChanged"
  /** Its Task is done or skipped. */
  | "taskNotTodo"
  /** Its Task is gone from the owner, or no longer has a walkthrough. */
  | "unknownTask";

export type WaymarkProblem<TStep extends Step = Step> =
  /** A storage adapter's `load` or `save` threw or rejected, or a `storage` function threw. */
  | Readonly<{ type: "storageFailed"; record: "tasks" | "walkthrough"; error: unknown }>
  /** A stored record Waymark did not write, or a newer version than it reads. */
  | Readonly<{ type: "recordUnreadable"; record: "tasks" | "walkthrough"; error: Error }>
  /** A stored walkthrough was wiped and the walkthrough starts fresh. */
  | Readonly<{ type: "recordDropped"; record: "walkthrough"; reason: DropReason }>
  /** The Waymark was found, then left the page. */
  | Readonly<{ type: "waymarkLost"; step: TStep; stepIndex: number }>
  /** The Waymark was never found: often a selector that does not match. */
  | Readonly<{ type: "waymarkMissing"; step: TStep; stepIndex: number }>
  /**
   * Given an `onProblem`, an error thrown by one of the app's own functions
   * comes here and is not thrown. A state check's is sent once per step for
   * each distinct error, though the check runs every frame.
   */
  | Readonly<{ type: "callbackThrew"; callback: CallbackName; error: unknown }>;

export type ProblemHandler<TStep extends Step = Step> = (problem: WaymarkProblem<TStep>) => void;

export const storageFailed = (record: "tasks" | "walkthrough", error: unknown): WaymarkProblem<never> => ({
  type: "storageFailed",
  record,
  error,
});

export const recordUnreadable = (record: "tasks" | "walkthrough", error: Error): WaymarkProblem<never> => ({
  type: "recordUnreadable",
  record,
  error,
});

export const recordDropped = (reason: DropReason): WaymarkProblem<never> => ({
  type: "recordDropped",
  record: "walkthrough",
  reason,
});

export const callbackThrew = (callback: CallbackName, error: unknown): WaymarkProblem<never> => ({
  type: "callbackThrew",
  callback,
  error,
});

/**
 * Without a handler, an error from the app's own functions is thrown, storage
 * problems are logged, and the rest pass quietly.
 */
export const problemReporter =
  <TStep extends Step>(onProblem: ProblemHandler<TStep> | undefined): ProblemHandler<TStep> =>
  (problem) => {
    if (onProblem) onProblem(problem);
    else if (problem.type === "callbackThrew") throw problem.error;
    else if (problem.type === "storageFailed") {
      console.error(`Waymark could not use its ${problem.record} storage.`, problem.error);
    } else if (problem.type === "recordUnreadable") {
      console.error(`Waymark could not read its stored ${problem.record} record.`, problem.error);
    }
  };
