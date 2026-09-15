import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createRun } from "waymark";
import type { RunEvent, Walkthrough } from "waymark";
import type { WalkthroughStep } from "./types";

export function useRun<TStep extends WalkthroughStep>({
  walkthrough,
  waymarkPadding,
  onEvent,
}: {
  walkthrough: Walkthrough<TStep>;
  waymarkPadding: number;
  onEvent?: ((event: RunEvent<TStep>) => void) | undefined;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLButtonElement>(null);
  const eventRef = useRef(onEvent);
  useLayoutEffect(() => {
    eventRef.current = onEvent;
  }, [onEvent]);

  const run = useMemo(
    () =>
      // The closures read the refs when the Run fires, not during render.
      // oxlint-disable-next-line react/refs
      createRun(walkthrough, {
        root: document,
        waymarkPadding,
        onEvent: (event) => eventRef.current?.(event),
        ui: () => ({
          dialog: dialogRef.current,
          beacon: beaconRef.current,
        }),
      }),
    [waymarkPadding, walkthrough],
  );

  const snapshot = useSyncExternalStore(
    run.subscribe,
    run.getSnapshot,
    run.getSnapshot,
  );
  const act = run.act;

  return {
    snapshot,
    dialogRef,
    beaconRef,
    advance: useCallback(() => act("advance"), [act]),
    previous: useCallback(() => act("previous"), [act]),
    collapse: useCallback(() => act("collapse"), [act]),
    resume: useCallback(() => act("resume"), [act]),
    reset: useCallback(() => act("reset"), [act]),
    exit: useCallback(() => act("exit"), [act]),
  };
}
