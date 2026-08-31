import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createRun } from "waymark";
import type { RunEvent, Tutorial } from "waymark";
import type { TutorialStep } from "./types";

export function useRun<TStep extends TutorialStep>({
  tutorial,
  waymarkPadding,
  onEvent,
}: {
  tutorial: Tutorial<TStep>;
  waymarkPadding: number;
  onEvent?: (event: RunEvent<TStep>) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLButtonElement>(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  const run = useMemo(
    () =>
      createRun(tutorial, {
        root: document,
        waymarkPadding,
        onEvent: (event) => eventRef.current?.(event),
        ui: () => ({
          dialog: dialogRef.current,
          beacon: beaconRef.current,
        }),
      }),
    [waymarkPadding, tutorial],
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
