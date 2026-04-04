import { useRef, useState, useLayoutEffect } from 'react';

export function PopoverAnchor({
  highlight,
  padding,
  children,
}: {
  highlight: DOMRect;
  padding: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [popoverHeight, setPopoverHeight] = useState(0);

  useLayoutEffect(() => {
    if (ref.current) setPopoverHeight(ref.current.offsetHeight);
  }, [setPopoverHeight]);

  const spaceBelow = window.innerHeight - highlight.bottom - padding - 8;
  const showAbove = popoverHeight > 0 && spaceBelow < popoverHeight;

  const popoverBelow = { top: highlight.bottom + padding + 8, left: highlight.left + highlight.width / 2 };
  const popoverAbove = {
    top: highlight.top - padding - 8,
    transform: 'translateY(-100%) translateX(-50%)',
    left: highlight.left + highlight.width / 2,
  };

  const popoverPosition = showAbove ? popoverAbove : popoverBelow;

  const arrowAbove = {
    top: -8,
    left: '50%',
    transform: 'translateX(-50%) rotate(45deg)',
  };
  const arrowBelow = {
    bottom: -8,
    left: '50%',
    transform: 'rotate(225deg)',
  };

  const arrowPosition = showAbove ? arrowBelow : arrowAbove;

  return (
    <div
      ref={ref}
      data-tour-popover
      style={{
        pointerEvents: 'auto',
        position: 'fixed',
        transform: 'translateX(-50%)',
        ...popoverPosition,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 16,
          height: 16,
          backgroundColor: '#1e293b',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRight: 'none',
          borderBottom: 'none',
          ...arrowPosition,
        }}
      />
      {children}
    </div>
  );
}
