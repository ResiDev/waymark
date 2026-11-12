import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { color, focusRing, useInteraction } from "./theme";

type Variant = "primary" | "secondary" | "plain" | "quiet";

const base: CSSProperties = {
  boxSizing: "border-box",
  display: "inline-flex",
  flex: "none",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 32,
  margin: 0,
  padding: "5px 12px",
  // Longhands throughout: React clears a longhand it drops, which would wipe a colour set through `border`.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  borderRadius: 8,
  font: "inherit",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: "20px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  transition: "background-color 200ms, border-color 120ms, color 200ms",
};

const looks: Record<Variant, readonly [rest: CSSProperties, hover: CSSProperties]> = {
  primary: [
    { color: color.onAccent, background: color.accent, boxShadow: "0 1px 2px rgb(2 6 23 / 0.16)" },
    { background: color.accentStrong },
  ],
  secondary: [
    { color: color.text, background: "transparent", borderColor: color.lineStrong },
    { background: color.hover },
  ],
  // A button among many like it: its box shows only under the pointer, so a list of them is not a column of boxes.
  plain: [
    { color: color.text, background: "transparent" },
    { background: color.hover, borderColor: color.lineStrong },
  ],
  quiet: [
    { padding: "5px 10px", color: color.muted, background: "transparent" },
    { color: color.text, background: color.hover },
  ],
};

// A faint cast of what it will be, so a locked button reads as not yet, and not as broken.
const disabledLook: CSSProperties = {
  color: color.accentMid,
  background: color.accentDim,
  borderColor: "transparent",
  boxShadow: "none",
  cursor: "not-allowed",
};

/** One button for the popover and the checklist, so the two read as one design. */
export function Button({
  variant,
  style,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant: Variant }) {
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
        ...(props.disabled === true ? (variant === "quiet" ? { cursor: "not-allowed", opacity: 0.5 } : disabledLook) : hovered ? hover : null),
        ...(focused ? focusRing : null),
        ...style,
      }}
    />
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" {...stroke} strokeWidth={2} aria-hidden="true">
    <path d="M2.5 6.5 5 9l4.5-5.5" />
  </svg>
);

export const DashIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" {...stroke} strokeWidth={2} aria-hidden="true">
    <path d="M3 6h6" />
  </svg>
);

export const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5} aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const LockIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" {...stroke} strokeWidth={1.5} aria-hidden="true">
    <rect x="2.25" y="5.5" width="7.5" height="5" rx="1.25" fill="currentColor" stroke="none" />
    <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
  </svg>
);

export const WarningIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5} aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
    <path d="M8 2.75 14 13H2L8 2.75Z" />
    <path d="M8 6.75v2.75M8 11.4v.1" />
  </svg>
);

export const UndoIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" {...stroke} strokeWidth={1.5} aria-hidden="true">
    <path d="M3 4.5h4a2.5 2.5 0 0 1 0 5H4.5M3 4.5l2-2M3 4.5l2 2" />
  </svg>
);

/** Drawn to the right of its box's middle, so the triangle's weight, not its box, sits at the centre of a disc. */
export const PlayIcon = ({ size = 8 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 8 8" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" aria-hidden="true">
    <path d="M2.75 1.5v5L7 4 2.75 1.5Z" />
  </svg>
);
