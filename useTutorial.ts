import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createTourStore, tourStores } from './store';
import { advanceTour, cancelTour, focusTour, prevTour, resetTour, setTourReady, unfocusTour } from './lib/storeHelpers';
import { type FrameState, runTourFrame } from './lib/rafLoop';
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
  const unfocusedBecauseHighlightNotFound = useRef(false);

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

  const cbArgs = useMemo(
    () => ({ tourCallbacks: callbacks, stepCallbacks: currentStep?.callbacks, context: callbackContext }),
    [callbacks, currentStep?.callbacks, callbackContext]
  );

  const next = useCallback(() => advanceTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const prev = useCallback(() => prevTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const focus = useCallback(() => {
    if (unfocusedBecauseHighlightNotFound.current) {
      prev();
      unfocusedBecauseHighlightNotFound.current = false;
    }
    focusTour(tourStore, cbArgs);
  }, [tourStore, cbArgs, prev, unfocusedBecauseHighlightNotFound]);
  const unfocus = useCallback(() => unfocusTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const reset = useCallback(() => resetTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const cancel = useCallback(() => cancelTour(onCancel, cbArgs), [onCancel, cbArgs]);
  const setReady = useCallback(
    (readyVal: boolean) => setTourReady(tourStore, readyVal, cbArgs),
    [tourStore, cbArgs]
  );

  const updateHighlight = useCallback(
    (element: Element | null) => {
      // don't set highlight to null so that it activates beacon, beacon can recover to last step through focus()
      if (element) setHighlight(element.getBoundingClientRect());
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
    if (!currentStep || !active) return;

    let frameId: number;
    let currentFrameState: FrameState = {
      isAutoAdvancing: false,
      scrolledIntoViewOnce: false,
      ariaAnnotatedElement: null,
      timeoutId: undefined,
      highlightTargetStatus: 'stable',
    };

    const update = () => {
      currentFrameState = runTourFrame({
        tourStore,
        selector,
        focused,
        currentStep,
        frameState: currentFrameState,
        queryRoot: document,
        callbackArgs: cbArgs,
        updateHighlight,
      });
      unfocusedBecauseHighlightNotFound.current =
        currentFrameState.highlightTargetStatus === 'waiting-for-highlight-target';

      frameId = requestAnimationFrame(update);
    };

    update();

    const handleWindowClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.isConnected) return;
      if (selector && e.target.closest(selector)) {
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
      currentFrameState.ariaAnnotatedElement?.removeAttribute('aria-haspopup');
      currentFrameState.ariaAnnotatedElement?.removeAttribute('aria-expanded');
      cancelAnimationFrame(frameId);
      if (currentFrameState.timeoutId) clearTimeout(currentFrameState.timeoutId);
      unfocusedBecauseHighlightNotFound.current = false;
      window.removeEventListener('click', handleWindowClick, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentStep, next, prev, setReady, unfocus, active, updateHighlight, focused, tourStore, selector, cbArgs]);

  return {
    step,
    currentStep,
    highlight,
    callbacks,
    ready: tourStore.ready,
    selector,
    next,
    prev,
    focused,
    focus,
    unfocus,
    reset,
    cancel,
  };
}
