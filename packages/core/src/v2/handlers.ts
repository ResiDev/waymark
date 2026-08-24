import { stepSelector } from "./rafLoop";
import type { Tour, WaymarkStep } from "./types";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Input policy: translate DOM events into tour verbs. These functions read the
// snapshot and call the public interface only — every guard (canAdvance, step
// bounds, click-advance rules) lives in the store, not here.
export type HandlerContext<CallbackArgs> = {
  tour: Tour;
  step: WaymarkStep<CallbackArgs>;
  highlightPadding: number;
};

// Clicks inside the <Highlight> halo (rect + padding) count as on-target,
// even if the underlying DOM target is a parent of the highlighted element.
function isClickWithinVisualHighlight<CallbackArgs>(
  e: MouseEvent,
  ctx: HandlerContext<CallbackArgs>,
) {
  const selector = stepSelector(ctx.step);
  if (!selector) return false;
  if (e.target instanceof Element && e.target.closest(selector)) return true;
  const rect = ctx.tour.getSnapshot().highlightedElementRect;
  if (!rect) return false;
  const pad = ctx.highlightPadding;
  return (
    e.clientX >= rect.left - pad &&
    e.clientX <= rect.right + pad &&
    e.clientY >= rect.top - pad &&
    e.clientY <= rect.bottom + pad
  );
}

export function handleTourClick<CallbackArgs>(
  e: MouseEvent,
  ctx: HandlerContext<CallbackArgs>,
) {
  if (!(e.target instanceof Element)) return;
  if (!e.target.isConnected) return;
  if (isClickWithinVisualHighlight(e, ctx)) {
    // Report the observation; the store decides what a target click means
    // (gateNext unlock, auto-advance, or nothing).
    ctx.tour.targetClick();
    return;
  }
  if (e.target.closest("[data-waymark-popover]")) return;
  if (e.target.closest("[data-waymark-beacon]")) return;
  if (e.target.closest('[role="dialog"], [data-popover], [data-slot="select-positioner"]'))
    return;
  ctx.tour.unfocus();
}

export function handleTourKeyDown<CallbackArgs>(
  e: KeyboardEvent,
  ctx: HandlerContext<CallbackArgs>,
) {
  if (!ctx.tour.getSnapshot().focused) return;

  const { activeElement } = document;
  const isEditable =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable);
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      ctx.tour.unfocus();
      break;
    case "ArrowRight": {
      if (!isEditable) {
        e.preventDefault();
        ctx.tour.advance(); // refused by the store while !canAdvance
      }
      break;
    }
    case "ArrowLeft": {
      if (!isEditable) {
        e.preventDefault();
        ctx.tour.prev(); // refused by the store at step 0
      }
      break;
    }
    case "Tab": {
      const popover = document.querySelector<HTMLElement>(
        "[data-waymark-popover]",
      );
      if (!popover) break;
      const selector = stepSelector(ctx.step);
      const highlightEl = selector ? document.querySelector(selector) : null;

      const focusables = [
        ...Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
        ...(highlightEl instanceof HTMLElement
          ? [
              ...(highlightEl.matches(FOCUSABLE_SELECTOR) ? [highlightEl] : []),
              ...Array.from(
                highlightEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
              ),
            ]
          : []),
      ];

      if (focusables.length === 0) break;

      e.preventDefault();
      const currentIndex = focusables.indexOf(
        document.activeElement as HTMLElement,
      );

      if (e.shiftKey) {
        focusables[
          currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1
        ].focus();
      } else {
        focusables[
          currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1
        ].focus();
      }
      break;
    }
  }
}
