import type { TutorialStep, TutorialStore } from '../types';
import { advanceTour, focusTour, setTourReady, unfocusTour } from './storeHelpers';
import type { CallbackArgs } from './storeHelpers';

type TourFrame = {
  tourStore: TutorialStore;
  selector: string | undefined;
  currentStep: TutorialStep;
  queryRoot: Document | Element;
  callbackArgs: CallbackArgs;
  updateHighlight: (element: Element | null) => void;
};

export function runTourFrame({
  tourStore,
  selector,
  currentStep,
  queryRoot,
  callbackArgs,
  updateHighlight,
}: TourFrame) {
  const newFrameState = { ...tourStore.frameState };
  console.log('frameState', newFrameState);
  let highlightElement = tourStore.getHighlightedElement();

  // find highlight element
  if ((!highlightElement || !highlightElement.isConnected) && selector) {
    tourStore.setHighlightedElement(queryRoot, selector);
    highlightElement = tourStore.getHighlightedElement();
  }

  // unfocus if next and can't find element, stay on prev highlight
  if (!highlightElement && selector) {
    if (newFrameState.highlightTargetStatus === 'searching') {
      if (tourStore.getFocused()) unfocusTour(tourStore, callbackArgs);
      newFrameState.highlightTargetStatus = 'waiting-for-highlight-target';
    }
    return newFrameState;
  }

  if (
    highlightElement &&
    (newFrameState.highlightTargetStatus === 'searching' ||
      newFrameState.highlightTargetStatus === 'waiting-for-highlight-target')
  ) {
    newFrameState.highlightTargetStatus = 'found';
    focusTour(tourStore, callbackArgs);
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

  updateHighlight(highlightElement);

  return newFrameState;
}

export function rafLoop(tourFrame: TourFrame) {
  const tick = () => {
    const newFrameState = runTourFrame(tourFrame);
    const frameId = requestAnimationFrame(tick);
    newFrameState.frameId = frameId;
    tourFrame.tourStore.setFrameState(newFrameState);
  };
  tick();
  return () => {
    tourFrame.tourStore.disposeFrameState();
  };
}
