import { useRef, useState, useLayoutEffect } from 'react';

export type Placement = 'above' | 'below' | 'left' | 'right';

function choosePlacement(
  prev: Placement,
  popoverH: number,
  popoverW: number,
  highlight: DOMRect,
  gap: number,
  windowMarginPx: number,
  preferred: Placement
) {
  const mirror: Record<Placement, Placement> = { above: 'below', below: 'above', left: 'right', right: 'left' };

  const spaces: Record<Placement, number> = {
    below: window.innerHeight - highlight.bottom - gap,
    above: highlight.top - gap,
    right: window.innerWidth - highlight.right - gap,
    left: highlight.left - gap,
  };

  const centerYWidth = highlight.left + highlight.width / 2;
  const centerXHeight = highlight.top + highlight.height / 2;

  const fits = (p: Placement) => {
    const isVertical = p === 'above' || p === 'below';
    const mainAxisFits = spaces[p] >= (isVertical ? popoverH : popoverW);
    const orthogonalAxisFits = isVertical
      ? centerYWidth - popoverW / 2 >= windowMarginPx &&
        centerYWidth + popoverW / 2 <= window.innerWidth - windowMarginPx
      : centerXHeight - popoverH / 2 >= windowMarginPx &&
        centerXHeight + popoverH / 2 <= window.innerHeight - windowMarginPx;
    return mainAxisFits && orthogonalAxisFits;
  };

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
  ariaLabel,
  children,
}: {
  highlight: DOMRect;
  padding: number;
  preferredPlacement?: Placement;
  ariaLabel?: string;
  children: (placement: Placement) => React.ReactNode;
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

    const result = choosePlacement(placement, h, w, highlight, gap, 8, preferred);
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
      setOverlapOffset(Math.max(0, needed - spaces[result.direction]));
    }
  }, [highlight, popoverHeight, placement, popoverWidth, gap, preferred]);

  const centerX = highlight.left + highlight.width / 2;
  const centerY = highlight.top + highlight.height / 2;

  const effectiveGap = gap - overlapOffset;

  const positions = {
    below: { top: highlight.bottom + effectiveGap, left: centerX, transform: 'translateX(-50%)' },
    above: {
      top: highlight.top - effectiveGap,
      left: centerX,
      transform: 'translateY(-100%) translateX(-50%)',
    },
    right: { top: centerY - popoverHeight / 2, left: highlight.right + effectiveGap },
    left: { top: centerY - popoverHeight / 2, left: highlight.left - effectiveGap - popoverWidth },
  } as const;

  const popoverPosition = positions[placement];

  return (
    <div
      ref={ref}
      data-tour-popover
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-describedby="tour-step-text"
      tabIndex={-1}
      style={{
        pointerEvents: 'auto',
        position: 'fixed',
        outline: 'none',
        ...popoverPosition,
      }}
    >
      {children(placement)}
    </div>
  );
}
