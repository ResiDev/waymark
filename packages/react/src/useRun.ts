import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createRun } from "waymark";
import type { Run, RunEvent, RunStorage, UiElements, Walkthrough } from "waymark";
import type { WalkthroughStep } from "./types";

export type UiRefs = Readonly<{
  dialogRef: RefObject<HTMLDivElement>;
  beaconRef: RefObject<HTMLButtonElement>;
}>;

export function useUiRefs(): UiRefs & { ui: () => UiElements } {
  const dialogRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLButtonElement>(null);
  const ui = useCallback(() => ({ dialog: dialogRef.current, beacon: beaconRef.current }), []);
  return { dialogRef, beaconRef, ui };
}

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

export function useOwnedRun<TStep extends WalkthroughStep>({
  walkthrough,
  waymarkPadding,
  onEvent,
  storage,
  onStorageError,
  ui,
}: {
  walkthrough: Walkthrough<TStep>;
  waymarkPadding: number;
  onEvent?: ((event: RunEvent<TStep>) => void) | undefined;
  storage?: RunStorage | undefined;
  onStorageError?: ((error: unknown) => void) | undefined;
  ui: () => UiElements;
}): Run<TStep> {
  const eventRef = useRef(onEvent);
  const storageErrorRef = useRef(onStorageError);
  useLayoutEffect(() => {
    eventRef.current = onEvent;
    storageErrorRef.current = onStorageError;
  }, [onEvent, onStorageError]);
  // The first ones only: an inline object is new each render, and a new Run
  // for each would reload storage and start the walkthrough over. Without a
  // handler, core logs the failure.
  const [firstStorage] = useState(storage);
  const [handlesStorageErrors] = useState(onStorageError !== undefined);

  return useMemo(
    () =>
      // The closures read the refs when the Run fires, not during render.
      // oxlint-disable-next-line react/refs
      createRun(walkthrough, {
        root: document,
        waymarkPadding,
        onEvent: (event) => eventRef.current?.(event),
        ...(firstStorage && { storage: firstStorage }),
        ...(handlesStorageErrors && {
          onStorageError: (error) => storageErrorRef.current?.(error),
        }),
        ui,
      }),
    [waymarkPadding, walkthrough, ui, firstStorage, handlesStorageErrors],
  );
}
