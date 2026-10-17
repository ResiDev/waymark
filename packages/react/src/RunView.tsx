import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Action, Beacon, OpenWalkthrough } from "waymark-core";
import { withDefaults } from "./labels";
import type {
  BeaconRenderProps,
  Run,
  Walkthrough,
  WalkthroughLabels,
  WalkthroughRenderProps,
} from "./types";
import { BeaconAnchor, DEFAULT_LABELS, DefaultBeacon, DefaultPopover, Dialog, WaymarkShade } from "./view";

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

type Drawing = Readonly<{
  run: Run;
  waymarkPadding: number;
  renderPopover?: ((props: WalkthroughRenderProps) => ReactNode) | undefined;
  renderBeacon?: ((props: BeaconRenderProps) => ReactNode) | undefined;
  labels: WalkthroughLabels;
}>;

/** Draws the open walkthrough and the visible beacons, and attaches the Run while mounted. */
export function RunView({
  run,
  waymarkPadding,
  renderPopover,
  renderBeacon,
  labels,
  portal,
}: Omit<Drawing, "labels"> & Readonly<{ labels?: Partial<WalkthroughLabels> | undefined; portal: boolean }>) {
  const drawn = useDrawn();
  const snapshot = useSyncExternalStore(run.subscribe, run.getSnapshot, run.getServerSnapshot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const ui = useCallback(() => ({ dialog: dialogRef.current }), []);
  useEffect(() => run.attach(ui, { waymarkPadding }), [run, ui, waymarkPadding]);

  if (!drawn) return null;
  const drawing: Drawing = { run, waymarkPadding, renderPopover, renderBeacon, labels: withDefaults(DEFAULT_LABELS, labels) };
  const view =
    snapshot.open === null ? (
      snapshot.beacons.length === 0 ? null : (
        <>
          {snapshot.beacons.map((beacon) => (
            <BeaconView key={beacon.walkthrough.id} beacon={beacon} {...drawing} />
          ))}
        </>
      )
    ) : (
      <OpenView open={snapshot.open} dialogRef={dialogRef} {...drawing} />
    );
  if (view === null) return null;
  return portal ? createPortal(view, document.body) : view;
}

function OpenView({
  run,
  open: { walkthrough, snapshot, task },
  dialogRef,
  waymarkPadding,
  renderPopover,
  labels,
}: Drawing & Readonly<{ open: OpenWalkthrough<Walkthrough>; dialogRef: RefObject<HTMLDivElement> }>) {
  const searching = snapshot.waymark.status === "searching";
  const rect = snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
  // Named, so a popover drawn for a step just left acts on nothing else.
  const act = (action: Action) => () => run.act(action, walkthrough);
  const render = (placement: WalkthroughRenderProps["placement"], arrow: number) => {
    const props: WalkthroughRenderProps = {
      snapshot,
      currentStep: snapshot.step,
      placement,
      waymarkFound: rect !== null,
      advance: act("advance"),
      previous: act("previous"),
      collapse: act("collapse"),
      reset: act("reset"),
      exit: act("exit"),
      ...(task === null ? {} : { skipTask: () => run.skipTask(task) }),
      labels,
    };
    return (walkthrough.renderPopover ?? renderPopover)?.(props) ?? <DefaultPopover {...props} arrow={arrow} />;
  };
  return (
    <>
      <WaymarkShade rect={rect} padding={waymarkPadding} />
      {/* Only the shade while searching, so the tour doesn't seem to end and restart. */}
      {!searching && (
        <Dialog
          key={`${walkthrough.id}:${snapshot.stepIndex}`}
          rect={rect}
          padding={waymarkPadding}
          preferred={snapshot.step.preferredPlacement}
          dialogRef={dialogRef}
          ariaLabel={labels.stepOf(snapshot.stepIndex + 1, snapshot.stepCount)}
        >
          {render}
        </Dialog>
      )}
    </>
  );
}

function BeaconView({
  run,
  beacon: { walkthrough, step, waymark },
  renderBeacon,
  labels,
}: Drawing & Readonly<{ beacon: Beacon<Walkthrough> }>) {
  const rect = waymark.status === "found" ? waymark.rect : null;
  const props: BeaconRenderProps = {
    currentStep: step,
    waymarkFound: rect !== null,
    resume: () => run.start(walkthrough),
    exit: () => run.act("exit", walkthrough),
    labels,
  };
  return (
    <BeaconAnchor rect={rect}>
      {(walkthrough.renderBeacon ?? renderBeacon)?.(props) ?? <DefaultBeacon {...props} />}
    </BeaconAnchor>
  );
}
