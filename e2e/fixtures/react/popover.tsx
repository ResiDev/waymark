import type { Placement, WalkthroughRenderProps } from "react-waymark";

const arrows: Record<Placement, string> = { above: "▼", below: "▲", left: "▶", right: "◀" };

/**
 * A popover passed as `renderPopover`. It uses every render prop the default
 * leaves out: placement, `hasWaymark`, collapse and reset.
 */
export function CustomPopover({
  snapshot,
  currentStep,
  placement,
  hasWaymark,
  advance,
  previous,
  collapse,
  reset,
  exit,
  skipTask,
}: WalkthroughRenderProps) {
  const last = snapshot.stepIndex === snapshot.stepCount - 1;
  return (
    <div className="custom-popover" data-placement={placement} style={currentStep.popoverStyle}>
      <div className="custom-popover-meta">
        <span>{hasWaymark ? `${arrows[placement]} ${placement}` : "no waymark: centred"}</span>
        <span className="dots" aria-label={`Step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`}>
          {Array.from({ length: snapshot.stepCount }, (_, index) => (
            <i key={index} data-current={index === snapshot.stepIndex} />
          ))}
        </span>
      </div>
      <div>{currentStep.content}</div>
      {!snapshot.canAdvance && <div className="locked">Do what the step asks to unlock Next.</div>}
      <div className="custom-popover-actions">
        <button type="button" onClick={previous} disabled={snapshot.stepIndex === 0}>
          Back
        </button>
        <button type="button" onClick={collapse}>
          Collapse
        </button>
        <button type="button" onClick={reset}>
          Restart
        </button>
        {skipTask && (
          <button type="button" onClick={skipTask}>
            Skip task
          </button>
        )}
        <button type="button" onClick={exit}>
          Exit
        </button>
        <button type="button" className="primary" onClick={advance} disabled={!snapshot.canAdvance}>
          {last ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
