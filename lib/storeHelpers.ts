import type { TourCallbackContext, TourCallbacks, StepCallbacks, TutorialStore } from '../types';

export type CallbackArgs = {
  tourCallbacks: TourCallbacks | undefined;
  stepCallbacks: StepCallbacks | undefined;
  context: TourCallbackContext;
};

export function advanceTour(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs) {
  store.advance();
  tourCallbacks?.onAdvance?.(context);
  stepCallbacks?.onAdvance?.(context);
}

export function prevTour(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs) {
  store.prev();
  tourCallbacks?.onPrev?.(context);
  stepCallbacks?.onPrev?.(context);
}

export function focusTour(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs) {
  store.focus();
  tourCallbacks?.onFocus?.(context);
  stepCallbacks?.onFocus?.(context);
}

export function unfocusTour(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs) {
  console.log('unfocus');
  store.unfocus();
  tourCallbacks?.onUnfocus?.(context);
  stepCallbacks?.onUnfocus?.(context);
}

export function resetTour(store: TutorialStore, { tourCallbacks, context }: Omit<CallbackArgs, 'stepCallbacks'>) {
  store.reset();
  tourCallbacks?.onReset?.(context);
}

export function cancelTour(onCancel: () => void, { tourCallbacks, stepCallbacks, context }: CallbackArgs) {
  onCancel();
  tourCallbacks?.onCancel?.(context);
  stepCallbacks?.onCancel?.(context);
}

export function setTourReady(
  store: TutorialStore,
  ready: boolean,
  { tourCallbacks, context }: Omit<CallbackArgs, 'stepCallbacks'>
) {
  store.setReady(ready);
  if (ready) tourCallbacks?.onReady?.(context);
}
