import type { Action, Rect, UiElements } from "./types";

/**
 * What the user's clicks and keystrokes mean to a Run.
 *
 * These functions read the page and answer a question; they never change the
 * Run. Moving focus is the one exception, because tab order is a property of
 * the document and of nothing else.
 */
export type InputContext = Readonly<{
  collapsed: boolean;
  /** The current Step's Waymark element, if it has been found. */
  element: Element | null;
  rect: Rect | null;
  padding: number;
  ui: UiElements;
}>;

/**
 * - `waymark` — on the Waymark, or within the halo drawn around it.
 * - `ui` — on the tutorial's own UI, or on something that opted out.
 * - `away` — the user has turned their attention elsewhere.
 */
export type ClickHit = "waymark" | "ui" | "away";

const within = (rect: Rect, padding: number, x: number, y: number) =>
  x >= rect.left - padding &&
  x <= rect.right + padding &&
  y >= rect.top - padding &&
  y <= rect.bottom + padding;

export function whereClicked(event: MouseEvent, ctx: InputContext): ClickHit {
  const node = event.target;
  if (!(node instanceof Element) || !node.isConnected) return "ui";

  // The halo counts, so a click on the padding around a small waymark still
  // reads as a click on it, and so does a click on a child of the waymark.
  if (ctx.element?.contains(node)) return "waymark";
  if (ctx.rect && within(ctx.rect, ctx.padding, event.clientX, event.clientY)) {
    return "waymark";
  }

  const { dialog, beacon } = ctx.ui;
  if (dialog?.contains(node) || beacon?.contains(node)) return "ui";
  if (node.closest("[data-waymark-ui]")) return "ui";

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

/** Tab and Shift+Tab cycle between the popover's controls and the Waymark's. */
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
  const current = focusable.indexOf(document.activeElement as HTMLElement);
  const step = event.shiftKey ? -1 : 1;
  const next = (current + step + focusable.length) % focusable.length;
  focusable[current === -1 && event.shiftKey ? focusable.length - 1 : next].focus();
}

export function keyAction(
  event: KeyboardEvent,
  ctx: InputContext,
): Action | undefined {
  if (ctx.collapsed) return undefined;

  switch (event.key) {
    case "Escape":
      event.preventDefault();
      return "collapse";
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
