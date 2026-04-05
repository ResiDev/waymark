import { useRef, useState, useLayoutEffect } from 'react';

export type Placement = 'above' | 'below' | 'left' | 'right';

function choosePlacement(
  prev: Placement,
  popoverH: number,
  popoverW: number,
  highlight: DOMRect,
  gap: number,
  preferred: Placement
) {
  const mirror: Record<Placement, Placement> = { above: 'below', below: 'above', left: 'right', right: 'left' };
  const spaces: Record<Placement, number> = {
    below: window.innerHeight - highlight.bottom - gap,
    above: highlight.top - gap,
    right: window.innerWidth - highlight.right - gap,
    left: highlight.left - gap,
  };
  const fits = (p: Placement) => spaces[p] >= (p === 'above' || p === 'below' ? popoverH : popoverW);

  if (fits(prev)) return { direction: prev, anyFit: true };

  const fallbackOrder: Placement[] = [preferred, mirror[preferred], 'below', 'above', 'right', 'left'];

  let chosenDirection: Placement | undefined;
  for (const direction of fallbackOrder) {
    if (fits(direction)) {
      chosenDirection = direction;
      break;
    }
  }
  if (!chosenDirection) {
    return { direction: preferred, anyFit: false };
  }
  return { direction: chosenDirection, anyFit: true };
}

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
  const preferred = preferredPlacement ?? 'below';
  const [placement, setPlacement] = useState<Placement>(preferred);
  const [overlapOffset, setOverlapOffset] = useState(0);
  const [popoverHeight, setPopoverHeight] = useState(0);
  const [popoverWidth, setPopoverWidth] = useState(0);

  const gap = padding + 8;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const h = ref.current.offsetHeight;
    const w = ref.current.offsetWidth;
    if (h !== popoverHeight) setPopoverHeight(h);
    if (w !== popoverWidth) setPopoverWidth(w);

    const result = choosePlacement(placement, h, w, highlight, gap, preferred);
    setPlacement(result.direction);

    if (result.anyFit) {
      setOverlapOffset(0);
    } else {
      const needed = result.direction === 'above' || result.direction === 'below' ? h : w;
      const spaces: Record<Placement, number> = {
        below: window.innerHeight - highlight.bottom - gap,
        above: highlight.top - gap,
        right: window.innerWidth - highlight.right - gap,
        left: highlight.left - gap,
      };
      setOverlapOffset(needed - spaces[result.direction]);
    }
  }, [highlight, popoverHeight, placement, popoverWidth, gap, preferred]);

  const centerX = highlight.left + highlight.width / 2;
  const centerY = highlight.top + highlight.height / 2;

  const effectiveGap = gap - overlapOffset;

  const positions = {
    below: {
      popover: { top: highlight.bottom + effectiveGap, left: centerX, transform: 'translateX(-50%)' },
      arrow: { top: -8, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
    },
    above: {
      popover: {
        top: highlight.top - effectiveGap,
        left: centerX,
        transform: 'translateY(-100%) translateX(-50%)',
      },
      arrow: { bottom: -8, left: '50%', transform: 'rotate(225deg)' },
    },
    right: {
      popover: { top: centerY - popoverHeight / 2, left: highlight.right + effectiveGap },
      arrow: { top: '50%', left: -8, transform: 'translateY(-50%) rotate(315deg)' },
    },
    left: {
      popover: { top: centerY - popoverHeight / 2, left: highlight.left - effectiveGap - popoverWidth },
      arrow: { top: '50%', right: -8, transform: 'translateY(-50%) rotate(135deg)' },
    },
  } as const;

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
