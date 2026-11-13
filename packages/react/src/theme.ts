import { useState } from "react";

// The colours of the library's own popover, beacon and checklist, and how a control knows it is hovered.

// An app sets four colours. Left unset, the surface and the text are the browser's own for the page's `color-scheme`,
// so a dark app gets a dark popover without setting anything.
const ACCENT = "var(--waymark-accent, #2563eb)";
const SURFACE = "var(--waymark-surface, Canvas)";
const TEXT = "var(--waymark-text, CanvasText)";

const mix = (color: string, percent: number, into: string) => `color-mix(in srgb, ${color} ${percent}%, ${into})`;

// Read inside components only: a constant made from one where a module loads is kept by an app's bundler, used or not.
export const color = {
  accent: ACCENT,
  onAccent: "var(--waymark-on-accent, #fff)",
  surface: SURFACE,
  text: TEXT,
  // The rest are mixed from those four, so a new accent or a dark surface carries through. A browser without
  // `color-mix()` drops each: quiet text is then drawn like the rest, and the lines and tints are not drawn.
  muted: /* @__PURE__ */ mix(TEXT, 62, SURFACE),
  line: /* @__PURE__ */ mix(TEXT, 16, SURFACE),
  // See-through, so they tint whatever they are laid over.
  hover: /* @__PURE__ */ mix(TEXT, 7, "transparent"),
  halo: /* @__PURE__ */ mix(ACCENT, 30, "transparent"),
  // Amber, taken towards the text colour so it reads on a light surface and a dark one.
  warn: /* @__PURE__ */ mix("#f59e0b", 60, TEXT),
} as const;

/** Inline styles have no `:hover`, so a control tracks the pointer itself. Focus is left to the browser's own ring. */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }, setHovered] as const;
}
