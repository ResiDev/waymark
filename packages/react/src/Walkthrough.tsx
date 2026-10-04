import {
  useEffect,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ChecklistSelections, Checklists, Run } from "waymark-core";
import { Beacon, DEFAULT_LABELS, DefaultPopover, Dialog, WaymarkShade } from "./view";
import type {
  ChecklistWalkthroughProps,
  GuidanceStep,
  ReactGuidanceTasks,
  WalkthroughLabels,
  WalkthroughProps,
  WalkthroughRenderProps,
  WalkthroughStep,
} from "./types";
import { useOwnedRun, useRunView, useUiRefs, type UiRefs } from "./useRun";

const subscribeNever = () => () => {};

/**
 * False on the server and while React hydrates its HTML, true after. A server
 * cannot read the browser's storage, so it draws no walkthrough; drawing one
 * straight away in the browser would not match.
 */
const useDrawn = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

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
  if (!useDrawn()) return null;
  if (props.checklists !== undefined) {
    return (
      <ChecklistGuidance
        checklists={props.checklists}
        renderPopover={props.renderPopover}
        labels={props.labels}
        portal={props.portal ?? true}
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
  storage,
  onStorageError,
  renderPopover,
  labels,
  portal = true,
}: WalkthroughProps<TStep>) {
  const { dialogRef, beaconRef, ui } = useUiRefs();
  const run = useOwnedRun({ walkthrough, waymarkPadding, onEvent, storage, onStorageError, ui });
  return (
    <RunView
      run={run}
      waymarkPadding={waymarkPadding}
      renderPopover={renderPopover}
      labels={labels}
      portal={portal}
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
  labels,
  portal,
}: {
  checklists: Checklists<never, TTasks, TSelections>;
  renderPopover?:
    | ChecklistWalkthroughProps<never, TTasks, TSelections>["renderPopover"]
    | undefined;
  labels?: Partial<WalkthroughLabels> | undefined;
  portal: boolean;
}) {
  const { dialogRef, beaconRef, ui } = useUiRefs();
  const { active } = useSyncExternalStore(
    checklists.subscribe,
    checklists.getSnapshot,
    checklists.getServerSnapshot,
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
      labels={labels}
      portal={portal}
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
  labels,
  portal,
  dialogRef,
  beaconRef,
}: UiRefs & {
  run: Run<TStep>;
  skipTask?: (() => void) | undefined;
  waymarkPadding: number;
  renderPopover?:
    | ((props: WalkthroughRenderProps<TStep>) => ReactNode)
    | undefined;
  labels?: Partial<WalkthroughLabels> | undefined;
  portal: boolean;
}) {
  const { snapshot, advance, previous, collapse, resume, reset, exit } =
    useRunView(run);

  if (snapshot.phase !== "running") return null;
  const searching = snapshot.waymark.status === "searching";
  // A beacon has nowhere to sit until the Waymark is found or given up on.
  if (snapshot.collapsed && (searching || snapshot.waymark.status === "waiting")) return null;

  const rect =
    snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
  const text = { ...DEFAULT_LABELS, ...labels };
  const render = (
    placement: WalkthroughRenderProps<TStep>["placement"],
    arrow: number,
  ) => {
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
      labels: text,
    };
    return (
      renderPopover?.(renderProps) ?? (
        <DefaultPopover {...renderProps} arrow={arrow} />
      )
    );
  };

  const view = snapshot.collapsed ? (
    <Beacon rect={rect} beaconRef={beaconRef} label={text.resume} onResume={resume} />
  ) : (
    <>
      <WaymarkShade rect={rect} padding={waymarkPadding} />
      {/* Only the shade while searching, so the tour doesn't seem to end and restart. */}
      {!searching && (
        <Dialog
          key={snapshot.stepIndex}
          rect={rect}
          padding={waymarkPadding}
          preferred={snapshot.step.preferredPlacement}
          dialogRef={dialogRef}
          ariaLabel={text.stepOf(snapshot.stepIndex + 1, snapshot.stepCount)}
        >
          {render}
        </Dialog>
      )}
    </>
  );
  return portal ? createPortal(view, document.body) : view;
}
