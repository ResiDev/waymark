export type TutorialStep = {
  highlightName: string;
  text: string;
  advanceWhen: { type: 'click' } | { type: 'state'; check: () => boolean };
  scrollIntoView: boolean;
};

export type TutorialRenderProps = {
  currentStep: TutorialStep;
  step: number;
  totalSteps: number;
  next: () => void;
  prev: () => void;
  reset: () => void;
};
