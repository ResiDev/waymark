/** Where the popover sits relative to the highlighted target. Pure geometry. */
export type Placement = 'above' | 'below' | 'left' | 'right';

type BaseAutoAdvanced = { disableAutoAdvance?: boolean; gateNext?: boolean; delayMs?: number };

export type AutoAdvances =
  | ({ type: 'click' } & BaseAutoAdvanced)
  | ({ type: 'state'; check: (el?: Element) => boolean } & BaseAutoAdvanced)
  | ({ type: 'event'; event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> } & BaseAutoAdvanced);

type TargetedByDataAttribute = { dataTour: string; selector?: never };
type TargetedBySelector = { dataTour?: never; selector: string };
type Untargeted = { dataTour?: never; selector?: never };

/**
 * A step as the core understands it: how to find the target and when to move on.
 *
 * Deliberately carries no `content` — what a step renders is a concern of
 * whichever adapter is driving it. Renderers extend this with their own payload
 * (see react-waymark's TutorialStep, which adds ReactNode content).
 */
export type WaymarkStep = {
  advanceWhen?: AutoAdvances;
  /** Defaults to 'once' when omitted. */
  scrollIntoView?: 'always' | 'once' | 'never';
} & (TargetedByDataAttribute | TargetedBySelector | Untargeted);

export type FrameState = {
  isAutoAdvancing: boolean;
  scrolledIntoViewOnce: boolean;
  ariaAnnotatedElement: Element | null;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
  highlightTargetStatus: 'searching' | 'found' | 'waiting-for-highlight-target' | 'lost';
  frameId: number | undefined;
};

export type TutorialStore = {
  step: number;
  active: boolean;
  focused: boolean;
  ready: boolean;
  listeners: Set<() => void>;
  highlightedElement: null | Element;
  highlightElementIsInView: boolean;
  highlightedElementRect: DOMRect | null;
  observer: IntersectionObserver | null;
  frameState: FrameState;
  getObserver: () => IntersectionObserver | null;
  getStep: () => number;
  getFocused: () => boolean;
  getHighlightedElement: () => null | Element;
  setHighlightedElement: (document: Element | Document, name: string) => void;
  getHighlightedElementRect: () => DOMRect | null;
  setHighlightedElementRect: (element: Element | null) => void;
  getReady: () => boolean;
  setReady: (ready: boolean) => void;
  setFrameState: (frameState: FrameState) => void;
  disposeFrameState: () => void;
  subscribe: (callback: () => void) => () => void;
  focus: () => void;
  unfocus: () => void;
  prev: () => void;
  advance: () => void;
  reset: () => void;
};

// Callback types are generic over the step so adapters keep their own richer
// step type all the way through to user callbacks. The parameter is required
// rather than merely nice-to-have: callbacks take the context as an argument,
// so under strictFunctionTypes a non-generic core context would make an
// adapter's callbacks unassignable to the core's.
export type TourCallbackContext<TStep extends WaymarkStep = WaymarkStep> = {
  stepIndex: number;
  targetSelector?: string;
  currentStep: TStep | null;
};

type TourCallbackFn<TStep extends WaymarkStep> = (ctx: TourCallbackContext<TStep>) => void;

/** Callbacks available on both individual steps and at the tour level. */
export type StepCallbacks<TStep extends WaymarkStep = WaymarkStep> = {
  onFocus?: TourCallbackFn<TStep>;
  onUnfocus?: TourCallbackFn<TStep>;
  onAdvance?: TourCallbackFn<TStep>;
  onPrev?: TourCallbackFn<TStep>;
  onCancel?: TourCallbackFn<TStep>;
};

/** Tour-level callbacks extend step callbacks with tour-wide lifecycle hooks. */
export type TourCallbacks<TStep extends WaymarkStep = WaymarkStep> = StepCallbacks<TStep> & {
  onReset?: TourCallbackFn<TStep>;
  onFinish?: TourCallbackFn<TStep>;
  onStart?: TourCallbackFn<TStep>;
  onReady?: TourCallbackFn<TStep>;
};
