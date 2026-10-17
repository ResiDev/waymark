import type { Step } from "./walkthrough/types";

/** The app's own functions that Waymark calls. */
export type CallbackName = "subscriber" | "onEvent" | "onChange" | "stateCheck" | "isComplete";

/** Why stored progress was dropped and its walkthrough starts again. */
export type DropReason =
  /** Part way through, and older than its walkthrough's `maxAge`. */
  | "expired"
  /** Saved when the walkthrough had a different number of steps. */
  | "stepsChanged";

export type WaymarkProblem<TStep extends Step = Step> =
  /** The storage adapter's `load` or `save` threw or rejected. */
  | Readonly<{ type: "storageFailed"; error: unknown }>
  /** A stored record Waymark did not write, or a newer version than it reads. */
  | Readonly<{ type: "recordUnreadable"; error: Error }>
  /** A walkthrough's stored progress was dropped once its definition arrived, and it starts again. */
  | Readonly<{ type: "recordDropped"; walkthrough: string; reason: DropReason }>
  /** The Waymark was found, then left the page. */
  | Readonly<{ type: "waymarkLost"; walkthrough: string; step: TStep; stepIndex: number }>
  /** The Waymark was never found: often a selector that does not match. */
  | Readonly<{ type: "waymarkMissing"; walkthrough: string; step: TStep; stepIndex: number }>
  /**
   * An error thrown by one of the app's own functions. Given a handler, it is
   * not thrown. A state check's is sent once per step for each distinct error,
   * though the check runs every frame.
   */
  | Readonly<{ type: "callbackThrew"; callback: CallbackName; error: unknown }>;

/** A handler for each type of problem the app wants to hear. A type without one gets Waymark's default. */
export type ProblemHandlers<TStep extends Step = Step> = {
  // Methods, so a walkthrough of particular steps still fits where any walkthrough does.
  // `this: void`, as each is called on its own.
  readonly [K in WaymarkProblem["type"]]?: {
    handle(this: void, problem: Extract<WaymarkProblem<TStep>, { type: K }>): void;
  }["handle"];
};

/**
 * One function for every problem, in place of all of Waymark's defaults. Its
 * steps are any Step unless given: inside `createRun` it cannot learn theirs,
 * and `NoInfer` stops it guessing `never` from them instead.
 */
export const everyProblem = <TStep extends Step = Step>(
  handle: (problem: WaymarkProblem<TStep>) => void,
): Required<ProblemHandlers<NoInfer<TStep>>> => ({
  storageFailed: handle,
  recordUnreadable: handle,
  recordDropped: handle,
  waymarkLost: handle,
  waymarkMissing: handle,
  callbackThrew: handle,
});

export const storageFailed = (error: unknown): WaymarkProblem<never> => ({
  type: "storageFailed",
  error,
});

export const recordUnreadable = (error: Error): WaymarkProblem<never> => ({
  type: "recordUnreadable",
  error,
});

export const recordDropped = (walkthrough: string, reason: DropReason): WaymarkProblem<never> => ({
  type: "recordDropped",
  walkthrough,
  reason,
});

export const callbackThrew = (callback: CallbackName, error: unknown): WaymarkProblem<never> => ({
  type: "callbackThrew",
  callback,
  error,
});

export type ReportProblem<TStep extends Step = Step> = (problem: WaymarkProblem<TStep>) => void;

const DEFAULTS: Required<ProblemHandlers> = {
  // Logged, not thrown: the user's browser failed, not the app, and a throw would break the click that saved.
  storageFailed: (problem) => {
    console.error("Waymark could not use its storage.", problem.error);
  },
  recordUnreadable: (problem) => {
    console.error("Waymark could not read its stored record.", problem.error);
  },
  recordDropped: () => {},
  waymarkLost: () => {},
  waymarkMissing: () => {},
  callbackThrew: (problem) => {
    throw problem.error;
  },
};

export const problemReporter =
  <TStep extends Step>(handlers: ProblemHandlers<TStep> = {}): ReportProblem<TStep> =>
  (problem) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler looked up is the one for this problem's type.
    const handle = (handlers[problem.type] ?? DEFAULTS[problem.type]) as ReportProblem<TStep>;
    handle(problem);
  };
