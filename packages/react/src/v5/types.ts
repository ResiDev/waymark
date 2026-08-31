import type { CSSProperties, ReactNode } from "react";
import type {
  RunEvent,
  Running,
  Step,
  Tutorial,
} from "waymark";

export type Placement = "above" | "below" | "left" | "right";

export type TutorialStep = Step &
  Readonly<{
    content: ReactNode;
    preferredPlacement?: Placement;
    popoverStyle?: CSSProperties;
  }>;

export type TutorialRenderProps<
  TStep extends TutorialStep = TutorialStep,
> = Readonly<{
  snapshot: Running<TStep>;
  currentStep: TStep;
  placement: Placement;
  hasWaymark: boolean;
  advance: () => void;
  previous: () => void;
  collapse: () => void;
  reset: () => void;
  exit: () => void;
}>;

export type TutorialProps<TStep extends TutorialStep = TutorialStep> =
  Readonly<{
    tutorial: Tutorial<TStep>;
    active?: boolean;
    waymarkPadding?: number;
    onEvent?: (event: RunEvent<TStep>) => void;
    renderPopover?: (props: TutorialRenderProps<TStep>) => ReactNode;
  }>;

export type { RunEvent, Snapshot, Running, Tutorial } from "waymark";
