import { Beacon } from './Beacon';
import { DefaultPopover } from './DefaultPopover';
import { Highlight } from './Highlight';
import { PopoverAnchor } from './PopoverAnchor';
import type { Placement } from './PopoverAnchor';
import type { TourCallbacks, TutorialRenderProps, TutorialStep } from './types';
import { useTutorial } from './useTutorial';

type TutorialProps = {
  id: string;
  active: boolean;
  steps: Array<TutorialStep>;
  onCancel: () => void;
  children?: (props: TutorialRenderProps) => React.ReactNode;
  callbacks?: TourCallbacks;
  highlightPadding?: number;
};

// Thin gate so the hook (and all its store subscriptions, refs, effects) only
// run while the tour is active. Avoids dirtying the shared tourStore from
// inactive consumers, and means each step in `useTutorial` can assume `active`.
export function Tutorial(props: TutorialProps) {
  if (!props.active) return null;
  return <ActiveTutorial {...props} />;
}

function ActiveTutorial({
  id,
  steps,
  children,
  onCancel,
  callbacks,
  highlightPadding = 20,
}: TutorialProps) {
  const { step, currentStep, highlight, selector, ready, next, prev, focused, focus, reset, cancel } = useTutorial({
    id,
    callbacks,
    steps,
    onCancel,
    highlightPadding,
  });
  if (!currentStep) return null;

  const renderContent = (placement: Placement) => {
    const renderProps: TutorialRenderProps = {
      currentStep,
      placement,
      hasTarget: !!selector,
      step,
      ready,
      callbacks,
      cancel,
      totalSteps: steps.length,
      next,
      prev,
      reset,
    };

    if (currentStep.stepPopover) return currentStep.stepPopover(renderProps);
    if (children) return children(renderProps);
    return <DefaultPopover {...renderProps} />;
  };

  // Target-less step — full overlay, centered popover, no arrow
  if (!selector) {
    const centeredRect = new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    return (
      <Highlight highlight={centeredRect} padding={0}>
        <PopoverAnchor highlight={centeredRect} padding={0} ariaLabel={`Tutorial step ${step + 1} of ${steps.length}`}>
          {renderContent}
        </PopoverAnchor>
      </Highlight>
    );
  }

  // Waiting for target element to appear in the DOM
  if (!highlight) return;

  if (!focused) {
    return <Beacon highlight={highlight} onClick={focus} />;
  }

  return (
    <Highlight highlight={highlight} padding={highlightPadding}>
      <PopoverAnchor
        highlight={highlight}
        padding={highlightPadding}
        preferredPlacement={currentStep.preferredPopoverPosition}
        ariaLabel={`Tutorial step ${step + 1} of ${steps.length}`}
      >
        {renderContent}
      </PopoverAnchor>
    </Highlight>
  );
}
