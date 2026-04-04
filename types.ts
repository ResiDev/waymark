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
  advanceWhen?: AutoAdvances;
  scrollIntoView: boolean;
  preferredPopoverPosition?: Placement;
  delay?: number;
};

export type TutorialStep = (TutorialStepBase & { dataTour: string }) | (TutorialStepBase & { selector: string });

export type TutorialRenderProps = {
  currentStep: TutorialStep;
  step: number;
  totalSteps: number;
  ready: boolean;
  next: () => void;
  prev: () => void;
  reset: () => void;
};
