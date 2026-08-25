import { assertUnreachable } from "../utils";
import { handleTourClick, handleTourKeyDown } from "./handlers";
import { runFrame, stepSelector } from "./rafLoop";
import { getCallbackName, isAction } from "./types";
import type {
  Config,
  Tour,
  Event,
  StepRuntime,
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

const initialStepRuntime = (): StepRuntime => ({
  highlightedElement: null,
  scrolledIntoViewOnce: false,
  ariaAnnotatedElement: null,
  autoAdvanceAt: undefined,
  targetListenersController: null,
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
  {
    hasGate,
    canAutoAdvance,
  }: {
    hasGate: (stepNumber: number) => boolean;
    canAutoAdvance: (stepNumber: number) => boolean;
  },
): TourSnapshot => {
  const goTo = (step: number) => ({
    ...state,
    step,
    focused: true,
    canAdvance: !hasGate(step),
    highlightTargetStatus: "searching" as const,
    highlightedElementRect: null,
  });

  switch (e.type) {
    case "advanceConditionMet": {
      if (canAutoAdvance(state.step)) return goTo(state.step + 1);
      if (state.canAdvance) return state; // already open; nothing to announce. Avoid state changes each frame
      return { ...state, canAdvance: true };
    }
    case "advance": {
      if (!state.canAdvance) return state;
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

  let runtime: StepRuntime = initialStepRuntime();

  // Drop everything the loop accumulated for the
  // current step so the next tick starts from "searching".
  const resetRuntime = () => {
    runtime.ariaAnnotatedElement?.removeAttribute("aria-haspopup");
    runtime.ariaAnnotatedElement?.removeAttribute("aria-expanded");
    runtime.targetListenersController?.abort();
    runtime = initialStepRuntime();
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

  const hasGate = (stepNumber: number) =>
    !!config.getStep(stepNumber).advanceWhen?.gateNext;
  const canAutoAdvance = (stepNumber: number) => {
    const advanceWhen = config.getStep(stepNumber).advanceWhen;
    return !!advanceWhen && !advanceWhen.disableAutoAdvance;
  };

  const dispatch = (e: Event) => {
    const currStepNumber = state.step; // capture for callbacks
    const next = reduce(state, e, { hasGate, canAutoAdvance });
    if (next === state) return; // avoid calling listeners if same
    if (next.step !== state.step) resetRuntime(); // reset on each new step
    state = next;
    listeners.forEach((l) => l());
    if (isAction(e.type)) fireCallback(e.type, currStepNumber);
  };

  let frameId: number | undefined;

  const bindTargetListeners = (el: Element | null) => {
    runtime.targetListenersController?.abort();
    runtime.targetListenersController = null;
    const aw = config.getStep(state.step).advanceWhen;
    if (!el || aw?.type !== "event") return;
    const c = new AbortController();
    for (const name of [aw.event].flat()) {
      el.addEventListener(
        name,
        () => dispatch({ type: "advanceConditionMet" }),
        { signal: c.signal },
      );
    }
    runtime.targetListenersController = c;
  };

  const tick = () => {
    const prevEl = runtime.highlightedElement;
    const step = config.getStep(state.step);
    const result = runFrame({
      state,
      runtime,
      step,
      root: config.root,
      now: performance.now(),
    });
    runtime = result.runtime;
    if (runtime.highlightedElement !== prevEl)
      bindTargetListeners(runtime.highlightedElement);
    for (const e of result.events) {
      const stepBefore = state.step;
      dispatch(e);
      // A step change makes the rest of this frame's events stale.
      if (state.step !== stepBefore) break;
    }
    frameId = requestAnimationFrame(tick);
  };

  const ctx = () => ({
    snapshot: state,
    step: config.getStep(state.step),
    highlightPadding: config.highlightPadding,
  });
  const handle = (e: Event | undefined) => {
    if (e) dispatch(e);
  };

  let inputs: AbortController | undefined;

  const start = () => {
    if (frameId !== undefined) return;
    inputs = new AbortController();
    const { signal } = inputs;
    window.addEventListener("click", (e) => handle(handleTourClick(e, ctx())), {
      capture: true,
      signal,
    });
    window.addEventListener(
      "keydown",
      (e) => handle(handleTourKeyDown(e, ctx())),
      { signal },
    );
    tick();
  };

  const stop = () => {
    inputs?.abort();
    inputs = undefined;
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
    prev: () => dispatch({ type: "prev" }),
    focus: () => dispatch({ type: "focus" }),
    unfocus: () => dispatch({ type: "unfocus" }),
    reset: () => dispatch({ type: "reset" }),
    exit: () => dispatch({ type: "exit" }),
  };
}
