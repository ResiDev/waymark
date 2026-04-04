import { Beacon } from './Beacon';
import { DefaultPopover } from './DefaultPopover';
import { Highlight } from './Highlight';
import { PopoverAnchor } from './PopoverAnchor';
import type { TutorialRenderProps, TutorialStep } from './types';
import { useTutorial } from './useTutorial';

export function Tutorial({
  id,
  active,
  steps,
  children,
  highlightPadding = 20,
}: {
  id: string;
  active: boolean;
  steps: Array<TutorialStep>;
  children?: (props: TutorialRenderProps) => React.ReactNode;
  highlightPadding?: number;
}) {
  const { step, currentStep, highlight, ready, next, prev, focused, focus, reset } = useTutorial({
    id,
    active,
    steps,
  });
  if (!highlight) return;

  const renderProps: TutorialRenderProps = {
    currentStep,
    step,
    ready,
    totalSteps: steps.length,
    next,
    prev,
    reset,
  };

  const content = children ? children(renderProps) : <DefaultPopover {...renderProps} />;

  if (!focused) {
    return <Beacon highlight={highlight} onClick={focus} />;
  }

  return (
    <Highlight highlight={highlight} padding={highlightPadding}>
      <PopoverAnchor
        highlight={highlight}
        padding={highlightPadding}
        preferredPlacement={currentStep.preferredPopoverPosition}
      >
        {content}
      </PopoverAnchor>
    </Highlight>
  );
}
