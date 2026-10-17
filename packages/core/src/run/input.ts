import type { Action, Rect, UiElements } from "./types";
import type { Dismiss } from "../walkthrough/types";

export type InputContext = Readonly<{
  dismiss: Dismiss;
  element: Element | null;
  rect: Rect | null;
  padding: number;
  ui: UiElements;
}>;

export type ClickHit = "waymark" | "ui" | "away";

const within = (rect: Rect, padding: number, x: number, y: number) =>
  x >= rect.left - padding &&
  x <= rect.right + padding &&
  y >= rect.top - padding &&
  y <= rect.bottom + padding;

/**
 * Whose UI `node` is in. This Run's dialog comes first, since content inside it
 * may carry `data-waymark-ui`; "other" is any other Waymark UI, and "page" is the app's own.
 */
const uiOwner = (node: Element, { dialog }: UiElements): "run" | "other" | "page" => {
  if (dialog?.contains(node) === true) return "run";
  if (node.closest("[data-waymark-ui]") !== null) return "other";
  return "page";
};

export function whereClicked(event: MouseEvent, ctx: InputContext): ClickHit {
  const node = event.target;
  if (!(node instanceof Element) || !node.isConnected) return "ui";

  // UI first: a popover clamped into the viewport can sit inside the Waymark's halo.
  if (uiOwner(node, ctx.ui) !== "page") return "ui";

  if (ctx.element?.contains(node) === true) return "waymark";
  // Keyboard activation has no pointer position; its default 0,0 is not a hit.
  if (event.detail > 0 && ctx.rect && within(ctx.rect, ctx.padding, event.clientX, event.clientY)) {
    return "waymark";
  }

  return "away";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isTyping = () => {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
};

function cycleFocus(event: KeyboardEvent, ctx: InputContext): void {
  const { dialog } = ctx.ui;
  if (!dialog) return;
  const waymark = ctx.element;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ...(waymark instanceof HTMLElement && waymark.matches(FOCUSABLE)
      ? [waymark]
      : []),
    ...(waymark ? waymark.querySelectorAll<HTMLElement>(FOCUSABLE) : []),
  ];
  if (focusable.length === 0) return;

  event.preventDefault();
  const current = focusable.findIndex((element) => element === document.activeElement);
  const step = event.shiftKey ? -1 : 1;
  const next = (current + step + focusable.length) % focusable.length;
  focusable[current === -1 && event.shiftKey ? focusable.length - 1 : next]?.focus();
}

export function keyAction(
  event: KeyboardEvent,
  ctx: InputContext,
): Action | undefined {
  const alreadyHandled = event.defaultPrevented;
  const hasShortcutModifier = event.altKey || event.ctrlKey || event.metaKey;
  if (alreadyHandled || hasShortcutModifier) return undefined;

  const node = event.target;
  // Other Waymark UI owns its keys, even while this Run owns the page's shortcuts.
  if (node instanceof Element && uiOwner(node, ctx.ui) === "other") return undefined;

  switch (event.key) {
    case "Escape":
      event.preventDefault();
      return ctx.dismiss;
    case "ArrowRight":
      if (isTyping()) return undefined;
      event.preventDefault();
      return "advance"; // refused by the Run while the gate is shut
    case "ArrowLeft":
      if (isTyping()) return undefined;
      event.preventDefault();
      return "previous";
    case "Tab":
      cycleFocus(event, ctx);
      return undefined;
    default:
      return undefined;
  }
}
