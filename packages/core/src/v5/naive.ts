/**
 * The naive Run: same public interface as run.ts, none of the protocol.
 * A reference for what the domain costs on its own — NOT exported, NOT used.
 *
 * It is obviously correct and unusable:
 *  [1] notifies every subscriber every frame, moving or not
 *  [2] builds a fresh Snapshot per call — breaks useSyncExternalStore (identity)
 *  [3] the frame loop and listeners run from creation until exit, watched or not
 *  [4] leaves aria attributes behind, re-scrolls every frame, re-fires conditions
 */
import { advanceRule, selectorFor } from "./tutorial";
import type { Action, Rect, Run, RunOptions, Snapshot, Step, Tutorial } from "./types";

export function createNaiveRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const steps = tutorial.steps;
  const rules = steps.map(advanceRule);

  let phase: "running" | "completed" | "exited" = "running";
  let index = options.startAt ?? 0;
  let collapsed = false;
  const listeners = new Set<() => void>();

  const element = (): Element | null => {
    const selector = selectorFor(steps[index]);
    return selector ? root.querySelector(selector) : null;
  };

  const getSnapshot = (): Snapshot<TStep> => {
    if (phase !== "running") return { phase, stepIndex: index, stepCount: steps.length };
    const el = element();
    const rect = el ? (el.getBoundingClientRect() as Rect) : null; // [2] fresh object, every call
    return {
      phase,
      step: steps[index],
      stepIndex: index,
      stepCount: steps.length,
      canAdvance: rules[index] === undefined || rules[index]?.byCheck?.(el) === true,
      collapsed,
      waymark:
        selectorFor(steps[index]) === undefined
          ? { status: "absent" }
          : rect
            ? { status: "found", rect }
            : { status: "searching" }, // never "lost": no memory of having found it
    };
  };

  const act = (action: Action) => {
    if (action === "reset") { phase = "running"; index = 0; return; }
    if (phase !== "running") return;
    if (action === "advance") {
      if (index + 1 < steps.length) index += 1;
      else phase = "completed";
    }
    if (action === "previous" && index > 0) index -= 1;
    if (action === "collapse") collapsed = true;
    if (action === "resume") collapsed = false;
    if (action === "exit") phase = "exited";
  };

  const tick = () => {
    if (phase !== "running") return; // [3] only exit stops the loop
    const el = element();
    el?.setAttribute("aria-haspopup", "dialog"); // [4] set every frame, removed never
    el?.scrollIntoView?.({ block: "center" }); // [4] re-scrolls every frame, fights the user
    if (rules[index]?.auto && rules[index]?.byCheck?.(el)) act("advance"); // [4] no delay, no latch
    for (const l of listeners) l(); // [1] unconditionally
    requestAnimationFrame(tick);
  };

  window.addEventListener("click", (e) => { // [3] attached forever, even before subscribe
    if (rules[index]?.byClick && element()?.contains(e.target as Node)) act("advance");
  });
  requestAnimationFrame(tick);

  return { act, getSnapshot, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) };
}
