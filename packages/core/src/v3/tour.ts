import { assertUnreachable } from "../utils";
import { handleTourClick, handleTourKeyDown } from "./handlers";
import { getCallbackName, isAction, stepSelector } from "./types";
import type {
  Action,
  Config,
  Effect,
  FrameReading,
  Model,
  Msg,
  Tour,
  WaymarkStep,
} from "./types";
import { createRuntime, type Sub } from "./runtime";

// ---------------------------------------------------------------------------
// Pure helpers

const sameRect = (a: DOMRect | null, b: DOMRect | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
};

const shallowEqual = <T extends object>(a: T, b: T) =>
  a === b || (Object.keys(a) as Array<keyof T>).every((k) => a[k] === b[k]);

/** Return `a` itself when nothing differs, so the runtime can skip notifying. */
const settle = <T extends object>(a: T, b: T) => (shallowEqual(a, b) ? a : b);

// ---------------------------------------------------------------------------
// update: (model, msg) -> { model, effects }. Pure.

const makeUpdate = <CallbackArgs>(config: Config<CallbackArgs>) => {
  const hasGate = (n: number) => !!config.getStep(n).advanceWhen?.gateNext;
  const canAutoAdvance = (n: number) => {
    const aw = config.getStep(n).advanceWhen;
    return !!aw && !aw.disableAutoAdvance;
  };

  const goTo = (m: Model, step: number): Model => ({
    ...m,
    step,
    focused: true,
    canAdvance: !hasGate(step),
    highlightTargetStatus: "searching",
    highlightedElementRect: null,
    el: null,
    scrolledOnce: false,
    conditionMetAt: undefined,
  });

  const update = (m: Model, msg: Msg): { model: Model; effects?: Array<Effect> } => {
    switch (msg.type) {
      case "advanceConditionMet": {
        if (canAutoAdvance(m.step)) return { model: goTo(m, m.step + 1) };
        if (m.canAdvance) return { model: m };
        return { model: { ...m, canAdvance: true } };
      }
      case "advance":
        return { model: m.canAdvance ? goTo(m, m.step + 1) : m };
      case "prev":
        return { model: m.step === 0 ? m : goTo(m, m.step - 1) };
      case "reset":
        return { model: goTo(m, 0) };
      case "focus":
        return { model: settle(m, { ...m, focused: true }) };
      case "unfocus":
        return { model: settle(m, { ...m, focused: false }) };
      case "exit":
        return { model: settle(m, { ...m, active: false, focused: false }) };
      case "frame":
        return frame(m, msg, config.getStep(m.step));
      default:
        return assertUnreachable(msg);
    }
  };

  /** Everything the old rafLoop decided, minus everything it did to the DOM. */
  const frame = (
    m: Model,
    r: FrameReading,
    step: WaymarkStep<CallbackArgs>,
  ): { model: Model; effects?: Array<Effect> } => {
    const effects: Array<Effect> = [];
    const targeted = stepSelector(step) !== undefined;
    let next: Model = {
      ...m,
      el: r.el,
      highlightedElementRect: sameRect(m.highlightedElementRect, r.rect)
        ? m.highlightedElementRect
        : r.rect,
    };

    // presence transitions
    if (!r.el && targeted) {
      if (m.highlightTargetStatus !== "lost") next.focused = false;
      if (m.highlightTargetStatus === "found") next.highlightTargetStatus = "lost";
    }
    if (r.el && m.highlightTargetStatus === "searching") {
      next.highlightTargetStatus = "found";
      next.focused = true;
    }

    // scroll into view when fully off-screen, once or always per step config
    const wantsScroll =
      r.el &&
      !r.inView &&
      next.focused &&
      next.highlightTargetStatus === "found" &&
      step.scrollIntoView !== "never" &&
      (step.scrollIntoView === "always" || !next.scrolledOnce);
    if (wantsScroll && r.el) {
      effects.push({ type: "scrollIntoView", el: r.el });
      next.scrolledOnce = true;
    }

    // advance condition for state steps: arm once, fire when due
    if (r.checkPassed && step.advanceWhen?.type === "state") {
      next.conditionMetAt ??= r.now + (step.advanceWhen.delayMs ?? 0);
    }
    next = settle(m, next);
    if (next.conditionMetAt !== undefined && r.now >= next.conditionMetAt) {
      const met = update(next, { type: "advanceConditionMet" });
      return { model: met.model, effects: [...effects, ...(met.effects ?? [])] };
    }
    return { model: next, effects };
  };

  return update;
};

// ---------------------------------------------------------------------------
// Sensors: the impure reads, packaged as a message.

