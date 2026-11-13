import { useState, useSyncExternalStore, type CSSProperties } from "react";

// The colours of the library's own popover, beacon and checklist, and how a control knows it is hovered or focused.

/**
 * An app sets four colours, as `--waymark-accent`, `--waymark-on-accent`,
 * `--waymark-surface` and `--waymark-text`; the rest are mixed from them, so a
 * new accent or a dark surface carries through. The defaults follow the page's
 * `color-scheme`, so a dark app gets a dark popover without setting anything.
 */
const ACCENT = "var(--waymark-accent, light-dark(#2563eb, #60a5fa))";
const SURFACE = "var(--waymark-surface, light-dark(#fff, #1e293b))";
const TEXT = "var(--waymark-text, light-dark(#0f172a, #f1f5f9))";

type Vars = Readonly<Record<`--wm-${string}`, string>>;

const mix = (color: string, percent: number, into: string) => `color-mix(in srgb, ${color} ${percent}%, ${into})`;

const adaptive = (): Vars => ({
  "--wm-accent": ACCENT,
  "--wm-accent-strong": mix(ACCENT, 80, TEXT),
  "--wm-halo": mix(ACCENT, 30, "transparent"),
  "--wm-on-accent": "var(--waymark-on-accent, light-dark(#fff, #0f172a))",
  "--wm-surface": SURFACE,
  "--wm-text": TEXT,
  "--wm-muted": mix(TEXT, 62, SURFACE),
  "--wm-line": mix(TEXT, 16, SURFACE),
  // See-through, so it tints whatever it is laid over.
  "--wm-hover": mix(TEXT, 7, "transparent"),
  "--wm-warn": "light-dark(#92400e, #fcd34d)",
});

const ADAPTIVE = /* @__PURE__ */ adaptive();

/** For a browser without `light-dark()` or `color-mix()`, which would otherwise drop each colour and draw nothing. */
const PLAIN: Vars = {
  "--wm-accent": "var(--waymark-accent, #2563eb)",
  "--wm-accent-strong": "#2154c4",
  "--wm-halo": "rgb(37 99 235 / 0.3)",
  "--wm-on-accent": "var(--waymark-on-accent, #fff)",
  "--wm-surface": "var(--waymark-surface, #fff)",
  "--wm-text": "var(--waymark-text, #0f172a)",
  "--wm-muted": "#6a6f7b",
  "--wm-line": "#d9dadd",
  "--wm-hover": "rgb(15 23 42 / 0.07)",
  "--wm-warn": "#92400e",
};

// jsdom has a `CSS` with no `supports`, and an app's own tests draw these components there.
const supported = () => typeof CSS !== "undefined" && "supports" in CSS && CSS.supports("color", "light-dark(red, red)");
const never = () => () => {};

/**
 * The colours, as custom properties for the outermost element of each default
 * component. A server cannot ask the browser what it supports, so it sends the
 * adaptive set, and a browser without it swaps to the plain one as it hydrates.
 */
export const usePalette = (): CSSProperties =>
  useSyncExternalStore(
    never,
    () => (supported() ? ADAPTIVE : PLAIN),
    () => ADAPTIVE,
  );

export const color = {
  accent: "var(--wm-accent)",
  accentStrong: "var(--wm-accent-strong)",
  halo: "var(--wm-halo)",
  onAccent: "var(--wm-on-accent)",
  surface: "var(--wm-surface)",
  text: "var(--wm-text)",
  muted: "var(--wm-muted)",
  line: "var(--wm-line)",
  hover: "var(--wm-hover)",
  warn: "var(--wm-warn)",
} as const;

const focusVisible = (element: Element): boolean => {
  // An old jsdom throws on a selector it does not know.
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
};

/** Inline styles have no `:hover` or `:focus-visible`, so a control tracks both itself. */
export function useInteraction() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return [
    { hovered, focused },
    {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: (event: { currentTarget: Element }) => setFocused(focusVisible(event.currentTarget)),
      onBlur: () => setFocused(false),
    },
  ] as const;
}

export const focusRing: CSSProperties = { outline: `2px solid ${color.accent}`, outlineOffset: 2 };
