import type { Event, StepRuntime, TourSnapshot, WaymarkStep } from "./types";

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
  runtime: StepRuntime;
  step: WaymarkStep<CallbackArgs>;
  root: Document | Element;
  now: number;
}): { runtime: StepRuntime; events: Array<Event> } {
  const events: Array<Event> = [];
  const newRuntime: StepRuntime = {
    ...runtime,
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
  if (el !== newRuntime.ariaAnnotatedElement) {
    newRuntime.ariaAnnotatedElement?.removeAttribute("aria-haspopup");
    newRuntime.ariaAnnotatedElement?.removeAttribute("aria-expanded");
    if (el) {
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-expanded", "true");
    }
    newRuntime.ariaAnnotatedElement = el;
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
    if (step.scrollIntoView === "always" || !newRuntime.scrolledIntoViewOnce) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    newRuntime.scrolledIntoViewOnce = true;
  }

  // Auto advance event if the check has been met, and after required delay
  if (
    step.advanceWhen?.type === "state" &&
    step.advanceWhen.check(el ?? undefined)
  ) {
    newRuntime.autoAdvanceAt ??= now + (step.advanceWhen.delayMs ?? 0);
  }
  const conditionMetAt = newRuntime.autoAdvanceAt;
  if (conditionMetAt !== undefined && now >= conditionMetAt) {
    events.push({ type: "advanceConditionMet" }); // same frame if previous condition = now
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
