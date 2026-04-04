import type { TutorialStore } from './types';

export const tourStores = new Map<string, TutorialStore>();

export function createTourStore(id: string) {
  const tourStore: TutorialStore = {
    step: 0,
    active: false,
    focused: true,
    listeners: new Set<() => void>(),
    highlightedElement: null,
    highlightElementIsInView: false,
    observer: new IntersectionObserver(([entry]) => {
      tourStore.highlightElementIsInView = entry.isIntersecting;
    }),
    getStep: () => tourStore.step,
    getFocused: () => tourStore.focused,
    getHighlightedElement: () => tourStore.highlightedElement,
    setHighlightedElement: (document: Element | Document, name: string) => {
      const el = document.querySelector(`[data-tour=${name}]`);
      if (tourStore.highlightedElement) {
        tourStore.observer.unobserve(tourStore.highlightedElement);
      }
      tourStore.highlightedElement = el;
      if (el) tourStore.observer.observe(el);
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
        tourStore.listeners.forEach((cb) => cb());
      }
    },
    advance: () => {
      tourStore.step += 1;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      tourStore.listeners.forEach((cb) => cb());
    },
    reset: () => {
      tourStore.step = 0;
      tourStore.focused = true;
      tourStore.highlightedElement = null;
      tourStore.listeners.forEach((cb) => cb());
    },
  };
  tourStores.set(id, tourStore);
  return tourStore;
}
