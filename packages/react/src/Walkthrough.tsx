import {
  useEffect,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ChecklistSelections, Checklists, Rect, Run } from "waymark";
import { Beacon, DefaultPopover, Dialog, WaymarkShade } from "./view";
import type {
  ChecklistWalkthroughProps,
  GuidanceStep,
  ReactGuidanceTasks,
  WalkthroughProps,
  WalkthroughRenderProps,
  WalkthroughStep,
} from "./types";
import { useOwnedRun, useRunView, useUiRefs, type UiRefs } from "./useRun";

const centeredRect = (): Rect => {
  const left = window.innerWidth / 2;
  const top = window.innerHeight / 2;
  return {
    x: left,
    y: top,
    top,
    right: left,
    bottom: top,
    left,
    width: 0,
    height: 0,
  };
};

export function Walkthrough<TStep extends WalkthroughStep>(
  props: WalkthroughProps<TStep>,
): ReactElement | null;
// Guidance never calls `update`, the one place an owner's context appears, so every owner fits `never`.
export function Walkthrough<
  TTasks extends ReactGuidanceTasks,
  TSelections extends ChecklistSelections<TTasks>,
>(
  props: ChecklistWalkthroughProps<never, TTasks, TSelections>,
): ReactElement | null;
export function Walkthrough<
  TStep extends WalkthroughStep,
  TTasks extends ReactGuidanceTasks,
  TSelections extends ChecklistSelections<TTasks>,
>(
  props:
    | WalkthroughProps<TStep>
    | ChecklistWalkthroughProps<never, TTasks, TSelections>,
): ReactElement | null {
  if (typeof document === "undefined") return null;
  if (props.checklists !== undefined) {
    return (
      <ChecklistGuidance
        checklists={props.checklists}
        renderPopover={props.renderPopover}
      />
    );
  }
  if (props.active === false) return null;
  return <ActiveWalkthrough {...props} />;
}

function ActiveWalkthrough<TStep extends WalkthroughStep>({
  walkthrough,
  waymarkPadding = 20,
  onEvent,
  renderPopover,
}: WalkthroughProps<TStep>) {
  const { dialogRef, beaconRef, ui } = useUiRefs();
  const run = useOwnedRun({ walkthrough, waymarkPadding, onEvent, ui });
  return (
    <RunView
      run={run}
      waymarkPadding={waymarkPadding}
      renderPopover={renderPopover}
      dialogRef={dialogRef}
      beaconRef={beaconRef}
    />
  );
}

/** Which renderer currently holds each owner's UI binding, so a pending stop can tell a handoff from an unmount. */
const holders = new WeakMap<object, symbol>();

/**
 * Removing this renderer stops the active Run a microtask later, and only if
 * no renderer has taken the binding back: React may clean up and re-run the
 * effect on a component that stays mounted.
 */
function ChecklistGuidance<
  TTasks extends ReactGuidanceTasks,
  TSelections extends ChecklistSelections<TTasks>,
>({
  checklists,
  renderPopover,
}: {
  checklists: Checklists<never, TTasks, TSelections>;
  renderPopover?:
    | ChecklistWalkthroughProps<never, TTasks, TSelections>["renderPopover"]
    | undefined;
}) {
  const { dialogRef, beaconRef, ui } = useUiRefs();
  const { active } = useSyncExternalStore(
    checklists.subscribe,
    checklists.getSnapshot,
    checklists.getSnapshot,
  );

  useEffect(() => {
    const token = Symbol("waymark renderer");
    holders.set(checklists, token);
    const release = checklists.bindUi(ui);
    return () => {
      release();
      if (holders.get(checklists) === token) holders.delete(checklists);
      const leaving = checklists.getSnapshot().active;
      if (leaving === null) return;
      queueMicrotask(() => {
        if (holders.has(checklists)) return;
        if (checklists.getSnapshot().active?.run !== leaving.run) return;
        checklists.stop();
      });
    };
  }, [checklists, ui]);

  if (active === null) return null;
  const { task } = active;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Run's steps come from these Tasks, which ReactGuidanceTasks holds to WalkthroughStep; TS cannot follow StepOf while TTasks is generic.
  const run = active.run as Run<GuidanceStep<TTasks>>;
  return (
    <RunView
      run={run}
      skipTask={() => checklists.skip(task.id)}
      waymarkPadding={checklists.waymarkPadding}
      renderPopover={renderPopover}
      dialogRef={dialogRef}
      beaconRef={beaconRef}
    />
  );
}

function RunView<TStep extends WalkthroughStep>({
  run,
  skipTask,
  waymarkPadding,
  renderPopover,
  dialogRef,
  beaconRef,
}: UiRefs & {
  run: Run<TStep>;
  skipTask?: (() => void) | undefined;
  waymarkPadding: number;
  renderPopover?:
    | ((props: WalkthroughRenderProps<TStep>) => ReactNode)
    | undefined;
}) {
  const { snapshot, advance, previous, collapse, resume, reset, exit } =
    useRunView(run);

  if (snapshot.phase !== "running") return null;
  if (
    snapshot.waymark.status === "searching" ||
    snapshot.waymark.status === "lost"
  ) {
    return null;
  }

  const rect =
    snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
  if (snapshot.collapsed) {
    return <Beacon rect={rect} beaconRef={beaconRef} onResume={resume} />;
  }

  const anchor = rect ?? centeredRect();
  const render = (placement: WalkthroughRenderProps<TStep>["placement"]) => {
    const renderProps: WalkthroughRenderProps<TStep> = {
      snapshot,
      currentStep: snapshot.step,
      placement,
      hasWaymark: rect !== null,
      advance,
      previous,
      collapse,
      reset,
      exit,
      ...(skipTask ? { skipTask } : {}),
    };
    return renderPopover?.(renderProps) ?? <DefaultPopover {...renderProps} />;
  };

  return (
    <>
      <WaymarkShade rect={rect} padding={rect ? waymarkPadding : 0} />
      <Dialog
        key={snapshot.stepIndex}
        rect={anchor}
        padding={rect ? waymarkPadding : 0}
        preferred={snapshot.step.preferredPlacement}
        dialogRef={dialogRef}
        ariaLabel={`Step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`}
      >
        {render}
      </Dialog>
    </>
  );
}
