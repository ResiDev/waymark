import type { TutorialStep, TutorialStore } from '../types';
import { advanceTour, focusTour, setTourReady, unfocusTour } from './storeHelpers';
import type { CallbackArgs } from './storeHelpers';

export type FrameState = {
  isAutoAdvancing: boolean;
  scrolledIntoViewOnce: boolean;
  ariaAnnotatedElement: Element | null;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
  highlightTargetStatus: 'stable' | 'waiting-for-highlight-target';
};

type TourFrame = {
  tourStore: TutorialStore;
  selector: string | undefined;
  focused: boolean;
  currentStep: TutorialStep;
  frameState: FrameState;
  queryRoot: Document | Element;
  callbackArgs: CallbackArgs;
  updateHighlight: (element: Element | null) => void;
};

export function runTourFrame({
  tourStore,
  selector,
  focused,
  currentStep,
  frameState,
  queryRoot,
  callbackArgs,
  updateHighlight,
}: TourFrame) {
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
  if (highlightElement && focused) {
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

  if (!highlightElement && selector) {
    if (tourStore.getFocused()) {
      unfocusTour(tourStore, callbackArgs);
      newFrameState.highlightTargetStatus = 'waiting-for-highlight-target';
    }
    return newFrameState;
  } else if (newFrameState.highlightTargetStatus === 'waiting-for-highlight-target') {
    newFrameState.highlightTargetStatus = 'stable';
    focusTour(tourStore, callbackArgs);
  }

  return newFrameState;
}

export function rafLoop(tourFrame: TourFrame) {
  let frameId: number;
  let currentFrameState = tourFrame.frameState;

  const tick = () => {
    currentFrameState = runTourFrame({ ...tourFrame, frameState: currentFrameState });
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frameId);
    if (currentFrameState.timeoutId) clearTimeout(currentFrameState.timeoutId);
  };
}
