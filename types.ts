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
