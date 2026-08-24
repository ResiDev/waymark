import type { Event, TourRuntime, TourSnapshot, WaymarkStep } from "./types";

export function stepSelector<CallbackArgs>(
  step: WaymarkStep<CallbackArgs>,
): string | undefined {
  return step.waymark ? `[data-waymark=${step.waymark}]` : step.selector;
}

export function runFrame<CallbackArgs>({
  state,
  runtime,
  step,
  root,
  now,
}: {
  state: TourSnapshot;
  runtime: TourRuntime;
  step: WaymarkStep<CallbackArgs>;
  root: Document | Element;
  now: number;
}): { runtime: TourRuntime; events: Array<Event> } {
  const events: Array<Event> = [];
  const newRuntime: TourRuntime = {
    ...runtime,
    frameState: { ...runtime.frameState },
  };
  const selector = stepSelector(step);

  // find highlighted element
  if (
    selector &&
    (!runtime.highlightedElement || !runtime.highlightedElement.isConnected)
  ) {
    newRuntime.highlightedElement = root.querySelector(selector);
  }
  const el = newRuntime.highlightedElement;
  const rect = el?.getBoundingClientRect() ?? null;

  // Mark the target element so screen readers announce it has an associated dialog
  if (el !== newRuntime.frameState.ariaAnnotatedElement) {
    newRuntime.frameState.ariaAnnotatedElement?.removeAttribute(
      "aria-haspopup",
    );
    newRuntime.frameState.ariaAnnotatedElement?.removeAttribute(
      "aria-expanded",
    );
    if (el) {
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-expanded", "true");
    }
    newRuntime.frameState.ariaAnnotatedElement = el;
  }

  // scrollIntoView behaviour: only when the target is fully off-screen.
  const inView =
    rect !== null &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < globalThis.innerHeight &&
    rect.left < globalThis.innerWidth;
  if (
    el &&
    !inView &&
    state.focused &&
    state.highlightTargetStatus === "found" &&
    step.scrollIntoView !== "never"
  ) {
    if (
      step.scrollIntoView === "always" ||
      !newRuntime.frameState.scrolledIntoViewOnce
    ) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    newRuntime.frameState.scrolledIntoViewOnce = true;
  }

  // auto advance: when the check passes, arm a deadline (now when there is
  // no delay). The loop is its own clock: resetRuntime clearing the deadline
  // on step change is also the cancellation.
  if (
    step.advanceWhen?.type === "state" &&
    step.advanceWhen.check(el ?? undefined)
  ) {
    if (!step.advanceWhen.disableAutoAdvance) {
      newRuntime.frameState.autoAdvanceAt ??=
        now + (step.advanceWhen.delayMs ?? 0);
    }
    if (step.advanceWhen.gateNext) {
      events.push({ type: "gateConditionMet" });
    }
  }
  if (
    newRuntime.frameState.autoAdvanceAt !== undefined &&
    now >= newRuntime.frameState.autoAdvanceAt
  ) {
    events.push({ type: "advance" });
  }

  // target present/missing transitions; the reducer owns the state changes.
  if (!el && selector) {
    if (
      (state.highlightTargetStatus === "searching" ||
        state.highlightTargetStatus === "found") &&
      state.focused
    ) {
      events.push({ type: "unfocus" });
    }
    if (state.highlightTargetStatus === "found") {
      events.push({ type: "lost" });
    }
  }
  if (el && state.highlightTargetStatus === "searching") {
    events.push({ type: "found" });
  }

  // measure every frame; the reducer's sameRect check decides what is news.
  events.push({ type: "measured", value: rect });

  return { runtime: newRuntime, events };
}
