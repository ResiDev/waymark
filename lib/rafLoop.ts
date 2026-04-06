import type { FrameState, TutorialStep, TutorialStore } from '../types';
import { advanceTour, focusTour, setTourReady, unfocusTour } from './storeHelpers';
import type { CallbackArgs } from './storeHelpers';

type TourState = {
  tourStore: TutorialStore;
  selector: string | undefined;
  currentStep: TutorialStep;
  queryRoot: Document | Element;
  callbackArgs: CallbackArgs;
  frameState: FrameState;
};

export function runTourFrame({ tourStore, frameState, selector, currentStep, queryRoot, callbackArgs }: TourState) {
  const newFrameState = { ...frameState };
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
    if (!tourStore.highlightElementIsInView && currentStep.scrollIntoView !== 'never') {
      if (currentStep.scrollIntoView === 'always' || !newFrameState.scrolledIntoViewOnce) {
        highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      newFrameState.scrolledIntoViewOnce = true;
    }
  }

  // detect state change for auto advance tour
  if (currentStep.advanceWhen?.type === 'state' && currentStep.advanceWhen.check(highlightElement ?? undefined)) {
    if (!newFrameState.isAutoAdvancing && !currentStep.advanceWhen.disableAutoAdvance) {
      if (currentStep.advanceWhen.delayMs) {
        newFrameState.timeoutId = setTimeout(
          () => advanceTour(tourStore, callbackArgs),
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
      console.log('auto unfocus', newFrameState.highlightTargetStatus);
      unfocusTour(tourStore, callbackArgs);
    }
    if (newFrameState.highlightTargetStatus === 'found') newFrameState.highlightTargetStatus = 'lost';
    else newFrameState.highlightTargetStatus = 'waiting-for-highlight-target';
    return newFrameState;
  }

  if (
    highlightElement &&
    (newFrameState.highlightTargetStatus === 'searching' ||
      newFrameState.highlightTargetStatus === 'waiting-for-highlight-target')
  ) {
    console.log('found the element now', newFrameState.highlightTargetStatus);
    newFrameState.highlightTargetStatus = 'found';
    focusTour(tourStore, callbackArgs);
  }

  tourStore.setHighlightedElementRect(highlightElement);

  return newFrameState;
}

export function rafLoop(tourFrame: Omit<TourState, 'frameState'>) {
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
