export function Beacon({ highlight, onClick }: { highlight: DOMRect; onClick: () => void }) {
  const cx = highlight.left + highlight.width / 2;
  const cy = highlight.bottom + 8;
  return (
    <>
      <div
        data-tour-beacon
        role="button"
        aria-label="Resume tutorial"
        tabIndex={0}
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
          position: 'fixed',
          top: cy,
          left: cx,
          transform: 'translate(-50%, -50%)',
          cursor: 'pointer',
          zIndex: 51,
        }}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: cy,
          left: cx,
          width: 0,
          height: 0,
          borderRadius: '50%',
          border: '2px solid rgba(255, 255, 255, 0.6)',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          animation: 'tutorial-beacon-ring 2s ease-out infinite',
        }}
      />
      <style>{`@keyframes tutorial-beacon-ring {
    0% { width: 22px; height: 22px; border-color: rgba(255,255,255,0.5); }
    50% { width: 50px; height: 50px; border-color: rgba(255,255,255,0); }
    100% { width: 50px; height: 50px; border-color: rgba(255,255,255,0); }
  }`}</style>
    </>
  );
}
