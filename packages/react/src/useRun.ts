import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createRun } from "waymark";
import type { Run, RunEvent, UiElements, Walkthrough } from "waymark";
import type { WalkthroughStep } from "./types";

export type UiRefs = Readonly<{
  dialogRef: RefObject<HTMLDivElement>;
  beaconRef: RefObject<HTMLButtonElement>;
}>;

/** Refs for the popover and beacon, and a getter the Run reads them through when it needs them. */
export function useUiRefs(): UiRefs & { ui: () => UiElements } {
  const dialogRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLButtonElement>(null);
  // Read when the Run fires, not during render.
  // oxlint-disable-next-line react/refs
  const ui = useCallback(() => ({ dialog: dialogRef.current, beacon: beaconRef.current }), []);
  return { dialogRef, beaconRef, ui };
}

/** Subscribes to a Run someone else owns and exposes its snapshot and actions. */
export function useRunView<TStep extends WalkthroughStep>(run: Run<TStep>) {
  const snapshot = useSyncExternalStore(run.subscribe, run.getSnapshot, run.getSnapshot);
  const act = run.act;
  return {
    snapshot,
    advance: useCallback(() => act("advance"), [act]),
    previous: useCallback(() => act("previous"), [act]),
    collapse: useCallback(() => act("collapse"), [act]),
    resume: useCallback(() => act("resume"), [act]),
    reset: useCallback(() => act("reset"), [act]),
    exit: useCallback(() => act("exit"), [act]),
  };
}

/** Creates and owns one Run of the walkthrough, replacing it only when the walkthrough or padding changes. */
export function useOwnedRun<TStep extends WalkthroughStep>({
  walkthrough,
  waymarkPadding,
  onEvent,
  ui,
}: {
  walkthrough: Walkthrough<TStep>;
  waymarkPadding: number;
  onEvent?: ((event: RunEvent<TStep>) => void) | undefined;
  ui: () => UiElements;
}): Run<TStep> {
  const eventRef = useRef(onEvent);
  useLayoutEffect(() => {
    eventRef.current = onEvent;
  }, [onEvent]);

  return useMemo(
    () =>
      // The closure reads the ref when the Run fires, not during render.
      // oxlint-disable-next-line react/refs
      createRun(walkthrough, {
        root: document,
        waymarkPadding,
        onEvent: (event) => eventRef.current?.(event),
        ui,
      }),
    [waymarkPadding, walkthrough, ui],
  );
}
