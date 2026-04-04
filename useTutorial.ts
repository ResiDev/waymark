import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createTourStore, tourStores } from './store';
import type { TutorialStep } from './types';

export function useTutorial({ id, active, steps }: { id: string; active: boolean; steps: Array<TutorialStep> }) {
  const [highlight, setHighlight] = useState<DOMRect | null>(null);

  const tourStore = useMemo(() => {
    const foundStore = tourStores.get(id);
    if (!foundStore) return createTourStore(id);
    return foundStore;
  }, [id]);

  const step = useSyncExternalStore(tourStore.subscribe, tourStore.getStep, () => 0);
  const focused = useSyncExternalStore(tourStore.subscribe, tourStore.getFocused, () => false);

  const currentStep = steps.at(step);

  const updateHighlight = useCallback(
    (element: Element | null) => {
      if (!element) return;
      setHighlight(element.getBoundingClientRect());
    },
    [setHighlight]
  );

  useLayoutEffect(() => {
    if (!currentStep || !active) return;

    let frameId: number;
    // Prevent next from being called multiple times by raf loop
    let advancing = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // raf loop to detect: if we have the right highlightElement, if the condition is completed, if it is in view
    const update = () => {
      const highlightElement = tourStore.getHighlightedElement();

      if (!highlightElement || !highlightElement.isConnected) {
        tourStore.setHighlightedElement(
          document,
          'dataTour' in currentStep ? currentStep.dataTour : currentStep.selector
        );
      }
      if (highlightElement && focused) {
        if (!tourStore.highlightElementIsInView) {
          highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // detect state change for auto advance tour
        if (!advancing && currentStep.advanceWhen.type === 'state' && currentStep.advanceWhen.check(highlightElement)) {
          advancing = true;
          if (currentStep.delay) timeoutId = setTimeout(() => tourStore.advance(), currentStep.delay);
          else tourStore.advance();
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
      if (e.target.closest(`[data-tour=${currentStep.highlightName}]`)) {
        if (currentStep.advanceWhen.type === 'click') tourStore.advance();
        return;
      }
      if (e.target.closest('[data-tour-popover]')) return;
      if (e.target.closest('[data-tour-beacon]')) return;
      tourStore.unfocus();
    };

    // true added so that it fires on capture, rather than on bubble (so before react can swap dom nodes)
    window.addEventListener('click', handleWindowClick, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('click', handleWindowClick, true);
    };
  }, [currentStep, active, updateHighlight, focused, tourStore]);

  if (!active || !highlight || !currentStep) return { highlight: undefined };

  return {
    step,
    currentStep,
    highlight,
    next: tourStore.advance,
    prev: tourStore.prev,
    focused,
    focus: tourStore.focus,
    unfocus: tourStore.unfocus,
    reset: tourStore.reset,
  };
}
