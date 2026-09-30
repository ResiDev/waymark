import { useLayoutEffect, useState, type RefObject } from "react";
import type { Size } from "./placement";

/** `mounted` says when the element is rendered, for one that comes and goes. */
export function useMeasuredSize(ref: RefObject<HTMLElement>, mounted: boolean): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!mounted || !element) return;
    const measure = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    measure();
    // jsdom has no layout observer; initial measurement still works there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return size;
}
