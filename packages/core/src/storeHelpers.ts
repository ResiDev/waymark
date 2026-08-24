import type { TourCallbackContext, TourCallbacks, StepCallbacks, TutorialStore, WaymarkStep } from './index';

export type CallbackArgs<TStep extends WaymarkStep = WaymarkStep> = {
  tourCallbacks: TourCallbacks<TStep> | undefined;
  stepCallbacks: StepCallbacks<TStep> | undefined;
  context: TourCallbackContext<TStep>;
};

export function advanceTour<TStep extends WaymarkStep>(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs<TStep>) {
  store.advance();
  tourCallbacks?.onAdvance?.(context);
  stepCallbacks?.onAdvance?.(context);
}

export function prevTour<TStep extends WaymarkStep>(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs<TStep>) {
  store.prev();
  tourCallbacks?.onPrev?.(context);
  stepCallbacks?.onPrev?.(context);
}

export function focusTour<TStep extends WaymarkStep>(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs<TStep>) {
  store.focus();
  tourCallbacks?.onFocus?.(context);
  stepCallbacks?.onFocus?.(context);
}

export function unfocusTour<TStep extends WaymarkStep>(store: TutorialStore, { tourCallbacks, stepCallbacks, context }: CallbackArgs<TStep>) {
  store.unfocus();
  tourCallbacks?.onUnfocus?.(context);
  stepCallbacks?.onUnfocus?.(context);
}

export function resetTour<TStep extends WaymarkStep>(store: TutorialStore, { tourCallbacks, context }: Omit<CallbackArgs<TStep>, 'stepCallbacks'>) {
  store.reset();
  tourCallbacks?.onReset?.(context);
}

export function exitTour<TStep extends WaymarkStep>(onExit: () => void, { tourCallbacks, stepCallbacks, context }: CallbackArgs<TStep>) {
  onExit();
  tourCallbacks?.onExit?.(context);
  stepCallbacks?.onExit?.(context);
}

export function setTourReady<TStep extends WaymarkStep>(
  store: TutorialStore,
  ready: boolean,
  { tourCallbacks, context }: Omit<CallbackArgs<TStep>, 'stepCallbacks'>
) {
  store.setReady(ready);
  if (ready) tourCallbacks?.onReady?.(context);
}
