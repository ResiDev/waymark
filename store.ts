import type { FrameState, TutorialStore } from './types';

export const tourStores = new Map<string, TutorialStore>();

const initialFrameState = (): FrameState => ({
  isAutoAdvancing: false,
  scrolledIntoViewOnce: false,
  ariaAnnotatedElement: null,
  timeoutId: undefined,
  highlightTargetStatus: 'searching',
  frameId: undefined,
});

export function createTourStore(id: string) {
  const tourStore: TutorialStore = {
    step: 0,
    active: false,
    ready: true,
    focused: true,
    listeners: new Set<() => void>(),
    highlightedElement: null,
    highlightElementIsInView: false,
    highlightedElementRect: null,
    observer: null as IntersectionObserver | null,
    frameState: initialFrameState(),
    getObserver: () => {
      if (!tourStore.observer && typeof IntersectionObserver !== 'undefined') {
        tourStore.observer = new IntersectionObserver(([entry]) => {
          tourStore.highlightElementIsInView = entry.isIntersecting;
        });
      }
      return tourStore.observer;
    },
    getStep: () => tourStore.step,
    getFocused: () => tourStore.focused,
    getHighlightedElement: () => tourStore.highlightedElement,
    setHighlightedElement: (document: Element | Document, selector: string) => {
      const el = document.querySelector(selector);
      if (tourStore.highlightedElement) {
        tourStore.getObserver()?.unobserve(tourStore.highlightedElement);
      }
      tourStore.highlightedElement = el;
      if (el) {
        tourStore.getObserver()?.observe(el);
      }
    },
    getHighlightedElementRect: () => tourStore.highlightedElementRect,
    setHighlightedElementRect: (element) => {
      if (!element) return;
      const nextRect = element.getBoundingClientRect();
      const prevRect = tourStore.highlightedElementRect;
      if (
        prevRect &&
        prevRect.x === nextRect.x &&
        prevRect.y === nextRect.y &&
        prevRect.width === nextRect.width &&
        prevRect.height === nextRect.height
      ) {
        return;
      }
      tourStore.highlightedElementRect = nextRect;
      tourStore.listeners.forEach((cb) => cb());
    },
    getReady: () => tourStore.ready,
    setReady: (ready: boolean) => {
      tourStore.ready = ready;
    },
    setFrameState: (nextFrameState) => (tourStore.frameState = nextFrameState),
    disposeFrameState: () => {
      if (tourStore.frameState.frameId !== undefined) cancelAnimationFrame(tourStore.frameState.frameId);
      if (tourStore.frameState.timeoutId !== undefined) clearTimeout(tourStore.frameState.timeoutId);
      tourStore.frameState.ariaAnnotatedElement?.removeAttribute('aria-haspopup');
      tourStore.frameState.ariaAnnotatedElement?.removeAttribute('aria-expanded');
      tourStore.frameState = initialFrameState();
    },
    subscribe: (callback: () => void) => {
      tourStore.listeners.add(callback);
      return () => tourStore.listeners.delete(callback);
    },
    focus: () => {
      tourStore.focused = true;
      tourStore.listeners.forEach((cb) => cb());
    },
    unfocus: () => {
      tourStore.focused = false;
      tourStore.listeners.forEach((cb) => cb());
    },
    prev: () => {
      if (tourStore.step > 0) {
        tourStore.step -= 1;
        tourStore.focused = true;
        tourStore.highlightedElement = null;
        tourStore.disposeFrameState();
        tourStore.listeners.forEach((cb) => cb());
      }
    },
    advance: () => {
      tourStore.step += 1;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      tourStore.disposeFrameState();
      tourStore.listeners.forEach((cb) => cb());
    },
    reset: () => {
      tourStore.step = 0;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      tourStore.disposeFrameState();
      tourStore.listeners.forEach((cb) => cb());
    },
  };
  tourStores.set(id, tourStore);
  return tourStore;
}
