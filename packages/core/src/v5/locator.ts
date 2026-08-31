import { selectorFor } from "./tutorial";
import type { Location, Rect, Step } from "./types";

/**
 * Finds and follows one Step's Waymark, for as long as the Run is on that Step.
 *
 * A locator finds the element, keeps hold of it while it stays in the page,
 * measures it once a frame, announces it to screen readers, and scrolls it
 * into view. It reports all of that as a Location and nothing else.
 */
export type Locator = Readonly<{
  /** Re-reads the page. `active` is false while the Run is collapsed or ended. */
  locate: (active: boolean) => Location;
  element: () => Element | null;
  /** Lets go of the element, undoing everything done to it. */
  release: () => void;
}>;

type LocatorState = {
  /** The Waymark element, held while it stays in the page. */
  element: Element | null;
  /**
   * Once a Waymark has been seen it is never "searching" again: a Waymark that
   * leaves the page is "lost", however many times it comes and goes.
   */
  presence: "searching" | "found" | "lost";
  scrolledIntoViewOnce: boolean;
};

const ARIA = ["aria-haspopup", "aria-expanded"] as const;

const copyRect = (rect: DOMRect): Rect => ({
  x: rect.x,
  y: rect.y,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

const onScreen = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

export function sameLocation(a: Location, b: Location): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "found" || b.status !== "found") return true;
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

export function startLocating(step: Step, root: Document | Element): Locator {
  const selector = selectorFor(step);

  const state: LocatorState = {
    element: null,
    presence: "searching",
    scrolledIntoViewOnce: false,
  };

  const hold = (next: Element | null) => {
    if (next === state.element) return;
    for (const name of ARIA) state.element?.removeAttribute(name);
    state.element = next;
    // Tell assistive technology that this element has a popover attached.
    next?.setAttribute("aria-haspopup", "dialog");
    next?.setAttribute("aria-expanded", "true");
  };

  const locate = (active: boolean): Location => {
    if (selector !== undefined && (!state.element || !state.element.isConnected)) {
      hold(root.querySelector(selector));
    }
    const { element } = state;

    const rect = element ? copyRect(element.getBoundingClientRect()) : null;
    if (rect) state.presence = "found";
    else if (state.presence === "found") state.presence = "lost";

    if (element && rect && active && step.scroll !== "never" && !onScreen(rect)) {
      if (step.scroll === "always" || !state.scrolledIntoViewOnce) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        state.scrolledIntoViewOnce = true;
      }
    }

    if (selector === undefined) return { status: "absent" };
    if (rect) return { status: "found", rect };
    return { status: state.presence === "lost" ? "lost" : "searching" };
  };

  return {
    locate,
    element: () => state.element,
    release: () => hold(null),
  };
}
