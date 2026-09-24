import type { CSSProperties, ReactNode } from "react";
import type {
  ChecklistSelections,
  Checklists,
  ChecklistSnapshot,
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
  /**
   * Skips the Task in the checklists its guidance counts for. Only when drawn
   * for a Checklists owner and the guidance counts for at least one.
   */
  skipTask?: () => void;
}>;

/** The self-owned shape: the component creates and owns one Run of this walkthrough. */
export type WalkthroughProps<TStep extends WalkthroughStep = WalkthroughStep> =
  Readonly<{
    walkthrough: Walkthrough<TStep>;
    checklists?: never;
    active?: boolean;
    waymarkPadding?: number;
    onEvent?: (event: RunEvent<TStep>) => void;
    renderPopover?: (props: WalkthroughRenderProps<TStep>) => ReactNode;
  }>;

/**
 * Tasks whose walkthroughs, if any, carry React display content. This reads
 * Tasks an owner already holds, so it admits any other field: a Task with a
 * title and nothing else still belongs.
 */
export type ReactGuidanceTasks = Readonly<
  Record<string, Readonly<{ walkthrough?: Walkthrough<WalkthroughStep>; [field: string]: unknown }>>
>;

/**
 * The owner-driven shape: draws whichever Run the Checklists owner started,
 * binds its elements through `bindUi` on mount, and stops the Run when the
 * renderer is removed. Padding and Run events are owner options here.
 */
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
  renderPopover?: (
    props: WalkthroughRenderProps<NoInfer<Extract<StepOf<TTasks[keyof TTasks]>, WalkthroughStep>>>,
  ) => ReactNode;
}>;

/**
 * A Task with what the React checklist shows for it. The description sits
 * beneath the title with no Run needed; the action is invoked by the UI
 * directly and creates no Run.
 */
export type ReactTask<TContext> = Task<TContext, WalkthroughStep> &
  Readonly<{
    title: ReactNode;
    description?: ReactNode;
    action?: Readonly<{
      label: ReactNode;
      onSelect: () => void;
    }>;
  }>;

export type AnyReactTask = ReactTask<any> & { readonly id: string };

export type UseChecklistResult<TTask extends AnyReactTask> = TaskCommands<TTask["id"]> &
  Readonly<{
    snapshot: ChecklistSnapshot<TTask>;
  }>;

export type ChecklistLabels = Readonly<{
  start: ReactNode;
  replay: ReactNode;
  markDone: ReactNode;
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

export type { Checklist as CoreChecklist } from "waymark";
import type { Checklist as CoreChecklist } from "waymark";
export type { RunEvent, Snapshot, Running, Walkthrough } from "waymark";
