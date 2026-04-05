import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createTourStore, tourStores } from './store';
import type { TourCallbacks, TutorialStep } from './types';

export function useTutorial({
  id,
  active,
  steps,
  callbacks,
}: {
  id: string;
  active: boolean;
  steps: Array<TutorialStep>;
  callbacks?: TourCallbacks;
}) {
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const finished = useRef<boolean>(false);

  const tourStore = useMemo(() => {
    const foundStore = tourStores.get(id);
    if (!foundStore) return createTourStore(id);
    return foundStore;
  }, [id]);

  const step = useSyncExternalStore(tourStore.subscribe, tourStore.getStep, () => 0);
  const focused = useSyncExternalStore(tourStore.subscribe, tourStore.getFocused, () => false);

  const currentStep = steps.at(step);

  useLayoutEffect(() => {
    tourStore.setReady(!currentStep?.advanceWhen?.gateNext);
  }, [currentStep, tourStore]);

  useEffect(() => {
    if (step >= steps.length && !finished.current) {
      if (callbacks?.onFinish) callbacks.onFinish();
      finished.current = true;
    }
  }, [step, steps.length, callbacks]);

  const next = useCallback(() => {
    tourStore.advance(callbacks?.onAdvance);
  }, [tourStore, callbacks?.onAdvance]);
  const prev = useCallback(() => {
    tourStore.prev(callbacks?.onPrev);
  }, [tourStore, callbacks?.onPrev]);
  const focus = useCallback(() => {
    tourStore.focus(callbacks?.onFocus);
  }, [tourStore, callbacks?.onFocus]);
  const unfocus = useCallback(() => {
    tourStore.unfocus(callbacks?.onUnfocus);
  }, [tourStore, callbacks?.onUnfocus]);
  const reset = useCallback(() => {
    tourStore.reset(callbacks?.onReset);
  }, [tourStore, callbacks?.onReset]);
  const setReady = useCallback(
    (readyVal: boolean) => {
      tourStore.setReady(readyVal, callbacks?.onReady);
    },
    [tourStore, callbacks?.onReady]
  );

  const selector =
    currentStep && 'dataTour' in currentStep ? `[data-tour=${currentStep.dataTour}` : currentStep?.selector;
  if (currentStep && !selector) throw new Error(`No selector found for currentStep ${JSON.stringify(currentStep)}`);

  const updateHighlight = useCallback(
    (element: Element | null) => {
      if (!element) return;
      setHighlight(element.getBoundingClientRect());
    },
    [setHighlight]
  );

  useLayoutEffect(() => {
    if (!currentStep || !active || !selector) return;

    let frameId: number;
    // Prevent next from being called multiple times by raf loop
    let advancing = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // raf loop to detect: if we have the right highlightElement, if the condition is completed, if it is in view
    const update = () => {
      const highlightElement = tourStore.getHighlightedElement();

      if (!highlightElement || !highlightElement.isConnected) {
        tourStore.setHighlightedElement(document, selector);
      }
      if (highlightElement && focused) {
        if (!tourStore.highlightElementIsInView && currentStep.scrollIntoView) {
          highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // detect state change for auto advance tour
        if (currentStep.advanceWhen?.type === 'state' && currentStep.advanceWhen.check(highlightElement)) {
          if (!advancing && !currentStep.advanceWhen.disableAutoAdvance) {
            advancing = true;
            if (currentStep.delay) timeoutId = setTimeout(() => next(), currentStep.delay);
            else next();
          }

          if (currentStep.advanceWhen.gateNext) {
            setReady(true);
          }
        }
      }
      updateHighlight(highlightElement);
      frameId = requestAnimationFrame(update);
    };

    update();
    clearTimeout(timeoutId);

    const handleWindowClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.isConnected) return;
      if (e.target.closest(selector)) {
        if (currentStep.advanceWhen?.type === 'click' && currentStep.advanceWhen.gateNext) setReady(true);
        if (currentStep.advanceWhen?.type === 'click' && !currentStep.advanceWhen.disableAutoAdvance) next();
        return;
      }
      if (e.target.closest('[data-tour-popover]')) return;
      if (e.target.closest('[data-tour-beacon]')) return;
      if (e.target.closest('[role="dialog"], [data-popover], [data-slot="select-positioner"]')) return;
      unfocus();
    };

    // true added so that it fires on capture, rather than on bubble (so before react can swap dom nodes)
    window.addEventListener('click', handleWindowClick, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('click', handleWindowClick, true);
    };
  }, [currentStep, next, setReady, unfocus, callbacks, active, updateHighlight, focused, tourStore, selector]);

  if (!active || !highlight || !currentStep) return { highlight: undefined };

  return {
    step,
    currentStep,
    highlight,
    callbacks,
    ready: tourStore.ready,
    next,
    prev,
    focused,
    focus,
    unfocus,
    reset,
  };
}
