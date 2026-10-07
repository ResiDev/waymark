import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import type {
  ChecklistRow,
  ChecklistSelections,
  Checklists,
  ChecklistSnapshot,
  NamedTask,
  RunEvent,
  Running,
  Step,
  StepOf,
  Task,
  TaskCommands,
  TaskStatus,
  UnstoredWalkthrough,
  Walkthrough,
} from "waymark-core";

export type Placement = "above" | "below" | "left" | "right";

export type WalkthroughStep = Step &
  Readonly<{
    content: ReactNode;
    preferredPlacement?: Placement;
    popoverStyle?: CSSProperties;
  }>;

/** The text of the default popover and beacon. `close`, `resume` and `stepOf` become accessible names, so they are strings. */
export type WalkthroughLabels = Readonly<{
  next: ReactNode;
  finish: ReactNode;
  previous: ReactNode;
  skipTask: ReactNode;
  /** Shown while a step's Waymark is lost or missing. */
  missing: ReactNode;
  close: string;
  resume: string;
  stepOf: (step: number, count: number) => string;
}>;

export type WalkthroughRenderProps<
  TStep extends WalkthroughStep = WalkthroughStep,
> = Readonly<{
  snapshot: Running<TStep>;
  currentStep: TStep;
  placement: Placement;
  /** False while the popover is centred: the step has no Waymark, or it is not found yet, lost or missing. */
  waymarkFound: boolean;
  advance: () => void;
  previous: () => void;
  collapse: () => void;
  reset: () => void;
  exit: () => void;
  /** Only when guiding a Checklists Task. */
  skipTask?: () => void;
  /** The app's labels over the defaults. */
  labels: WalkthroughLabels;
}>;

/** What a collapsed run's beacon is drawn with. It is placed for you: on the Waymark's top-right corner, or the bottom of the screen. */
export type BeaconRenderProps<TStep extends WalkthroughStep = WalkthroughStep> =
  Readonly<{
    currentStep: TStep;
    /** False while the beacon sits at the bottom of the screen: the step has no Waymark, or it is lost or missing. */
    waymarkFound: boolean;
    resume: () => void;
    exit: () => void;
    /** The app's labels over the defaults; `resume` names the beacon. */
    labels: WalkthroughLabels;
  }>;

export type WalkthroughProps<TStep extends WalkthroughStep = WalkthroughStep> =
  Readonly<{
    walkthrough: Walkthrough<TStep>;
    checklists?: never;
    active?: boolean;
    waymarkPadding?: number;
    onEvent?: (event: RunEvent<TStep>) => void;
    renderPopover?: (props: WalkthroughRenderProps<TStep>) => ReactNode;
    renderBeacon?: (props: BeaconRenderProps<TStep>) => ReactNode;
    labels?: Partial<WalkthroughLabels>;
    /** Defaults to true: in `document.body`, no ancestor's transform, overflow or stacking context can trap it. */
    portal?: boolean;
  }>;

/** Admits any other field: it reads Tasks an owner already holds, whatever else they carry. */
export type ReactGuidanceTasks = Readonly<
  Record<
    string,
    Readonly<{
      walkthrough?: UnstoredWalkthrough<WalkthroughStep> | readonly WalkthroughStep[];
      [field: string]: unknown;
    }>
  >
>;

export type GuidanceStep<TTasks> = Extract<StepOf<NamedTask<TTasks>>, WalkthroughStep>;

/** Stops the owner's active Run when removed. */
export type ChecklistWalkthroughProps<
  TContext,
  TTasks extends ReactGuidanceTasks,
  TSelections extends ChecklistSelections<TTasks>,
> = Readonly<{
  checklists: Checklists<TContext, TTasks, TSelections>;
  walkthrough?: never;
  active?: never;
  waymarkPadding?: never;
  onEvent?: never;
  renderPopover?: (props: WalkthroughRenderProps<NoInfer<GuidanceStep<TTasks>>>) => ReactNode;
  renderBeacon?: (props: BeaconRenderProps<NoInfer<GuidanceStep<TTasks>>>) => ReactNode;
  labels?: Partial<WalkthroughLabels>;
  /** Defaults to true: in `document.body`, no ancestor's transform, overflow or stacking context can trap it. */
  portal?: boolean;
}>;

/** A Task written away from `createChecklists` gets its context from `satisfies ReactTask<AppContext>`. */
export type ReactTask<TContext> = Task<TContext, WalkthroughStep> &
  Readonly<{
    title: ReactNode;
    description?: ReactNode;
    action?: Readonly<{
      label: ReactNode;
      onSelect: () => void;
    }>;
    /** Defaults to true. */
    toggleable?: boolean;
  }>;

/** `never`: the context only types a condition's argument, so a ReactTask of any context fits. */
export type AnyReactTask = ReactTask<never> & { readonly id: string };

export type UseChecklistResult<TTask extends AnyReactTask> = TaskCommands<TTask["id"]> &
  Readonly<{
    snapshot: ChecklistSnapshot<TTask>;
  }>;

export type ChecklistLabels = Readonly<{
  start: ReactNode;
  replay: ReactNode;
  skip: ReactNode;
}>;

export type ChecklistRowProps<TTask extends AnyReactTask> = TaskCommands<TTask["id"]> &
  Readonly<{
    task: TTask;
    status: TaskStatus;
    active: boolean;
  }>;

export type ChecklistProps<TTask extends AnyReactTask> = Readonly<{
  checklist: CoreChecklist<TTask>;
  style?: CSSProperties;
  rowStyle?: CSSProperties;
  labels?: Partial<ChecklistLabels>;
  /** Replaces a row's content; the list item around it stays. */
  renderRow?: (props: ChecklistRowProps<TTask>) => ReactNode;
}>;

export type ChecklistRootState<TTask extends AnyReactTask> = UseChecklistResult<TTask> &
  Readonly<{
    /** True while a mouse rests on the trigger or panel, or a press has pinned it open. */
    open: boolean;
  }>;

export type ChecklistRootProps<TTask extends AnyReactTask> = Readonly<{
  checklist: CoreChecklist<TTask>;
  children?: ReactNode | ((state: ChecklistRootState<TTask>) => ReactNode);
}>;

export type ChecklistPanelProps = ComponentPropsWithoutRef<"div"> &
  Readonly<{
    /** Defaults to below. Another side is taken when this one has no room; `data-side` says which. */
    side?: Placement;
    /** Pixels between the trigger and the panel. Defaults to 8. */
    gap?: number;
    /** Defaults to true: in `document.body`, no ancestor's transform, overflow or stacking context can trap it. */
    portal?: boolean;
  }>;

export type ChecklistTaskProps = ComponentPropsWithoutRef<"li"> &
  Readonly<{
    row: ChecklistRow<AnyReactTask>;
  }>;

export type ChecklistCheckboxProps = ComponentPropsWithoutRef<"button"> &
  Readonly<{
    /** Read out after the Task's title. */
    statusText?: Readonly<Record<TaskStatus, string>>;
  }>;

export type { Checklist as CoreChecklist } from "waymark-core";
import type { Checklist as CoreChecklist } from "waymark-core";
export type { RunEvent, Snapshot, Running, Walkthrough } from "waymark-core";
