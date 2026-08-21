export function Highlight({
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
      style={{
        pointerEvents: 'none',
        position: 'fixed',
        zIndex: 50,
        top: highlight.top - padding,
        left: highlight.left - padding,
        width: highlight.width + padding * 2,
        height: highlight.height + padding * 2,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}
