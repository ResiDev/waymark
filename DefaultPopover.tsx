import type { TutorialRenderProps } from './types';

export function DefaultPopover({ currentStep, step, totalSteps, next, prev, reset }: TutorialRenderProps) {
  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '4px 0',
    fontSize: 13,
  };
  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderRadius: 6,
    padding: '6px 14px',
  };
  return (
    <div
      style={{
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
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{currentStep.text}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button style={buttonStyle} onClick={reset}>
          Skip
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button style={buttonStyle} onClick={prev}>
              Prev
            </button>
          )}
          <button style={primaryButtonStyle} onClick={next}>
            {step + 1 === totalSteps ? 'Finish' : `Next (${step + 1} of ${totalSteps})`}
          </button>
        </div>
      </div>
    </div>
  );
}
