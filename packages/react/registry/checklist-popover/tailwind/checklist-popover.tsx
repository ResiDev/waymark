import type { ReactNode } from "react";
import {
  ChecklistCheckbox,
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTask,
  ChecklistTaskTitle,
  ChecklistTrigger,
  type AnyReactTask,
  type ChecklistRootState,
  type ChecklistRow,
  type CoreChecklist,
  type Placement,
  type TaskStatus,
} from "react-waymark";

// Written for Tailwind v3.4 and v4; only the panel's opening fade needs v4. It
// sets its own box, margin, border and list resets, so it looks the same with
// or without preflight.

const classes = {
  // In the app's own layout, so it takes the colour of the text around it.
  trigger: [
    "group m-0 box-border inline-flex h-7 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap",
    "rounded-full border border-solid border-[color:color-mix(in_srgb,currentColor_30%,transparent)]",
    "bg-transparent py-0 pl-1.5 pr-2.5 text-xs font-semibold leading-none tabular-nums text-inherit",
    "hover:bg-[color:color-mix(in_srgb,currentColor_12%,transparent)]",
    "data-[state=open]:bg-[color:color-mix(in_srgb,currentColor_12%,transparent)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
  ].join(" "),
  ring: "h-4 w-4 fill-none stroke-2 motion-safe:group-data-[running]:animate-pulse",
  ringTrack: "stroke-[color:color-mix(in_srgb,currentColor_25%,transparent)]",
  ringFill: "stroke-blue-600 motion-safe:transition-[stroke-dasharray] motion-safe:duration-300",
  panel: [
    // react-waymark's shade sits at 50 and its popover at 51. Level with the shade but later in the
    // page, the panel opens above a running walkthrough's shade and still under its popover.
    "z-50 box-border flex w-80 max-w-[calc(100vw-16px)] max-h-[min(480px,var(--waymark-available-height))] flex-col",
    "overflow-hidden rounded-xl border border-solid border-slate-200 bg-white text-[13px] leading-snug",
    "text-slate-900 shadow-xl outline-none",
    "motion-safe:transition-[opacity,scale] motion-safe:duration-150 starting:scale-95 starting:opacity-0",
  ].join(" "),
  header: "flex items-baseline gap-2 px-3.5 pb-1.5 pt-3",
  heading: "m-0 flex-1 text-sm font-semibold",
  count: "flex-none tabular-nums text-slate-500",
  track: "mx-3.5 mb-2 h-[3px] flex-none overflow-hidden rounded-full bg-slate-200",
  fill: "h-full rounded-full bg-blue-600 motion-safe:transition-[width] motion-safe:duration-300",
  list: "m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto px-2 pb-2.5 pt-0",
  task: "flex items-start gap-2.5 rounded-lg p-2 data-[active]:bg-blue-50",
  checkbox: [
    "m-0 box-border grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px] border-solid",
    "border-slate-300 bg-white p-0 text-white enabled:cursor-pointer [&>svg]:h-[11px] [&>svg]:w-[11px]",
    "data-[status=done]:border-blue-600 data-[status=done]:bg-blue-600",
    "data-[status=skipped]:border-dashed data-[status=skipped]:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1",
  ].join(" "),
  body: "min-w-0 flex-1",
  title: [
    "font-medium",
    "data-[status=done]:text-slate-500 data-[status=done]:line-through data-[status=skipped]:text-slate-500",
  ].join(" "),
  description: "m-0 mt-0.5 text-slate-500",
  actions: "mt-2 flex items-center gap-2",
  primary: [
    "m-0 cursor-pointer rounded-md border-0 bg-blue-600 px-2.5 py-1 text-xs font-medium text-white",
    "enabled:hover:bg-blue-700 disabled:cursor-default disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1",
  ].join(" "),
  secondary: [
    "m-0 cursor-pointer border-0 bg-transparent p-1 text-xs text-slate-500 hover:text-slate-900",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
  ].join(" "),
};

const marks: Record<TaskStatus, ReactNode> = {
  todo: null,
  done: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  ),
  skipped: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 6h6" />
    </svg>
  ),
};

/** Put it wherever there is room: a header, a sidebar, a toolbar. The panel opens on `side`. */
export function ChecklistPopover<TTask extends AnyReactTask>({
  checklist,
  title = "Getting started",
  side = "below",
}: {
  checklist: CoreChecklist<TTask>;
  title?: string;
  side?: Placement;
}) {
  return (
    <ChecklistRoot checklist={checklist}>
      {(state) => <Contents state={state} title={title} side={side} />}
    </ChecklistRoot>
  );
}

function Contents<TTask extends AnyReactTask>({
  state: { snapshot, start, skip },
  title,
  side,
}: {
  state: ChecklistRootState<TTask>;
  title: string;
  side: Placement;
}) {
  const { finishedCount, taskCount } = snapshot;
  const progress = taskCount === 0 ? 1 : finishedCount / taskCount;
  const count = `${finishedCount}/${taskCount}`;

  return (
    <>
      <ChecklistTrigger
        className={classes.trigger}
        aria-label={`${title}, ${finishedCount} of ${taskCount} done`}
      >
        <svg className={classes.ring} viewBox="0 0 16 16" aria-hidden="true">
          <circle className={classes.ringTrack} cx="8" cy="8" r="6" />
          <circle
            className={classes.ringFill}
            cx="8"
            cy="8"
            r="6"
            pathLength={1}
            strokeDasharray={`${progress} 1`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        {count}
      </ChecklistTrigger>
      <ChecklistPanel side={side} className={classes.panel} aria-label={title}>
        <div className={classes.header}>
          <h2 className={classes.heading}>{title}</h2>
          <span className={classes.count}>{snapshot.complete ? "All done" : count}</span>
        </div>
        <div className={classes.track} aria-hidden="true">
          <div className={classes.fill} style={{ width: `${progress * 100}%` }} />
        </div>
        <ol className={classes.list}>
          {snapshot.tasks.map((row) => (
            <ChecklistTask key={row.task.id} row={row} className={classes.task}>
              <ChecklistCheckbox className={classes.checkbox}>{marks[row.status]}</ChecklistCheckbox>
              <div className={classes.body}>
                <ChecklistTaskTitle className={classes.title}>{row.task.title}</ChecklistTaskTitle>
                {row.task.description !== undefined && (
                  <p className={classes.description}>{row.task.description}</p>
                )}
                <Actions
                  row={row}
                  active={snapshot.active?.task.id === row.task.id}
                  start={start}
                  skip={skip}
                />
              </div>
            </ChecklistTask>
          ))}
        </ol>
      </ChecklistPanel>
    </>
  );
}

function Actions<TTask extends AnyReactTask>({
  row: { task, status },
  active,
  start,
  skip,
}: {
  row: ChecklistRow<TTask>;
  active: boolean;
  start: (id: TTask["id"]) => void;
  skip: (id: TTask["id"]) => void;
}) {
  let primary: ReactNode = null;
  if (task.action !== undefined) {
    primary = (
      <button type="button" className={classes.primary} onClick={task.action.onSelect}>
        {task.action.label}
      </button>
    );
  } else if (task.walkthrough !== undefined) {
    primary = (
      <button type="button" className={classes.primary} disabled={active} onClick={() => start(task.id)}>
        {status === "done" ? "Show me again" : "Show me"}
      </button>
    );
  }

  if (primary === null && status !== "todo") return null;
  return (
    <div className={classes.actions}>
      {primary}
      {status === "todo" && (
        <button type="button" className={classes.secondary} onClick={() => skip(task.id)}>
          Skip
        </button>
      )}
    </div>
  );
}
