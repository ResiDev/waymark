export type TutorialStore = {
  step: number;
  active: boolean;
  focused: boolean;
  listeners: Set<() => void>;
  highlightedElement: null | Element;
  highlightElementIsInView: boolean;
  observer: IntersectionObserver;
  getStep: () => number;
  getFocused: () => boolean;
  getHighlightedElement: () => null | Element;
  setHighlightedElement: (document: Element | Document, name: string) => void;
  subscribe: (callback: () => void) => () => void;
  focus: () => void;
  unfocus: () => void;
  prev: () => void;
  advance: () => void;
  reset: () => void;
};
export type TutorialStep = {
  highlightName: string;
  text: string;
  advanceWhen:
    | { type: 'click' }
    | { type: 'state'; check: (el?: Element) => boolean }
    | { type: 'event'; event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> };
  scrollIntoView: boolean;
  delay?: number;
};

export type TutorialRenderProps = {
  currentStep: TutorialStep;
  step: number;
  totalSteps: number;
  next: () => void;
  prev: () => void;
  reset: () => void;
};
