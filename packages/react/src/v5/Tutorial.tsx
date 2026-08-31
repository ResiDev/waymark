import type { Rect } from "waymark";
import { Beacon, DefaultPopover, Dialog, WaymarkShade } from "./view";
import type {
  TutorialProps,
  TutorialRenderProps,
  TutorialStep,
} from "./types";
import { useRun } from "./useRun";

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

/**
 * Runs and renders a Tutorial. The React interface owns one core Run and draws
 * its snapshot; frame loops, browser events and transition policy remain in
 * core.
 */
export function Tutorial<TStep extends TutorialStep>(
  props: TutorialProps<TStep>,
) {
  if (props.active === false || typeof document === "undefined") return null;
  return <ActiveTutorial {...props} />;
}

function ActiveTutorial<TStep extends TutorialStep>({
  tutorial,
  waymarkPadding = 20,
  onEvent,
  renderPopover,
}: TutorialProps<TStep>) {
  const {
    snapshot,
    dialogRef,
    beaconRef,
    advance,
    previous,
    collapse,
    resume,
    reset,
    exit,
  } = useRun({ tutorial, waymarkPadding, onEvent });

  if (snapshot.phase !== "running") return null;
  if (snapshot.waymark.status === "searching" || snapshot.waymark.status === "lost") {
    return null;
  }

  const rect =
    snapshot.waymark.status === "found" ? snapshot.waymark.rect : null;
  if (snapshot.collapsed) {
    return <Beacon rect={rect} beaconRef={beaconRef} onResume={resume} />;
  }

  const anchor = rect ?? centeredRect();
  const render = (placement: TutorialRenderProps<TStep>["placement"]) => {
    const renderProps: TutorialRenderProps<TStep> = {
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
        ariaLabel={`Tutorial step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`}
      >
        {render}
      </Dialog>
    </>
  );
}
