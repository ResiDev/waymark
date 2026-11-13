import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { color, focusRing, useInteraction } from "./theme";

type Variant = "primary" | "secondary" | "quiet";

const base: CSSProperties = {
  boxSizing: "border-box",
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
  transition: "background-color 150ms, color 150ms",
};

const looks: Record<Variant, readonly [rest: CSSProperties, hover: CSSProperties]> = {
  primary: [{ color: color.onAccent, background: color.accent }, { background: color.accentStrong }],
  secondary: [{ color: color.text, borderColor: color.line }, { background: color.hover }],
  quiet: [{ color: color.muted }, { color: color.text, background: color.hover }],
};

const disabled: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };

/** One button for the popover and the checklist, so the two read as one design. */
export function Button({ variant, style, ...props }: ComponentPropsWithoutRef<"button"> & { variant: Variant }) {
  const [{ hovered, focused }, interaction] = useInteraction();
  const [rest, hover] = looks[variant];
  return (
    <button
      type="button"
      {...props}
      {...interaction}
      style={{
        ...base,
        ...rest,
        ...(props.disabled === true ? disabled : hovered ? hover : null),
        ...(focused ? focusRing : null),
        ...style,
      }}
    />
  );
}

// Each icon is one path, drawn on a 12px grid.
export const CHECK = "M2.5 6.5 5 9l4.5-5.5";
export const DASH = "M3 6h6";
export const CLOSE = "M3 3l6 6M9 3l-6 6";
export const WARNING = "M6 1.75 10.75 10h-9.5ZM6 5v2.25M6 8.4v.1";
export const PLAY = "M4.25 3v6L9.5 6Z";

export const Icon = ({ d, size = 12, filled = false }: { d: string; size?: number; filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: "none" }}
  >
    <path d={d} />
  </svg>
);
