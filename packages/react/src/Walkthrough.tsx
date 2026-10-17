import { useEffect } from "react";
import type { WalkthroughProps, WalkthroughStep } from "./types";
import { useRun } from "./useRun";

/**
 * Says the page has a walkthrough to show: mounted, it asks the Run for it
 * with `requestStart`, so it waits for any open walkthrough and never comes
 * back once the user has finished or exited it. It draws nothing:
 * `<WaymarkRoot>` does.
 */
export function Walkthrough<TStep extends WalkthroughStep>({
  walkthrough,
  active = true,
}: WalkthroughProps<TStep>): null {
  const run = useRun();
  // Withdrawn on unmount, so a page left before its turn does not show it on the next.
  useEffect(() => (active ? run.requestStart(walkthrough) : undefined), [run, walkthrough, active]);
  return null;
}
