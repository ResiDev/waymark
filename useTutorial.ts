import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createTourStore, tourStores } from './store';
import type { TourCallbackContext, TourCallbacks, TutorialStep } from './types';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useTutorial({
  id,
  active,
  steps,
  callbacks,
  onCancel,
}: {
  id: string;
  active: boolean;
  steps: Array<TutorialStep>;
  callbacks?: TourCallbacks;
  onCancel: () => void;
}) {
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const finished = useRef<boolean>(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const tourStore = useMemo(() => {
    const foundStore = tourStores.get(id);
    if (!foundStore) return createTourStore(id);
    return foundStore;
  }, [id]);

  const step = useSyncExternalStore(tourStore.subscribe, tourStore.getStep, () => 0);
  const focused = useSyncExternalStore(tourStore.subscribe, tourStore.getFocused, () => false);

  const currentStep = steps.at(step);

  const selector =
    currentStep && 'dataTour' in currentStep ? `[data-tour=${currentStep.dataTour}]` : currentStep?.selector;
  if (currentStep && !selector) throw new Error(`No selector found for currentStep ${JSON.stringify(currentStep)}`);

  const callbackContext: TourCallbackContext = useMemo(
    () => ({
      stepIndex: step,
      currentStep,
      targetSelector: selector,
    }),
    [step, currentStep, selector]
  );

  useLayoutEffect(() => {
    tourStore.setReady(!currentStep?.advanceWhen?.gateNext);
  }, [currentStep, tourStore]);

  useEffect(() => {
    if (step >= steps.length && !finished.current) {
      if (callbacks?.onFinish) callbacks.onFinish(callbackContext);
      finished.current = true;
    }
  }, [step, steps.length, callbacks, callbackContext]);

  const next = useCallback(() => {
    tourStore.advance();
    callbacks?.onAdvance?.(callbackContext);
    currentStep?.callbacks?.onAdvance?.(callbackContext);
  }, [tourStore, callbacks, currentStep?.callbacks, callbackContext]);
  const prev = useCallback(() => {
    tourStore.prev();
    callbacks?.onPrev?.(callbackContext);
    currentStep?.callbacks?.onPrev?.(callbackContext);
  }, [tourStore, callbacks, currentStep?.callbacks, callbackContext]);
  const focus = useCallback(() => {
    tourStore.focus();
    callbacks?.onFocus?.(callbackContext);
    currentStep?.callbacks?.onFocus?.(callbackContext);
  }, [tourStore, callbacks, currentStep?.callbacks, callbackContext]);
  const unfocus = useCallback(() => {
    tourStore.unfocus();
    callbacks?.onUnfocus?.(callbackContext);
    currentStep?.callbacks?.onUnfocus?.(callbackContext);
  }, [tourStore, callbacks, currentStep?.callbacks, callbackContext]);
  const reset = useCallback(() => {
    tourStore.reset();
    callbacks?.onReset?.(callbackContext);
  }, [tourStore, callbacks, callbackContext]);
  const cancel = useCallback(() => {
    onCancel();
    callbacks?.onCancel?.(callbackContext);
    currentStep?.callbacks?.onCancel?.(callbackContext);
  }, [onCancel, callbacks, currentStep?.callbacks, callbackContext]);
  const setReady = useCallback(
    (readyVal: boolean) => {
      tourStore.setReady(readyVal);
      if (readyVal) callbacks?.onReady?.(callbackContext);
    },
    [tourStore, callbacks, callbackContext]
  );

  const updateHighlight = useCallback(
    (element: Element | null) => {
      if (!element) return;
      setHighlight(element.getBoundingClientRect());
    },
    [setHighlight]
  );

  // Capture the user's focused element when the tour starts so we can
  // restore it when the tour deactivates (e.g. they were typing in an input).
  useLayoutEffect(() => {
    if (active) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [active]);

  // Move focus into the popover when a new step renders or the user re-opens
  // from the beacon. hasHighlight handles initial mount: highlight starts null
  // until the RAF loop measures the target, so the popover doesn't exist yet.
  // Once highlight is set the popover renders and this effect re-fires to focus it.
  const hasHighlight = highlight !== null;
  useEffect(() => {
    if (!hasHighlight || !focused || !active) return;
    const frameId = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-tour-popover]')?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [step, focused, active, hasHighlight]);

  useLayoutEffect(() => {
    if (!currentStep || !active || !selector) return;

    let frameId: number;
    // Prevent next from being called multiple times by raf loop
    let advancing = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    // Track which element has ARIA attributes so we can clean them up on change
    let decoratedElement: Element | null = null;

    // raf loop to detect: if we have the right highlightElement, if the condition is completed, if it is in view
    const update = () => {
      const highlightElement = tourStore.getHighlightedElement();

      if (!highlightElement || !highlightElement.isConnected) {
        tourStore.setHighlightedElement(document, selector);
      }

      // Mark the target element so screen readers announce it has an associated dialog
      if (highlightElement !== decoratedElement) {
        decoratedElement?.removeAttribute('aria-haspopup');
        decoratedElement?.removeAttribute('aria-expanded');
        if (highlightElement) {
          highlightElement.setAttribute('aria-haspopup', 'dialog');
          highlightElement.setAttribute('aria-expanded', 'true');
        }
        decoratedElement = highlightElement;
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          unfocus();
          break;
        case 'ArrowRight': {
          const { activeElement } = document;
          const isEditable =
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement ||
            activeElement instanceof HTMLSelectElement ||
            (activeElement instanceof HTMLElement && activeElement.isContentEditable);
          if (!isEditable && tourStore.ready) {
            e.preventDefault();
            next();
          }
          break;
        }
        case 'ArrowLeft': {
          const { activeElement } = document;
          const isEditable =
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement ||
            activeElement instanceof HTMLSelectElement ||
            (activeElement instanceof HTMLElement && activeElement.isContentEditable);
          if (!isEditable) {
            e.preventDefault();
            prev();
          }
          break;
        }
        case 'Tab': {
          const popover = document.querySelector<HTMLElement>('[data-tour-popover]');
          const highlightEl = tourStore.getHighlightedElement();
          if (!popover) break;

          const focusables = [
            ...Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
            ...(highlightEl instanceof HTMLElement
              ? [
                  ...(highlightEl.matches(FOCUSABLE_SELECTOR) ? [highlightEl] : []),
                  ...Array.from(highlightEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
                ]
              : []),
          ];

          if (focusables.length === 0) break;

          e.preventDefault();
          const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);

          if (e.shiftKey) {
            focusables[currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1].focus();
          } else {
            focusables[currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1].focus();
          }
          break;
        }
      }
    };

    // true added so that it fires on capture, rather than on bubble (so before react can swap dom nodes)
    window.addEventListener('click', handleWindowClick, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      decoratedElement?.removeAttribute('aria-haspopup');
      decoratedElement?.removeAttribute('aria-expanded');
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleWindowClick, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentStep, next, prev, setReady, unfocus, callbacks, active, updateHighlight, focused, tourStore, selector]);

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
    cancel,
  };
}
