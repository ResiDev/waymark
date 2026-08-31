import {
  useLayoutEffect,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import type { Rect } from "waymark";
import { placePopover } from "./placement";
import type {
  Placement,
  TutorialRenderProps,
  TutorialStep,
} from "./types";

export function WaymarkShade({
  rect,
  padding,
}: {
  rect: Rect | null;
  padding: number;
}) {
  if (!rect) {
    return (
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          pointerEvents: "none",
          background: "rgba(0, 0, 0, 0.5)",
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        zIndex: 50,
        pointerEvents: "none",
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        borderRadius: 8,
        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
      }}
    />
  );
}

export function Beacon({
  rect,
  beaconRef,
  onResume,
}: {
  rect: Rect | null;
  beaconRef: RefObject<HTMLButtonElement>;
  onResume: () => void;
}) {
  const left = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const top = rect ? rect.bottom + 8 : window.innerHeight - 32;
  return (
    <button
      ref={beaconRef}
      type="button"
      aria-label="Resume tutorial"
      onClick={onResume}
      style={{
        position: "fixed",
        zIndex: 51,
        top,
        left,
        width: 22,
        height: 22,
        padding: 0,
        transform: "translate(-50%, -50%)",
        border: "2px solid rgba(255, 255, 255, 0.9)",
        borderRadius: "50%",
        background: "#3b82f6",
        boxShadow: "0 0 0 6px rgba(59, 130, 246, 0.25)",
        cursor: "pointer",
      }}
    />
  );
}

export function Dialog({
  rect,
  preferred,
  padding,
  dialogRef,
  ariaLabel,
  children,
}: {
  rect: Rect;
  preferred?: Placement;
  padding: number;
  dialogRef: RefObject<HTMLDivElement>;
  ariaLabel: string;
  children: (placement: Placement) => ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const next = { width: element.offsetWidth, height: element.offsetHeight };
    setSize((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next,
    );
  });

  const placed = placePopover({
    anchor: rect,
    popover: size,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    preferred,
    gap: padding + 8,
  });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        position: "fixed",
        zIndex: 51,
        top: placed.top,
        left: placed.left,
        outline: "none",
      }}
    >
      {children(placed.placement)}
    </div>
  );
}

export function DefaultPopover<TStep extends TutorialStep>({
  currentStep,
  snapshot,
  previous,
  advance,
  exit,
}: TutorialRenderProps<TStep>) {
  const secondaryButton = {
    border: 0,
    padding: "6px 4px",
    color: "#94a3b8",
    background: "transparent",
    cursor: "pointer",
  } as const;

  return (
    <div
      style={{
        boxSizing: "border-box",
        display: "flex",
        width: 280,
        maxWidth: "calc(100vw - 16px)",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        color: "#e2e8f0",
        background: "#1e293b",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        ...currentStep.popoverStyle,
      }}
    >
      <div style={{ fontSize: 16, lineHeight: 1.5 }}>
        {currentStep.content}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button type="button" onClick={exit} style={secondaryButton}>
          Skip
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {snapshot.stepIndex > 0 && (
            <button type="button" onClick={previous} style={secondaryButton}>
              Previous
            </button>
          )}
          <button
            type="button"
            onClick={advance}
            disabled={!snapshot.canAdvance}
            style={{
              border: 0,
              padding: "7px 14px",
              color: snapshot.canAdvance ? "white" : "#64748b",
              background: snapshot.canAdvance ? "#3b82f6" : "#334155",
              borderRadius: 6,
              cursor: snapshot.canAdvance ? "pointer" : "not-allowed",
            }}
          >
            {snapshot.stepIndex === snapshot.stepCount - 1
              ? "Finish"
              : `Next (${snapshot.stepIndex + 1} of ${snapshot.stepCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
