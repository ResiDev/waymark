import { Placement } from './PopoverAnchor';

export type TutorialStore = {
  step: number;
  active: boolean;
  focused: boolean;
  ready: boolean;
  listeners: Set<() => void>;
  highlightedElement: null | Element;
  highlightElementIsInView: boolean;
  observer: IntersectionObserver | null;
  getObserver: () => IntersectionObserver | null;
  getStep: () => number;
  getFocused: () => boolean;
  getHighlightedElement: () => null | Element;
  setHighlightedElement: (document: Element | Document, name: string) => void;
  getReady: () => boolean;
  setReady: (ready: boolean) => void;
  subscribe: (callback: () => void) => () => void;
  focus: () => void;
  unfocus: () => void;
  prev: () => void;
  advance: () => void;
  reset: () => void;
};

type BaseAutoAdvanced = { disableAutoAdvance?: boolean; gateNext?: boolean };

type AutoAdvances =
  | ({ type: 'click' } & BaseAutoAdvanced)
  | ({ type: 'state'; check: (el?: Element) => boolean } & BaseAutoAdvanced)
  | ({ type: 'event'; event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> } & BaseAutoAdvanced);

type TutorialStepBase = {
  text: string;
  preferredPopoverPosition?: Placement;
  advanceWhen?: AutoAdvances;
  scrollIntoView?: 'always' | 'once' | 'never'; // defaults to once if omitted
  delay?: number;
  callbacks?: StepCallbacks;
};

export type TutorialStep =
  | (TutorialStepBase & { dataTour: string; selector?: never })
  | (TutorialStepBase & { dataTour?: never; selector: string })
  | (TutorialStepBase & { dataTour?: never; selector?: never });

export type TourCallbackContext = {
  stepIndex: number;
  targetSelector?: string;
  currentStep?: TutorialStep;
};

type TourCallbackFn = (ctx: TourCallbackContext) => void;

/** Callbacks available on both individual steps and at the tour level. */
export type StepCallbacks = {
  onFocus?: TourCallbackFn;
  onUnfocus?: TourCallbackFn;
  onAdvance?: TourCallbackFn;
  onPrev?: TourCallbackFn;
  onCancel?: TourCallbackFn;
};

/** Tour-level callbacks extend step callbacks with tour-wide lifecycle hooks. */
export type TourCallbacks = StepCallbacks & {
  onReset?: TourCallbackFn;
  onFinish?: TourCallbackFn;
  onStart?: TourCallbackFn;
  onReady?: TourCallbackFn;
};

export type TutorialRenderProps = {
  currentStep: TutorialStep;
  step: number;
  totalSteps: number;
  ready: boolean;
  callbacks?: TourCallbacks;
  next: () => void;
  prev: () => void;
  reset: () => void;
  cancel: () => void;
};
