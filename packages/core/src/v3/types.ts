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

export const isAction = (type: Msg["type"]): type is Action =>
  (actions as ReadonlyArray<string>).includes(type);

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

/** What the frame subscription read from the DOM this tick. The sensor
 * output; deciding what it means is `update`'s job and is pure. */
export type FrameReading = {
  el: Element | null;
  rect: DOMRect | null;
  inView: boolean;
  checkPassed: boolean;
  now: number;
};

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

/** Everything `update` understands. Actions are the public verbs;
 * `advanceConditionMet` is reported by whichever input serves the step's
 * advance condition (target click, target DOM event, or a passing state
 * check); `frame` is the per-tick DOM reading. */
export type Msg =
  | { [TAction in Action]: { type: TAction } }[Action]
  | { type: "advanceConditionMet" }
  | ({ type: "frame" } & FrameReading);

/** The private per-step scratch, carried on the model beside the snapshot. */
export type Model = TourSnapshot & {
  /** Cached so we do not querySelector every frame. */
  el: Element | null;
  scrolledOnce: boolean;
  /** performance.now() at which the advance condition counts as met. */
  conditionMetAt: number | undefined;
};

export type Effect = { type: "scrollIntoView"; el: Element };

export type ActionHandlers = {
  [TAction in Action]: () => void;
};

export type Config<CallbackArgs> = {
  getStep: (i: number) => WaymarkStep<CallbackArgs>;
  root: Document | Element;
  tourCallbacks: TourCallbacks<CallbackArgs>;
  /** Halo around the target, in px. Clicks within it count as target clicks. */
  highlightPadding: number;
};

export type Tour = ActionHandlers & {
  /** Subscriptions (frame loop, listeners) go live with the first subscriber
   * and are torn down with the last. */
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => TourSnapshot;
};

export function stepSelector<CallbackArgs>(
  step: WaymarkStep<CallbackArgs>,
): string | undefined {
  return step.waymark ? `[data-waymark=${step.waymark}]` : step.selector;
}
