import { onTestFinished } from "vitest";
import type { AttachOptions, Run, Running, UiElements } from "../run/types";
import type { WalkthroughProgress } from "../walkthrough/types";

/**
 * Attaches as a renderer would, until the test ends, and reads what the
 * renderer would draw: the open walkthrough, which it says is there.
 */
export const watch = (run: Run, options: AttachOptions & { ui?: () => UiElements } = {}) => {
  const { ui = () => ({ dialog: null }), ...attachOptions } = options;
  const stop = run.attach(ui, attachOptions);
  onTestFinished(stop);
  return {
    stop,
    get snapshot(): Running {
      const open = run.getSnapshot().open;
      if (open === null) throw new Error("No walkthrough is open.");
      return open.snapshot;
    },
  };
};

/** A walkthrough's progress, which is kept whether or not it is open. */
export const progressOf = (run: Run, id = "tour"): WalkthroughProgress | undefined => run.getSnapshot().progress[id];
