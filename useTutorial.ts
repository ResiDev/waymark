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

    let highlightElement: Element | null = document.querySelector(
      `[data-tutorial-highlight=${currentStep.highlightName}]`
    );

    let frameId: number;
    let advancing = false;
    const update = () => {
      if (!highlightElement) {
        highlightElement = document.querySelector(`[data-tutorial-highlight=${currentStep.highlightName}]`);
      } else {
        if (!advancing && currentStep.advanceWhen.type === 'state' && currentStep.advanceWhen.check()) {
          advancing = true;
          if (currentStep.delay) setTimeout(() => next(), currentStep.delay);
          else next();
        }
        updateHighlight(highlightElement);
      }
      frameId = requestAnimationFrame(update);
    };
    update();

    if (highlightElement && currentStep.scrollIntoView)
      highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const handleWindowClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.isConnected) return;
      if (highlightElement && highlightElement.contains(e.target)) {
        if (currentStep.advanceWhen.type === 'click') next();
        return;
      }
      if (e.target.closest('[data-tutorial-popover]')) return;
      if (e.target.closest('[data-tutorial-beacon]')) return;
      tutorialStore.unfocus();
    };

    window.addEventListener('click', handleWindowClick);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('click', handleWindowClick);
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
