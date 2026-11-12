import { useState, useSyncExternalStore, type CSSProperties } from "react";

type Vars = Readonly<Record<`--wm-${string}`, string>>;

const AMBER = "#f59e0b";

const mix = (color: string, percent: number, into: string) => `color-mix(in srgb, ${color} ${percent}%, ${into})`;

/**
 * Four colours an app can set, as `--waymark-accent`, `--waymark-on-accent`,
 * `--waymark-surface` and `--waymark-text`; every other colour is mixed from
 * them, so a new accent or a dark surface carries through the whole design.
 */
const palette = (accent: string, onAccent: string, surface: string, text: string, rest: Vars): Vars => ({
  "--wm-accent": accent,
  "--wm-accent-strong": mix(accent, 80, text),
  "--wm-accent-mid": mix(accent, 60, surface),
  "--wm-accent-dim": mix(accent, 20, surface),
  "--wm-accent-soft": mix(accent, 10, surface),
  "--wm-accent-ring": mix(accent, 30, "transparent"),
  "--wm-on-accent": onAccent,
  "--wm-surface": surface,
  "--wm-text": text,
  "--wm-body": mix(text, 80, surface),
  "--wm-muted": mix(text, 62, surface),
  "--wm-edge": mix(text, 50, surface),
  "--wm-skipped": mix(text, 30, surface),
  "--wm-line-strong": mix(text, 20, surface),
  "--wm-line": mix(text, 10, surface),
  // See-through, so it shows on the plain surface and the raised one alike.
  "--wm-hover": mix(text, 7, "transparent"),
  "--wm-warn-soft": mix(AMBER, 12, surface),
  "--wm-warn-line": mix(AMBER, 40, surface),
  ...rest,
});

/** Follows the page's `color-scheme`, so a dark app gets a dark popover without setting anything. */
const ADAPTIVE = /* @__PURE__ */ palette(
  "var(--waymark-accent, light-dark(#2563eb, #60a5fa))",
  "var(--waymark-on-accent, light-dark(#ffffff, #0f172a))",
  "var(--waymark-surface, light-dark(#ffffff, #1e293b))",
  "var(--waymark-text, light-dark(#0f172a, #f1f5f9))",
  {
    "--wm-warn": "light-dark(#92400e, #fcd34d)",
    // The app's text colour taken nearly to black, so the shade is not a cold cast over a warm page; darker over a
    // dark page, which a light shade would barely change.
    "--wm-scrim":
      "light-dark(color-mix(in srgb, color-mix(in srgb, var(--wm-text) 30%, #000) 42%, transparent), rgb(0 0 0 / 0.65))",
    // What floats over a dark page is lifted by a lighter surface and a lit top edge, where a shadow cannot be seen.
    "--wm-raised": "light-dark(var(--wm-surface), color-mix(in srgb, var(--wm-text) 6%, var(--wm-surface)))",
    "--wm-glint": "light-dark(transparent, rgb(255 255 255 / 0.07))",
    "--wm-shadow": "light-dark(rgb(2 6 23 / 0.28), rgb(0 0 0 / 0.6))",
  },
);

/** For a browser without `light-dark()` or `color-mix()`, which would otherwise drop each colour and draw nothing. */
const PLAIN: Vars = {
  "--wm-accent": "var(--waymark-accent, #2563eb)",
  "--wm-accent-strong": "#2154c4",
  "--wm-accent-mid": "#7ca1f3",
  "--wm-accent-dim": "#d3e0fb",
  "--wm-accent-soft": "#e9effd",
  "--wm-accent-ring": "rgb(37 99 235 / 0.3)",
  "--wm-on-accent": "var(--waymark-on-accent, #ffffff)",
  "--wm-surface": "var(--waymark-surface, #ffffff)",
  "--wm-text": "var(--waymark-text, #0f172a)",
  "--wm-body": "#3f4555",
  "--wm-muted": "#6a6f7b",
  "--wm-edge": "#878b95",
  "--wm-skipped": "#b7b9bf",
  "--wm-line-strong": "#cfd1d4",
  "--wm-line": "#e7e8ea",
  "--wm-hover": "rgb(15 23 42 / 0.07)",
  "--wm-warn": "#92400e",
  "--wm-warn-soft": "#fef3e2",
  "--wm-warn-line": "#fbd89d",
  "--wm-scrim": "rgb(5 7 13 / 0.42)",
  "--wm-raised": "var(--wm-surface)",
  "--wm-glint": "transparent",
  "--wm-shadow": "rgb(2 6 23 / 0.28)",
};

// Asked as a component first draws, not as the module loads, so an app that imports no default component pays nothing.
// jsdom has a `CSS` with no `supports`, and an app's own tests draw these components there.
const supported = () => typeof CSS !== "undefined" && "supports" in CSS && CSS.supports("color", "light-dark(red, red)");
const never = () => () => {};

/**
 * The colours, as custom properties for the root element of each default
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
  accentMid: "var(--wm-accent-mid)",
  accentDim: "var(--wm-accent-dim)",
  accentSoft: "var(--wm-accent-soft)",
  accentRing: "var(--wm-accent-ring)",
  onAccent: "var(--wm-on-accent)",
  surface: "var(--wm-surface)",
  text: "var(--wm-text)",
  body: "var(--wm-body)",
  muted: "var(--wm-muted)",
  edge: "var(--wm-edge)",
  skipped: "var(--wm-skipped)",
  lineStrong: "var(--wm-line-strong)",
  line: "var(--wm-line)",
  hover: "var(--wm-hover)",
  warn: "var(--wm-warn)",
  warnSoft: "var(--wm-warn-soft)",
  warnLine: "var(--wm-warn-line)",
  scrim: "var(--wm-scrim)",
  raised: "var(--wm-raised)",
  glint: "var(--wm-glint)",
  shadow: "var(--wm-shadow)",
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