const readFrame = <CallbackArgs>(
  m: Model,
  step: WaymarkStep<CallbackArgs>,
  root: Document | Element,
): Msg => {
  const selector = stepSelector(step);
  const el = !selector
    ? null
    : m.el?.isConnected
      ? m.el
      : root.querySelector(selector);
  const rect = el?.getBoundingClientRect() ?? null;
  const inView =
    rect !== null &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < globalThis.innerHeight &&
    rect.left < globalThis.innerWidth;
  const checkPassed =
    step.advanceWhen?.type === "state" && step.advanceWhen.check(el ?? undefined);
  return { type: "frame", el, rect, inView, checkPassed, now: performance.now() };
};

// ---------------------------------------------------------------------------
// subscriptions: (model) -> what should be live. Pure. The runtime diffs it.
// Step change, element swap, exit and unsubscribe all fall out of the diff.

const makeSubscriptions =
  <CallbackArgs>(config: Config<CallbackArgs>) =>
  (m: Model): Array<Sub<Model, Msg>> => {
    if (!m.active) return [];
    const step = config.getStep(m.step);
    const subs: Array<Sub<Model, Msg>> = [
      {
        key: "frame",
        start: (send, current) => {
          let id = requestAnimationFrame(function tick() {
            const now = current();
            send(readFrame(now, config.getStep(now.step), config.root));
            id = requestAnimationFrame(tick);
          });
          return () => cancelAnimationFrame(id);
        },
      },
      {
        key: "window",
        start: (send, current) => {
          const c = new AbortController();
          const ctx = () => ({
            snapshot: current(),
            step: config.getStep(current().step),
            highlightPadding: config.highlightPadding,
          });
          const forward = (m: Msg | undefined) => m && send(m);
          window.addEventListener(
            "click",
            (e) => forward(handleTourClick(e, ctx())),
            { capture: true, signal: c.signal },
          );
          window.addEventListener(
            "keydown",
            (e) => forward(handleTourKeyDown(e, ctx())),
            { signal: c.signal },
          );
          return () => c.abort();
        },
      },
    ];
    if (m.el) {
      const el = m.el;
      subs.push({
        key: "aria",
        deps: [el],
        start: () => {
          el.setAttribute("aria-haspopup", "dialog");
          el.setAttribute("aria-expanded", "true");
          return () => {
            el.removeAttribute("aria-haspopup");
            el.removeAttribute("aria-expanded");
          };
        },
      });
      if (step.advanceWhen?.type === "event") {
        const names = [step.advanceWhen.event].flat();
        subs.push({
          key: "target",
          deps: [el, m.step],
          start: (send) => {
            const c = new AbortController();
            for (const name of names)
              el.addEventListener(
                name,
                () => send({ type: "advanceConditionMet" }),
                { signal: c.signal },
              );
            return () => c.abort();
          },
        });
      }
    }
    return subs;
  };

// ---------------------------------------------------------------------------

const runEffect = (effect: Effect) => {
  switch (effect.type) {
    case "scrollIntoView":
      effect.el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    default:
      return assertUnreachable(effect.type);
  }
};

export function createTour<CallbackArgs>(config: Config<CallbackArgs>): Tour {
  const fireCallback = (action: Action, stepIndex: number) => {
    const step = config.getStep(stepIndex);
    const context = {
      stepIndex,
      targetSelector: stepSelector(step),
      callbackArgs: step.callbackArgs,
    };
    const name = getCallbackName(action);
    config.tourCallbacks[name]?.(context);
    step.callbacks?.[name]?.(context);
  };

  const rt = createRuntime<Model, Msg, Effect>({
    init: {
      step: 0,
      active: true,
      focused: true,
      canAdvance: !config.getStep(0).advanceWhen?.gateNext,
      highlightTargetStatus: "searching",
      highlightedElementRect: null,
      el: null,
      scrolledOnce: false,
      conditionMetAt: undefined,
    },
    update: makeUpdate(config),
    subscriptions: makeSubscriptions(config),
    subscriptionDeps: (m) => [m.active, m.step, m.el],
    runEffect,
    onChange: (prev, _next, msg) => {
      if (isAction(msg.type)) fireCallback(msg.type, prev.step);
    },
  });

  return {
    getSnapshot: rt.current,
    subscribe: rt.subscribe,
    advance: () => rt.send({ type: "advance" }),
    prev: () => rt.send({ type: "prev" }),
    focus: () => rt.send({ type: "focus" }),
    unfocus: () => rt.send({ type: "unfocus" }),
    reset: () => rt.send({ type: "reset" }),
    exit: () => rt.send({ type: "exit" }),
  };
}
