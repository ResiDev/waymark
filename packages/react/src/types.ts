import type { ReactNode, CSSProperties } from 'react';
import type { Placement, StepCallbacks, WaymarkStep } from 'waymark';

/**
 * A core step plus everything React needs to render it. The core resolves the
 * target and decides when to advance; this adds the render payload it has no
 * opinion about.
 */
export type TutorialStep = WaymarkStep & {
  content: ReactNode;
  stepPopover?: (props: TutorialRenderProps) => ReactNode;
  popoverStyle?: CSSProperties;
  preferredPopoverPosition?: Placement;
  callbacks?: StepCallbacks<TutorialStep>;
};

export type TutorialRenderProps = {
  currentStep: TutorialStep;
  placement: Placement;
  step: number;
  totalSteps: number;
  ready: boolean;
  hasTarget: boolean;
  callbacks?: TourCallbacks;
  next: () => void;
  prev: () => void;
  reset: () => void;
  cancel: () => void;
};

// Core's callback types are generic over the step so React consumers keep the
// full TutorialStep (content and all) in their callback context.
export type TourCallbacks = import('waymark').TourCallbacks<TutorialStep>;
export type TourCallbackContext = import('waymark').TourCallbackContext<TutorialStep>;
export type { Placement, StepCallbacks, TutorialStore, WaymarkStep, FrameState, AutoAdvances } from 'waymark';
