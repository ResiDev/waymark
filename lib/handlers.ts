import type { TutorialStep, TutorialStore } from '../types';
import { advanceTour, prevTour, setTourReady, unfocusTour } from './storeHelpers';
import type { CallbackArgs } from './storeHelpers';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type TutorialEventContext = {
  tourStore: TutorialStore;
  currentStep: TutorialStep;
  selector: string | undefined;
  callbackArgs: CallbackArgs;
};

export function handleTutorialClick(e: MouseEvent, ctx: TutorialEventContext) {
  if (!(e.target instanceof Element)) return;
  if (!e.target.isConnected) return;
  if (ctx.selector && e.target.closest(ctx.selector)) {
    if (ctx.currentStep.advanceWhen?.type === 'click' && ctx.currentStep.advanceWhen.gateNext) {
      setTourReady(ctx.tourStore, true, ctx.callbackArgs);
    }
    if (ctx.currentStep.advanceWhen?.type === 'click' && !ctx.currentStep.advanceWhen.disableAutoAdvance) {
      advanceTour(ctx.tourStore, ctx.callbackArgs);
    }
    return;
  }
  if (e.target.closest('[data-tour-popover]')) return;
  if (e.target.closest('[data-tour-beacon]')) return;
  if (e.target.closest('[role="dialog"], [data-popover], [data-slot="select-positioner"]')) return;
  unfocusTour(ctx.tourStore, ctx.callbackArgs);
}

export function handleTutorialKeyDown(e: KeyboardEvent, ctx: TutorialEventContext) {
  if (!ctx.tourStore.getFocused()) return;

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      unfocusTour(ctx.tourStore, ctx.callbackArgs);
      break;
    case 'ArrowRight': {
      const { activeElement } = document;
      const isEditable =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      if (!isEditable && ctx.tourStore.ready) {
        e.preventDefault();
        advanceTour(ctx.tourStore, ctx.callbackArgs);
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
        prevTour(ctx.tourStore, ctx.callbackArgs);
      }
      break;
    }
    case 'Tab': {
      const popover = document.querySelector<HTMLElement>('[data-tour-popover]');
      const highlightEl = ctx.tourStore.getHighlightedElement();
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
}
