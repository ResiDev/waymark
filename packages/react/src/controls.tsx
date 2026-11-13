import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { color, useHover } from "./theme";

type Variant = "primary" | "secondary" | "quiet";

const base: CSSProperties = {
  display: "inline-flex",
  flex: "none",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 32,
  margin: 0,
  padding: "5px 12px",
  // Longhands: React clears a longhand it drops, which would wipe a colour set through `border`.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  borderRadius: 8,
  background: "transparent",
  font: "inherit",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: "20px",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/** One button for the popover and the checklist, so the two read as one design. */
export function Button({ variant, style, ...props }: ComponentPropsWithoutRef<"button"> & { variant: Variant }) {
  const [hovered, hover] = useHover();
  // The two with a box share a least width, so a pair or a column of them lines up.
  const looks: Record<Variant, readonly [rest: CSSProperties, hovering: CSSProperties]> = {
    primary: [{ minWidth: 88, color: color.onAccent, background: color.accent }, { filter: "brightness(0.9)" }],
    secondary: [{ minWidth: 88, color: color.text, borderColor: color.line }, { background: color.hover }],
    quiet: [{ color: color.muted }, { color: color.text, background: color.hover }],
  };
  const [rest, hovering] = looks[variant];
  // One that cannot be pressed keeps a faint tint of the accent, so it still reads as the way on, under a grey
  // label. Faded on its fill instead, a filled button's label would be hard to read.
  const locked: CSSProperties = { color: color.muted, background: color.tint, borderColor: "transparent", cursor: "not-allowed" };
  return (
    <button
      type="button"
      {...props}
      {...hover}
      style={{
        ...base,
        // Tints the ring the browser draws round a control the keyboard is on.
        outlineColor: color.accent,
        ...rest,
        ...(props.disabled === true ? locked : hovered ? hovering : null),
        ...style,
      }}
    />
  );
}

// Each icon is one path, drawn on a 12px grid.
export const CHECK = "M2.5 6.5 5 9l4.5-5.5";
export const DASH = "M3 6h6";
export const CLOSE = "M3 3l6 6M9 3l-6 6";
// A solid triangle with soft corners: its stroke all but fills it, and the dash in its middle fills the rest.
export const PLAY = "M4.9 4v4L8.4 6ZM6 6h.3";

export const Icon = ({ d, size = 12 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
