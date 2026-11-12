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
  WalkthroughView,
} from "./types";
import { BeaconAnchor, DEFAULT_LABELS, Dialog, WaymarkShade } from "./view";

const subscribeNever = () => () => {};

/** A walkthrough is on the page and nothing was given to draw it: better loud than a page left under a shade. */
const nothingDraws = (what: "popover" | "beacon", id: string): never => {
  const prop = what === "popover" ? "renderPopover" : "renderBeacon";
  throw new Error(
    `Waymark: nothing draws the ${what} of walkthrough "${id}". Give <WaymarkRoot> view={defaultView}, or a ${prop} of your own.`,
  );
};

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
  view?: WalkthroughView | undefined;
  renderPopover?: ((props: WalkthroughRenderProps) => ReactNode) | undefined;
  renderBeacon?: ((props: BeaconRenderProps) => ReactNode) | undefined;
  labels: WalkthroughLabels;
}>;

/** Draws the open walkthrough and the visible beacons, and attaches the Run while mounted. */
export function RunView({
  run,
  waymarkPadding,
  view,
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
  const drawing: Drawing = { run, waymarkPadding, view, renderPopover, renderBeacon, labels: withDefaults(DEFAULT_LABELS, labels) };
  const content =
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
  if (content === null) return null;
  return portal ? createPortal(content, document.body) : content;
}

function OpenView({
  run,
  open: { walkthrough, snapshot, task },
  dialogRef,
  waymarkPadding,
  view,
  renderPopover,
  labels,
}: Drawing & Readonly<{ open: OpenWalkthrough<Walkthrough>; dialogRef: RefObject<HTMLDivElement> }>) {
  const searching = snapshot.waymark.status === "searching";
  const rect = snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
  // Named, so a popover drawn for a step just left acts on nothing else.
  const act = (action: Action) => () => run.act(action, walkthrough);
  const draw = walkthrough.renderPopover ?? renderPopover;
  if (draw === undefined && view === undefined) nothingDraws("popover", walkthrough.id);
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
    // An app's popover that returns nothing for a step leaves that step to the view.
    return draw?.(props) ?? (view && <view.popover {...props} arrow={arrow} />);
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
  view,
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
  const draw = walkthrough.renderBeacon ?? renderBeacon;
  if (draw === undefined && view === undefined) nothingDraws("beacon", walkthrough.id);
  const custom = draw?.(props);
  if (custom !== null && custom !== undefined) return <BeaconAnchor rect={rect}>{custom}</BeaconAnchor>;
  return view ? <view.beacon {...props} rect={rect} /> : null;
}
