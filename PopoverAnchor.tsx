export function PopoverAnchor({
  highlight,
  padding,
  children,
}: {
  highlight: DOMRect;
  padding: number;
  children: React.ReactNode;
}) {
  return (
    <div
      data-tutorial-popover
      style={{
        pointerEvents: 'auto',
        position: 'fixed',
        top: highlight.bottom + padding + 8,
        left: highlight.left + highlight.width / 2,
        transform: 'translateX(-50%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -8,
          left: '50%',
          width: 16,
          height: 16,
          backgroundColor: '#1e293b',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRight: 'none',
          borderBottom: 'none',
          transform: 'translateX(-50%) rotate(45deg)',
        }}
      />
      {children}
    </div>
  );
}
