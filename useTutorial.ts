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

  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.advanceWhen.type === 'state' && currentStep.advanceWhen.check()) {
      next();
    }
  }, [currentStep, next]);

  useLayoutEffect(() => {
    if (!currentStep || !active) return;
    const highlightElement = document.querySelector(`[data-tutorial-highlight=${currentStep.highlightName}]`);
    if (!highlightElement) {
      console.error(`Did not find highlightElement ${currentStep.highlightName}`);
      return;
    }
    if (currentStep.scrollIntoView) highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const handleWindowClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.isConnected) return;
      if (highlightElement.contains(e.target)) {
        if (currentStep.advanceWhen.type === 'click') next();
        return;
      }
      if (e.target.closest('[data-tutorial-popover]')) return;
      if (e.target.closest('[data-tutorial-beacon]')) return;
      tutorialStore.unfocus();
    };

    window.addEventListener('click', handleWindowClick);

    let frameId: number;
    const update = () => {
      updateHighlight(highlightElement);
      frameId = requestAnimationFrame(update);
    };
    update();

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
