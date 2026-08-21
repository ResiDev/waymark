import { advanceTour, focusTour, setTourReady, unfocusTour } from './index';
import type { CallbackArgs, FrameState, TutorialStore, WaymarkStep } from './index';

export type CurrentStepRef<TStep extends WaymarkStep = WaymarkStep> = { current: TStep | null };
export type CallbackArgsRef<TStep extends WaymarkStep = WaymarkStep> = { current: CallbackArgs<TStep> };

export type TourState<TStep extends WaymarkStep = WaymarkStep> = {
  tourStore: TutorialStore;
  selector: string | undefined;
  queryRoot: Document | Element;
  currentStepRef: CurrentStepRef<TStep>;
  callbackArgsRef: CallbackArgsRef<TStep>;
  frameState: FrameState;
};

// todo optimise when not focused
export function runTourFrame<TStep extends WaymarkStep>({
  tourStore,
  frameState,
  selector,
  queryRoot,
  currentStepRef,
  callbackArgsRef,
}: TourState<TStep>) {
  const newFrameState = { ...frameState };
  const currentStep = currentStepRef.current;
  const callbackArgs = callbackArgsRef.current;
  let highlightElement = tourStore.getHighlightedElement();

  // find highlight element
  if ((!highlightElement || !highlightElement.isConnected) && selector) {
    tourStore.setHighlightedElement(queryRoot, selector);
    highlightElement = tourStore.getHighlightedElement();
  }

  // Mark the target element so screen readers announce it has an associated dialog
  if (highlightElement !== newFrameState.ariaAnnotatedElement) {
    newFrameState.ariaAnnotatedElement?.removeAttribute('aria-haspopup');
    newFrameState.ariaAnnotatedElement?.removeAttribute('aria-expanded');
    if (highlightElement) {
      highlightElement.setAttribute('aria-haspopup', 'dialog');
      highlightElement.setAttribute('aria-expanded', 'true');
    }
    newFrameState.ariaAnnotatedElement = highlightElement;
  }

  // scrollIntoView behaviour
  if (highlightElement && tourStore.focused) {
    if (!tourStore.highlightElementIsInView && currentStep?.scrollIntoView !== 'never') {
      if (currentStep?.scrollIntoView === 'always' || !newFrameState.scrolledIntoViewOnce) {
        highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      newFrameState.scrolledIntoViewOnce = true;
    }
  }

  // detect state change for auto advance tour
  if (currentStep?.advanceWhen?.type === 'state' && currentStep.advanceWhen.check(highlightElement ?? undefined)) {
    if (!newFrameState.isAutoAdvancing && !currentStep.advanceWhen.disableAutoAdvance) {
      if (currentStep.advanceWhen.delayMs) {
        newFrameState.timeoutId = setTimeout(
          () => advanceTour(tourStore, callbackArgsRef.current),
          currentStep.advanceWhen.delayMs
        );
      } else {
        advanceTour(tourStore, callbackArgs);
      }
      newFrameState.isAutoAdvancing = true;
    }

    if (currentStep.advanceWhen.gateNext) {
      setTourReady(tourStore, true, callbackArgs);
    }
  }

  // unfocus if next and can't find element, stay on prev highlight
  if (!highlightElement && selector) {
    if (
      (newFrameState.highlightTargetStatus === 'searching' || newFrameState.highlightTargetStatus === 'found') &&
      tourStore.getFocused()
    ) {
      unfocusTour(tourStore, callbackArgs);
    }
    if (newFrameState.highlightTargetStatus === 'found') newFrameState.highlightTargetStatus = 'lost';
    else newFrameState.highlightTargetStatus = 'waiting-for-highlight-target';
  }

  if (
    highlightElement &&
    (newFrameState.highlightTargetStatus === 'searching' ||
      newFrameState.highlightTargetStatus === 'waiting-for-highlight-target')
  ) {
    newFrameState.highlightTargetStatus = 'found';
    focusTour(tourStore, callbackArgs);
  }

  tourStore.setHighlightedElementRect(highlightElement);

  return newFrameState;
}

export function rafLoop<TStep extends WaymarkStep>(tourFrame: Omit<TourState<TStep>, 'frameState'>) {
  const tick = () => {
    const newFrameState = runTourFrame({ ...tourFrame, frameState: tourFrame.tourStore.frameState });
    const frameId = requestAnimationFrame(tick);
    tourFrame.tourStore.setFrameState({ ...newFrameState, frameId });
  };
  tick();
  return () => {
    tourFrame.tourStore.disposeFrameState();
  };
}
