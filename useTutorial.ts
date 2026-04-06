import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createTourStore, tourStores } from './store';
import { advanceTour, cancelTour, focusTour, prevTour, resetTour, unfocusTour } from './lib/storeHelpers';
import type { TourCallbackContext, TourCallbacks, TutorialStep } from './types';
import { rafLoop } from './lib/rafLoop';
import { handleTutorialClick, handleTutorialKeyDown } from './lib/handlers';

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
  const finished = useRef<boolean>(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const tourStore = useMemo(() => {
    const foundStore = tourStores.get(id);
    if (!foundStore) return createTourStore(id);
    return foundStore;
  }, [id]);

  const step = useSyncExternalStore(tourStore.subscribe, tourStore.getStep, () => 0);
  const focused = useSyncExternalStore(tourStore.subscribe, tourStore.getFocused, () => false);
  const highlight = useSyncExternalStore(tourStore.subscribe, tourStore.getHighlightedElementRect, () => null);

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
    if (tourStore.frameState.highlightTargetStatus === 'waiting-for-highlight-target') {
      prev();
      tourStore.setFrameState({ ...tourStore.frameState, highlightTargetStatus: 'found' });
    }
    focusTour(tourStore, cbArgs);
  }, [tourStore, cbArgs, prev]);
  const unfocus = useCallback(() => unfocusTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const reset = useCallback(() => resetTour(tourStore, cbArgs), [tourStore, cbArgs]);
  const cancel = useCallback(() => cancelTour(onCancel, cbArgs), [onCancel, cbArgs]);

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
    return rafLoop({
      tourStore,
      selector,
      currentStep,
      queryRoot: document,
      callbackArgs: cbArgs,
    });
  }, [currentStep, active, tourStore, selector, cbArgs]);

  const onWindowClick = useEffectEvent((e: MouseEvent) => {
    if (!currentStep) return;
    handleTutorialClick(e, { tourStore, currentStep, selector, callbackArgs: cbArgs });
  });

  const onWindowKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!currentStep) return;
    handleTutorialKeyDown(e, { tourStore, currentStep, selector, callbackArgs: cbArgs });
  });

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    const { signal } = controller;

    // capture: true so it fires before react can swap dom nodes
    window.addEventListener('click', onWindowClick, { capture: true, signal });
    window.addEventListener('keydown', onWindowKeyDown, { signal });

    return () => controller.abort();
  }, [active]);

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
