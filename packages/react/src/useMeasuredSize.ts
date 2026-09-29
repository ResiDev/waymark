import { useLayoutEffect, useState, type RefObject } from "react";
import type { Size } from "./placement";

export function useMeasuredSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- measured after every render, since any render can resize it; the equality check stops the chain
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const next = { width: element.offsetWidth, height: element.offsetHeight };
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    );
  });
  return size;
}
