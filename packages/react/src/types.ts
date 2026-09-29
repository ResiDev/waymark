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
  Walkthrough,
} from "waymark";

export type Placement = "above" | "below" | "left" | "right";

export type WalkthroughStep = Step &
  Readonly<{
    content: ReactNode;
    preferredPlacement?: Placement;
    popoverStyle?: CSSProperties;
  }>;

export type WalkthroughRenderProps<
  TStep extends WalkthroughStep = WalkthroughStep,
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
  /** Only when guiding a Checklists Task. */
  skipTask?: () => void;
}>;

export type WalkthroughProps<TStep extends WalkthroughStep = WalkthroughStep> =
  Readonly<{
    walkthrough: Walkthrough<TStep>;
    checklists?: never;
    active?: boolean;
    waymarkPadding?: number;
    onEvent?: (event: RunEvent<TStep>) => void;
    renderPopover?: (props: WalkthroughRenderProps<TStep>) => ReactNode;
  }>;

/** Admits any other field: it reads Tasks an owner already holds, whatever else they carry. */
export type ReactGuidanceTasks = Readonly<
  Record<
    string,
    Readonly<{
      walkthrough?: Walkthrough<WalkthroughStep> | readonly WalkthroughStep[];
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

export type { Checklist as CoreChecklist } from "waymark";
import type { Checklist as CoreChecklist } from "waymark";
export type { RunEvent, Snapshot, Running, Walkthrough } from "waymark";
