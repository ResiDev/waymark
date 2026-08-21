import { advanceTour, prevTour, setTourReady, unfocusTour } from './index';
import type { CallbackArgs, TutorialStore, WaymarkStep } from './index';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type TutorialEventContext<TStep extends WaymarkStep = WaymarkStep> = {
  tourStore: TutorialStore;
  currentStep: TStep;
  selector: string | undefined;
  highlightPadding: number;
  callbackArgs: CallbackArgs<TStep>;
};

// Clicks inside the <Highlight> halo (rect + padding) count as on-target,
// even if the underlying DOM target is a parent of the highlighted element.
function isClickWithinVisualHighlight<TStep extends WaymarkStep>(e: MouseEvent, ctx: TutorialEventContext<TStep>) {
  if (!ctx.selector) return false;
  if (e.target instanceof Element && e.target.closest(ctx.selector)) return true;
  const rect = ctx.tourStore.getHighlightedElementRect();
  if (!rect) return false;
  const pad = ctx.highlightPadding;
  return (
    e.clientX >= rect.left - pad &&
    e.clientX <= rect.right + pad &&
    e.clientY >= rect.top - pad &&
    e.clientY <= rect.bottom + pad
  );
}

export function handleTutorialClick<TStep extends WaymarkStep>(e: MouseEvent, ctx: TutorialEventContext<TStep>) {
  if (!(e.target instanceof Element)) return;
  if (!e.target.isConnected) return;
  if (isClickWithinVisualHighlight(e, ctx)) {
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

export function handleTutorialKeyDown<TStep extends WaymarkStep>(e: KeyboardEvent, ctx: TutorialEventContext<TStep>) {
  if (!ctx.tourStore.getFocused()) return;

  const { activeElement } = document;
  const isEditable =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable);
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      unfocusTour(ctx.tourStore, ctx.callbackArgs);
      break;
    case 'ArrowRight': {
      if (!isEditable && ctx.tourStore.ready) {
        e.preventDefault();
        advanceTour(ctx.tourStore, ctx.callbackArgs);
      }
      break;
    }
    case 'ArrowLeft': {
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
