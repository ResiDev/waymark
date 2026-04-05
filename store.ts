import type { TutorialStore } from './types';

export const tourStores = new Map<string, TutorialStore>();

export function createTourStore(id: string) {
  const tourStore: TutorialStore = {
    step: 0,
    active: false,
    ready: true,
    focused: true,
    listeners: new Set<() => void>(),
    highlightedElement: null,
    highlightElementIsInView: false,
    observer: null as IntersectionObserver | null,
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
      if (el) tourStore.getObserver()?.observe(el);
    },
    getReady: () => tourStore.ready,
    setReady: (ready: boolean, onReady) => {
      tourStore.ready = ready;
      if (ready && onReady) onReady();
    },
    subscribe: (callback: () => void) => {
      tourStore.listeners.add(callback);
      return () => tourStore.listeners.delete(callback);
    },
    focus: (onFocus) => {
      tourStore.focused = true;
      if (onFocus) onFocus();
      tourStore.listeners.forEach((cb) => cb());
    },
    unfocus: (onUnfocus) => {
      tourStore.focused = false;
      if (onUnfocus) onUnfocus();
      tourStore.listeners.forEach((cb) => cb());
    },
    prev: (onPrev) => {
      if (tourStore.step > 0) {
        tourStore.step -= 1;
        tourStore.focused = true;
        tourStore.highlightedElement = null;
        if (onPrev) onPrev();
        tourStore.listeners.forEach((cb) => cb());
      }
    },
    advance: (onAdvance) => {
      tourStore.step += 1;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      if (onAdvance) onAdvance();
      tourStore.listeners.forEach((cb) => cb());
    },
    reset: (onReset) => {
      tourStore.step = 0;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      if (onReset) onReset();
      tourStore.listeners.forEach((cb) => cb());
    },
  };
  tourStores.set(id, tourStore);
  return tourStore;
}
