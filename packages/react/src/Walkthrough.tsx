import { useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { ChecklistSelections, Checklists, Rect, Run } from "waymark";
import { Beacon, DefaultPopover, Dialog, WaymarkShade } from "./view";
import type {
  ChecklistWalkthroughProps,
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

type AnyChecklists = Checklists<any, any, any>;
type AnyProps = WalkthroughProps<any> | ChecklistWalkthroughProps<any, any, any>;
type PopoverRenderer = (props: WalkthroughRenderProps<any>) => ReactNode;

/**
 * Renders a Run. With `walkthrough` the component creates and owns the Run;
 * with `checklists` it draws whichever Run the owner started. Either way the
 * frame loop, browser events, and transition policy stay in core.
 */
export function Walkthrough<TStep extends WalkthroughStep>(
  props: WalkthroughProps<TStep>,
): ReactElement | null;
export function Walkthrough<
  TContext,
  TTasks extends ReactGuidanceTasks,
  TSelections extends ChecklistSelections<TTasks>,
>(props: ChecklistWalkthroughProps<TContext, TTasks, TSelections>): ReactElement | null;
export function Walkthrough(props: AnyProps): ReactElement | null {
  if (typeof document === "undefined") return null;
  if (props.checklists !== undefined) {
    // `any` tasks give the popover a `never` step; the runtime step is whatever the Run holds.
    const renderPopover = props.renderPopover as PopoverRenderer | undefined;
    return <ChecklistGuidance checklists={props.checklists} renderPopover={renderPopover} />;
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
const holders = new WeakMap<AnyChecklists, symbol>();

/**
 * Draws the owner's active Run. Removing this renderer stops that Run, but
 * only once a microtask has passed without it, or another renderer, taking
 * the binding again: React may clean up and re-run the effect on the same
 * mounted component, and that must not stop guidance. A Run the owner has
 * since replaced is left alone too.
 */
function ChecklistGuidance({
  checklists,
  renderPopover,
}: {
  checklists: AnyChecklists;
  renderPopover?: PopoverRenderer | undefined;
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
  return (
    <RunView
      run={active.run}
      waymarkPadding={checklists.waymarkPadding}
      renderPopover={renderPopover}
      dialogRef={dialogRef}
      beaconRef={beaconRef}
    />
  );
}

function RunView<TStep extends WalkthroughStep>({
  run,
  waymarkPadding,
  renderPopover,
  dialogRef,
  beaconRef,
}: UiRefs & {
  run: Run<TStep>;
  waymarkPadding: number;
  renderPopover?: ((props: WalkthroughRenderProps<TStep>) => ReactNode) | undefined;
}) {
  const { snapshot, advance, previous, collapse, resume, reset, exit } = useRunView(run);

  if (snapshot.phase !== "running") return null;
  if (snapshot.waymark.status === "searching" || snapshot.waymark.status === "lost") {
    return null;
  }

  const rect = snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
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
