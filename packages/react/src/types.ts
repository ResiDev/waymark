import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import type {
  ChecklistDefinition,
  ChecklistRow,
  ChecklistSnapshot,
  Running,
  Step,
  StorageAdapter,
  StoredRecord,
  Task,
  TaskCommands,
  TaskStatus,
  Walkthrough as CoreWalkthrough,
  WalkthroughDefinition as CoreWalkthroughDefinition,
  WaymarkEvent,
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
  /** Only while it guides a checklist's Task. */
  skipTask?: () => void;
  /** The app's labels over the defaults. */
  labels: WalkthroughLabels;
}>;

/** What a collapsed walkthrough's beacon is drawn with. It is placed for you: on the Waymark's top-right corner, or the bottom of the screen. */
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

/** A method, so a walkthrough of particular steps still fits where any walkthrough does. */
type Render<TProps> = { render(this: void, props: TProps): ReactNode }["render"];

/** A walkthrough whose steps React can draw. It may carry its own drawing, which wins over `<WaymarkRoot>`'s. */
export type Walkthrough<TStep extends WalkthroughStep = WalkthroughStep> = CoreWalkthrough<TStep> &
  Readonly<{
    renderPopover?: Render<WalkthroughRenderProps<TStep>>;
    renderBeacon?: Render<BeaconRenderProps<TStep>>;
  }>;

/** What `defineWalkthrough` takes. Its render functions see this walkthrough's steps, with their exact types. */
export type WalkthroughDefinition<TStep extends WalkthroughStep> = CoreWalkthroughDefinition<TStep, WalkthroughStep> &
  Readonly<{
    renderPopover?: (props: WalkthroughRenderProps<NoInfer<TStep>>) => ReactNode;
    renderBeacon?: (props: BeaconRenderProps<NoInfer<TStep>>) => ReactNode;
  }>;

export type WalkthroughProps<TStep extends WalkthroughStep = WalkthroughStep> =
  Readonly<{
    walkthrough: Walkthrough<TStep>;
    /** `false` holds the request back, for example until your data has loaded. Defaults to true. */
    active?: boolean;
  }>;

export type WaymarkRootProps = Readonly<{
  children?: ReactNode;
  /**
   * A localStorage key, or an adapter, for this user's record. Read as the
   * root mounts: for another user, give the root a new `key`.
   */
  storage?: string | StorageAdapter<StoredRecord>;
  /** A record already in hand, such as one fetched for a server render. */
  initial?: StoredRecord;
  /** Hears the record each time it changes. */
  onChange?: (stored: StoredRecord) => void;
  /** One set for every walkthrough and checklist. */
  problemHandlers?: ProblemHandlers;
  /** The app's facts, read by checklists' completion conditions, which are checked again as it changes. */
  context?: unknown;
  /** In px. Room the shade leaves around the Waymark; clicks this close count as clicks on it. Defaults to 20. */
  waymarkPadding?: number;
  /** For every walkthrough without one of its own. */
  renderPopover?: (props: WalkthroughRenderProps) => ReactNode;
  renderBeacon?: (props: BeaconRenderProps) => ReactNode;
  labels?: Partial<WalkthroughLabels>;
  /** Every walkthrough's events and every checklist's. */
  onEvent?: (event: WaymarkEvent<WalkthroughStep>) => void;
  /** Defaults to true: in `document.body`, no ancestor's transform, overflow or stacking context can trap it. */
  portal?: boolean;
}>;

/** A Task written away from `defineChecklists` gets its context from `satisfies ReactTask<AppContext>`. */
export type ReactTask<TContext = unknown> = Task<TContext, WalkthroughStep> &
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

export type AnyReactTask = ReactTask & { readonly id: string };

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
    /** Its walkthrough is open. */
    open: boolean;
    /** Its walkthrough is collapsed part way, with a beacon to go back to it. */
    inProgress: boolean;
  }>;

export type ChecklistProps<TTask extends AnyReactTask> = Readonly<{
  checklist: ChecklistDefinition<TTask>;
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
  checklist: ChecklistDefinition<TTask>;
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

export type { RunEvent, Snapshot, Running } from "waymark-core";
import type {
  ProblemHandlers as CoreProblemHandlers,
  Run as CoreRun,
  RunSnapshot as CoreRunSnapshot,
  WaymarkProblem as CoreProblem,
} from "waymark-core";

// These default to any React step, so one set of handlers fits every walkthrough.
export type WaymarkProblem<TStep extends WalkthroughStep = WalkthroughStep> = CoreProblem<TStep>;
export type ProblemHandlers<TStep extends WalkthroughStep = WalkthroughStep> = CoreProblemHandlers<TStep>;

/** What `useRun` returns: its walkthroughs carry React's steps and drawing. */
export type Run = CoreRun<Walkthrough>;
export type RunSnapshot = CoreRunSnapshot<Walkthrough>;
