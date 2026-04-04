import { useRef, useState, useLayoutEffect } from 'react';

export type Placement = 'above' | 'below' | 'left' | 'right';

export function PopoverAnchor({
  highlight,
  padding,
  preferredPlacement,
  children,
}: {
  highlight: DOMRect;
  padding: number;
  preferredPlacement?: Placement;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [popoverHeight, setPopoverHeight] = useState(0);
  const [popoverWidth, setPopoverWidth] = useState(0);

  useLayoutEffect(() => {
    if (ref.current) {
      setPopoverHeight(ref.current.offsetHeight);
      setPopoverWidth(ref.current.offsetWidth);
    }
  }, [highlight]);

  const gap = padding + 8;
  const centerX = highlight.left + highlight.width / 2;
  const centerY = highlight.top + highlight.height / 2;

  const spaceBelow = window.innerHeight - highlight.bottom - gap;
  const spaceAbove = highlight.top - gap;
  const spaceRight = window.innerWidth - highlight.right - gap;
  const spaceLeft = highlight.left - gap;

  const positions = {
    below: {
      popover: { top: highlight.bottom + gap, left: centerX, transform: 'translateX(-50%)' },
      arrow: { top: -8, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
      space: spaceBelow,
    },
    above: {
      popover: { top: highlight.top - gap, left: centerX, transform: 'translateY(-100%) translateX(-50%)' },
      arrow: { bottom: -8, left: '50%', transform: 'rotate(225deg)' },
      space: spaceAbove,
    },
    right: {
      popover: { top: centerY - popoverHeight / 2, left: highlight.right + gap },
      arrow: { top: '50%', left: -8, transform: 'translateY(-50%) rotate(315deg)' },
      space: spaceRight,
    },
    left: {
      popover: { top: centerY - popoverHeight / 2, left: highlight.left - gap - popoverWidth },
      arrow: { top: '50%', right: -8, transform: 'translateY(-50%) rotate(135deg)' },
      space: spaceLeft,
    },
  } as const;

  const mirror: Record<Placement, Placement> = { above: 'below', below: 'above', left: 'right', right: 'left' };
  const preferred = preferredPlacement ?? 'below';
  const fallbackOrder: Placement[] = [preferred, mirror[preferred], 'below', 'above', 'right', 'left'];

  // check if it fits in that posistion
  const fits = (p: Placement) => positions[p].space >= (p === 'above' || p === 'below' ? popoverHeight : popoverWidth);

  // select preferred placement or if none fit default back to preferred
  const placement = fallbackOrder.find(fits) ?? preferred;

  const { popover: popoverPosition, arrow: arrowPosition } = positions[placement];

  return (
    <div
      ref={ref}
      data-tour-popover
      style={{
        pointerEvents: 'auto',
        position: 'fixed',
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
