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

const disabled: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };

/** One button for the popover and the checklist, so the two read as one design. */
export function Button({ variant, style, ...props }: ComponentPropsWithoutRef<"button"> & { variant: Variant }) {
  const [hovered, hover] = useHover();
  const looks: Record<Variant, readonly [rest: CSSProperties, hovering: CSSProperties]> = {
    primary: [{ color: color.onAccent, background: color.accent }, { filter: "brightness(0.9)" }],
    secondary: [{ color: color.text, borderColor: color.line }, { background: color.hover }],
    quiet: [{ color: color.muted }, { color: color.text, background: color.hover }],
  };
  // Faded on its fill, a filled button's label is hard to read, so one that cannot be pressed is drawn as the outlined one.
  const [rest, hovering] = looks[props.disabled === true ? "secondary" : variant];
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
        ...(props.disabled === true ? disabled : hovered ? hovering : null),
        ...style,
      }}
    />
  );
}

// Each icon is one path, drawn on a 12px grid.
export const CHECK = "M2.5 6.5 5 9l4.5-5.5";
export const DASH = "M3 6h6";
export const CLOSE = "M3 3l6 6M9 3l-6 6";
// Small enough that its stroke fills it: a solid triangle with soft corners.
export const PLAY = "M5.2 4.4v3.2L8 6Z";

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
