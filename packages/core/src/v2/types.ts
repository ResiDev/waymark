import { capitalize } from "../utils";

export const actions = [
  "advance",
  "prev",
  "focus",
  "unfocus",
  "reset",
  "exit",
] as const;
export const tourLifecycleEvents = ["start", "ready", "finish"] as const;

export type Action = (typeof actions)[number];

export const isAction = (eventType: Event["type"]): eventType is Action =>
  (actions as ReadonlyArray<string>).includes(eventType);

export type TourLifecycleEvent = (typeof tourLifecycleEvents)[number];

export type CallbackName<TEvent extends string> = `on${Capitalize<TEvent>}`;

export function getCallbackName<TEvent extends string>(
  event: TEvent,
): CallbackName<TEvent> {
  return `on${capitalize(event)}` as CallbackName<TEvent>;
}

type Callbacks<TEvent extends string, CallbackArgs> = {
  [TCallback in CallbackName<TEvent>]?: TourCallbackFn<CallbackArgs>;
};

/** Where the popover sits relative to the highlighted target. Pure geometry. */
export type Placement = "above" | "below" | "left" | "right";

export type BaseAutoAdvanced = {
  disableAutoAdvance?: boolean;
  gateNext?: boolean;
  delayMs?: number;
};

export type AutoAdvances =
  | ({ type: "click" } & BaseAutoAdvanced)
  | ({ type: "state"; check: (el?: Element) => boolean } & BaseAutoAdvanced)
  | ({
      type: "event";
      event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap>;
    } & BaseAutoAdvanced);

export type LoopEvent =
  | { type: "measured"; value: DOMRect | null }
  | { type: "found" }
  | { type: "lost" };

export type TargetedByWaymark = { waymark: string; selector?: never };
export type TargetedBySelector = { waymark?: never; selector: string };
export type Untargeted = { waymark?: never; selector?: never };

export type TourCallbackContext<CallbackArgs> = {
  stepIndex: number;
  targetSelector?: string;
  callbackArgs: CallbackArgs;
};

export type TourCallbackFn<CallbackArgs> = (
  ctx: TourCallbackContext<CallbackArgs>,
) => void;

/**
 * A step as the core understands it: how to find the target and when to move on.
 *
 * Deliberately carries no `content` — what a step renders is a concern of
 * whichever adapter is driving it. Renderers extend this with their own payload
 * (see react-waymark's TutorialStep, which adds ReactNode content).
 */
export type WaymarkStep<CallbackArgs> = {
  advanceWhen?: AutoAdvances;
  /** Defaults to 'once' when omitted. */
  scrollIntoView?: "always" | "once" | "never";
  callbacks?: StepCallbacks<CallbackArgs>;
  callbackArgs: CallbackArgs;
} & (TargetedByWaymark | TargetedBySelector | Untargeted);

/** Callbacks available on both individual steps and at the tour level. */
export type StepCallbacks<CallbackArgs> = Callbacks<Action, CallbackArgs>;

/** Tour-level callbacks extend step callbacks with tour-wide lifecycle hooks. */
export type TourCallbacks<CallbackArgs> = Callbacks<
  Action | TourLifecycleEvent,
  CallbackArgs
>;

// External user/adapter state
export type TourSnapshot = {
  step: number;
  active: boolean;
  focused: boolean;
  canAdvance: boolean;
  highlightTargetStatus: "searching" | "found" | "lost";
  highlightedElementRect: DOMRect | null;
};

export type Event =
  | {
      [TAction in Action]: { type: TAction };
    }[Action]
  | LoopEvent
  | { type: "advanceConditionMet" }; // Not an action or strictly a loop event because could be triggered by loop or browser event

export type ActionHandlers = {
  [TAction in Action]: () => void;
};

export type StepRuntime = {
  highlightedElement: Element | null;
  scrolledIntoViewOnce: boolean;
  ariaAnnotatedElement: Element | null;
  /** performance.now() deadline for a pending auto-advance; the loop is its own clock. */
  autoAdvanceAt: number | undefined;
  targetListenersController: AbortController | null;
};

export type Config<CallbackArgs> = {
  getStep: (i: number) => WaymarkStep<CallbackArgs>;
  root: Document | Element;
  tourCallbacks: TourCallbacks<CallbackArgs>;
  /** Halo around the target, in px. Clicks within it count as target clicks. */
  highlightPadding: number;
};

export type Tour = ActionHandlers & {
  subscribe: (cb: () => void) => () => void; // when subs hit 0 stop looping until subs go to 1 again
  getSnapshot: () => TourSnapshot;
};
