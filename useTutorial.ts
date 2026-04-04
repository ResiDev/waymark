import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { tutorialStore } from './store';
import type { TutorialStep } from './types';

export function useTutorial({ active, steps }: { active: boolean; steps: Array<TutorialStep> }) {
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const step = useSyncExternalStore(tutorialStore.subscribe, tutorialStore.getStep, () => 0);
  const focused = useSyncExternalStore(tutorialStore.subscribe, tutorialStore.getFocused, () => false);

  const currentStep: TutorialStep | undefined = steps[step];

  const next = useCallback(() => {
    tutorialStore.advance();
  }, []);

  const updateHighlight = useCallback(
    (element: Element) => {
      setHighlight(element.getBoundingClientRect());
    },
    [setHighlight]
  );

  useLayoutEffect(() => {
    if (!currentStep || !active) return;

    let highlightElement: Element | null = document.querySelector(`[data-tour=${currentStep.highlightName}]`);

    let frameId: number;
    let advancing = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      highlightElement = document.querySelector(`[data-tour=${currentStep.highlightName}]`);
      if (highlightElement) {
        if (!advancing && currentStep.advanceWhen.type === 'state' && currentStep.advanceWhen.check()) {
          advancing = true;
          if (currentStep.delay) timeoutId = setTimeout(() => next(), currentStep.delay);
          else next();
        }
        updateHighlight(highlightElement);
      }
      frameId = requestAnimationFrame(update);
    };
    update();
    clearTimeout(timeoutId);

    if (highlightElement && currentStep.scrollIntoView)
      highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const handleWindowClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.isConnected) return;
      if (e.target.closest(`[data-tour=${currentStep.highlightName}]`)) {
        if (currentStep.advanceWhen.type === 'click') next();
        return;
      }
      if (e.target.closest('[data-tour-popover]')) return;
      if (e.target.closest('[data-tour-beacon]')) return;
      tutorialStore.unfocus();
    };

    // true added so that it fires on capture, rather than on bubble (so before react can swap dom nodes)
    window.addEventListener('click', handleWindowClick, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('click', handleWindowClick, true);
    };
  }, [currentStep, active, next, updateHighlight]);

  if (!active || !highlight || !currentStep) return { highlight: undefined };

  return {
    step,
    currentStep,
    highlight,
    next,
    prev: tutorialStore.prev,
    focused,
    focus: tutorialStore.focus,
    unfocus: tutorialStore.unfocus,
    reset: tutorialStore.reset,
  };
}
