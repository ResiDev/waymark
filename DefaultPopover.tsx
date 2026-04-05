import type { TutorialRenderProps } from './types';

const arrowPositions = {
  below: { top: -8, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
  above: { bottom: -8, left: '50%', transform: 'rotate(225deg)' },
  right: { top: '50%', left: -8, transform: 'translateY(-50%) rotate(315deg)' },
  left: { top: '50%', right: -8, transform: 'translateY(-50%) rotate(135deg)' },
} as const;

export function DefaultPopover({
  currentStep,
  placement,
  step,
  totalSteps,
  ready,
  hasTarget,
  next,
  prev,
  cancel,
}: TutorialRenderProps) {
  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '4px 0',
    fontSize: 13,
  };
  const hasGate = !!currentStep.advanceWhen?.gateNext;
  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: ready ? '#3b82f6' : '#334155',
    color: ready ? '#fff' : '#475569',
    borderRadius: 6,
    padding: '6px 14px',
    cursor: ready ? 'pointer' : 'not-allowed',
    position: 'relative' as const,
  };
  return (
    <div
      style={{
        position: 'relative',
        backgroundColor: '#1e293b',
        color: '#e2e8f0',
        borderRadius: 12,
        padding: 16,
        maxWidth: 280,
        minWidth: 220,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...currentStep.popoverStyle,
      }}
    >
      {hasTarget && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: 16,
            height: 16,
            backgroundColor: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRight: 'none',
            borderBottom: 'none',
            ...arrowPositions[placement],
          }}
        />
      )}
      <div id="tour-step-text" style={{ fontSize: 16, lineHeight: 1.5 }}>
        {currentStep.content}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button style={buttonStyle} onClick={cancel}>
          Skip
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button style={buttonStyle} onClick={prev}>
              Prev
            </button>
          )}
          <button style={primaryButtonStyle} onClick={next} disabled={!ready}>
            {step + 1 === totalSteps ? 'Finish' : `Next (${step + 1} of ${totalSteps})`}
            {hasGate && ready && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 6,
                  border: '2px solid rgba(255, 255, 255, 0.6)',
                  pointerEvents: 'none',
                  animation: 'tour-next-ring 2s ease-out infinite',
                }}
              />
            )}
          </button>
        </div>
      </div>
      {hasGate && ready && (
        <style>{`@keyframes tour-next-ring {
          0% { inset: 0; border-color: rgba(255, 255, 255, 0.5); }
          50% { inset: -8px; border-color: rgba(255, 255, 255, 0); }
          100% { inset: -8px; border-color: rgba(255, 255, 255, 0); }
        }`}</style>
      )}
    </div>
  );
}
