import { stepSelector } from "./types";
import type { Msg, TourSnapshot, WaymarkStep } from "./types";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Input policy: translate DOM events into tour events. These functions read the
// snapshot and return an event for the store to dispatch (or undefined for
// "nothing to report") — every guard (canAdvance, step bounds, auto-advance
// rules) lives in the reducer, not here. DOM side effects (preventDefault,
// focus()) are fine; tour state changes are not.
export type HandlerContext<CallbackArgs> = {
  snapshot: TourSnapshot;
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
  const rect = ctx.snapshot.highlightedElementRect;
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
): Msg | undefined {
  if (!(e.target instanceof Element)) return;
  if (!e.target.isConnected) return;
  if (isClickWithinVisualHighlight(e, ctx)) {
    // A target click is only the advance condition on click steps; the
    // reducer decides what meeting it means (gate unlock, auto-advance).
    return ctx.step.advanceWhen?.type === "click"
      ? { type: "advanceConditionMet" }
      : undefined;
  }
  if (e.target.closest("[data-waymark-popover]")) return;
  if (e.target.closest("[data-waymark-beacon]")) return;
  if (
    e.target.closest(
      '[role="dialog"], [data-popover], [data-slot="select-positioner"]',
    )
  )
    return;

  return { type: "unfocus" }; // out of bounds click unfocuses
}

export function handleTourKeyDown<CallbackArgs>(
  e: KeyboardEvent,
  ctx: HandlerContext<CallbackArgs>,
): Msg | undefined {
  if (!ctx.snapshot.focused) return;

  const { activeElement } = document;
  const isEditable =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable);
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      return { type: "unfocus" };
    case "ArrowRight": {
      if (isEditable) return;
      e.preventDefault();
      return { type: "advance" }; // refused by the reducer while !canAdvance
    }
    case "ArrowLeft": {
      if (isEditable) return;
      e.preventDefault();
      return { type: "prev" }; // refused by the reducer at step 0
    }
    case "Tab": {
      const popover = document.querySelector<HTMLElement>(
        "[data-waymark-popover]",
      );
      if (!popover) return;
      const selector = stepSelector(ctx.step);
      const highlightEl = selector ? document.querySelector(selector) : null;

      const focusables = [
        ...Array.from(
          popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ),
        ...(highlightEl instanceof HTMLElement
          ? [
              ...(highlightEl.matches(FOCUSABLE_SELECTOR) ? [highlightEl] : []),
              ...Array.from(
                highlightEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
              ),
            ]
          : []),
      ];

      if (focusables.length === 0) return;

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
      return; // focus moved; no tour state change
    }
  }
}
