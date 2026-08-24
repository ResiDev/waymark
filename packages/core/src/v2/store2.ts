import { assertUnreachable } from "../utils";
import { runFrame, stepSelector } from "./rafLoop";
import { getCallbackName, isAction } from "./types";
import type {
  Config,
  Tour,
  Event,
  FrameState,
  TourRuntime,
  TourSnapshot,
  Action,
} from "./types";

function initialSnapshot(initCanAdvance: boolean): TourSnapshot {
  return {
    step: 0,
    active: true,
    focused: true,
    canAdvance: initCanAdvance,
    highlightTargetStatus: "searching",
    highlightedElementRect: null,
  };
}

const initialFrameState = (): FrameState => ({
  scrolledIntoViewOnce: false,
  ariaAnnotatedElement: null,
  autoAdvanceAt: undefined,
});

const sameRect = (a: DOMRect | null, b: DOMRect | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
};

const reduce = (
  state: TourSnapshot,
  e: Event,
  { isGated }: { isGated: (stepNumber: number) => boolean },
): TourSnapshot => {
  const goTo = (step: number) => ({
    ...state,
    step,
    focused: true,
    canAdvance: isGated(step),
    highlightTargetStatus: "searching" as const,
    highlightedElementRect: null,
  });

  switch (e.type) {
    case "gateConditionMet": {
      if (state.canAdvance) return state;
      return { ...state, canAdvance: true };
    }
    case "advance": {
      if (isGated(state.step)) return state;
      return goTo(state.step + 1);
    }
    case "prev": {
      if (state.step === 0) return state;
      return goTo(state.step - 1);
    }
    case "focus": {
      return { ...state, focused: true };
    }
    case "unfocus": {
      return { ...state, focused: false };
    }
    case "reset": {
      return goTo(0);
    }
    case "exit": {
      return { ...state, active: false, focused: false };
    }
    case "found": {
      return { ...state, highlightTargetStatus: "found", focused: true };
    }
    case "lost": {
      return { ...state, highlightTargetStatus: "lost", focused: false };
    }
    case "measured": {
      if (sameRect(state.highlightedElementRect, e.value)) return state;
      return { ...state, highlightedElementRect: e.value };
    }
    default: {
      return assertUnreachable(e);
    }
  }
};

export function createTour<CallbackArgs>(config: Config<CallbackArgs>): Tour {
  let state = initialSnapshot(!config.getStep(0).advanceWhen?.gateNext);
  const listeners = new Set<() => void>();

  let runtime: TourRuntime = {
    highlightedElement: null,
    frameState: initialFrameState(),
  };
  let frameId: number | undefined;

  // Was disposeFrameState: drop everything the loop accumulated for the
  // current step so the next tick starts from "searching".
  const resetRuntime = () => {
    const { ariaAnnotatedElement } = runtime.frameState;
    ariaAnnotatedElement?.removeAttribute("aria-haspopup");
    ariaAnnotatedElement?.removeAttribute("aria-expanded");
    runtime = {
      highlightedElement: null,
      frameState: initialFrameState(),
    };
  };

  const fireCallback = (action: Action, currStepNumber: number) => {
    const step = config.getStep(currStepNumber);
    const context = {
      stepIndex: currStepNumber,
      targetSelector: stepSelector(step),
      callbackArgs: step.callbackArgs,
    };

    const name = getCallbackName(action);
    config.tourCallbacks[name]?.(context);
    step.callbacks?.[name]?.(context);
  };

  const isGated = (stepNumber: number) =>
    !!config.getStep(stepNumber).advanceWhen?.gateNext;

  const dispatch = (e: Event) => {
    const currStepNumber = state.step; // capture for callbacks
    const next = reduce(state, e, { isGated });
    if (next === state) return; // avoid calling listeners if same
    if (next.step !== state.step) resetRuntime(); // reset on each new step
    state = next;
    listeners.forEach((l) => l());
    if (isAction(e.type)) fireCallback(e.type, currStepNumber);
  };

  const tick = () => {
    const step = config.getStep(state.step);
    const result = runFrame({
      state,
      runtime,
      step,
      root: config.root,
      now: performance.now(),
    });
    runtime = result.runtime;
    for (const e of result.events) {
      const stepBefore = state.step;
      dispatch(e);
      // A step change makes the rest of this frame's events stale.
      if (state.step !== stepBefore) break;
    }
    frameId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (frameId === undefined) tick();
  };

  const stop = () => {
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
    resetRuntime();
  };

  return {
    getSnapshot: () => state,
    // The loop runs only while someone is watching.
    subscribe: (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) stop();
      };
    },
    advance: () => dispatch({ type: "advance" }),
    targetClick: () => {
      const step = config.getStep(state.step);
      if (step.advanceWhen?.type !== "click") return; // remove all non-clicks
      if (step.advanceWhen.gateNext) dispatch({ type: "gateConditionMet" });
      if (!step.advanceWhen.disableAutoAdvance) dispatch({ type: "advance" });
    },
    prev: () => dispatch({ type: "prev" }),
    focus: () => dispatch({ type: "focus" }),
    unfocus: () => dispatch({ type: "unfocus" }),
    reset: () => dispatch({ type: "reset" }),
    exit: () => dispatch({ type: "exit" }),
  };
}
