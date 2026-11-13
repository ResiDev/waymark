import type { ReactNode } from "react";
import {
  ChecklistCheckbox,
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTask,
  ChecklistTaskTitle,
  ChecklistTrigger,
  type AnyReactTask,
  type ChecklistDefinition,
  type ChecklistRootState,
  type ChecklistRow,
  type Placement,
  type TaskStatus,
} from "react-waymark";

// Written for Tailwind v3.4 and v4; only the panel's opening fade needs v4. It
// sets its own box, margin, border and list resets, so it looks the same with
// or without preflight.

// The same colours as react-waymark's own popover and checklist: four an app can set, here or on the page, and the
// rest mixed from them. Left unset, the surface and the text are the browser's own for the page's `color-scheme`.
const colours = [
  "[--accent:var(--waymark-accent,#2563eb)] [--on-accent:var(--waymark-on-accent,#fff)]",
  "[--surface:var(--waymark-surface,Canvas)] [--text:var(--waymark-text,CanvasText)]",
  "[--muted:color-mix(in_srgb,var(--text)_62%,var(--surface))]",
  "[--line:color-mix(in_srgb,var(--text)_16%,var(--surface))]",
  "[--hover:color-mix(in_srgb,var(--text)_7%,transparent)]",
].join(" ");

const focus = "focus-visible:[outline:2px_solid_var(--accent)] focus-visible:outline-offset-2";

const button = [
  "m-0 min-h-8 cursor-pointer whitespace-nowrap rounded-lg border border-solid px-3 py-[5px]",
  "[font-family:inherit] text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
  focus,
].join(" ");

const classes = {
  // In the app's own layout, so it takes the colour of the text around it.
  trigger: [
    colours,
    "m-0 box-border inline-flex h-8 flex-none cursor-pointer items-center gap-2 whitespace-nowrap rounded-full",
    "border border-solid border-[color:color-mix(in_srgb,currentColor_30%,transparent)] bg-transparent",
    "py-0 pl-2 pr-3 [font-family:inherit] text-[13px] font-medium text-inherit",
    "hover:bg-[color:color-mix(in_srgb,currentColor_12%,transparent)]",
    "data-[state=open]:bg-[color:color-mix(in_srgb,currentColor_12%,transparent)]",
    "focus-visible:[outline:2px_solid_currentColor] focus-visible:outline-offset-2",
  ].join(" "),
  triggerCount: "opacity-70",
  ring: "h-5 w-5 fill-none",
  ringTrack: "stroke-[1.5] stroke-[color:color-mix(in_srgb,currentColor_45%,transparent)]",
  // The panel's accent, taken towards the text around the trigger so it shows on a dark header and a light one.
  ringDone: [
    "stroke-[6] stroke-[color:color-mix(in_srgb,var(--accent)_65%,currentColor)]",
    "motion-safe:transition-[stroke-dasharray] motion-safe:duration-300",
  ].join(" "),
  panel: [
    colours,
    // react-waymark's shade sits at 50 and its popover at 51. Level with the shade but later in the
    // page, the panel opens above a running walkthrough's shade and still under its popover.
    // All of a phone's width, so it is not left hanging off one side of the trigger.
    "z-50 box-border flex w-[340px] max-w-[calc(100vw-16px)] max-[420px]:w-[calc(100vw-16px)] max-h-[min(560px,var(--waymark-available-height))] flex-col",
    "overflow-hidden rounded-[14px] border border-solid border-[color:var(--line)] bg-[var(--surface)]",
    "text-start text-sm text-[color:var(--text)] outline-none",
    "shadow-[0_1px_3px_rgb(2_6_23/0.1),0_12px_32px_-8px_rgb(2_6_23/0.3)]",
    "motion-safe:transition-[opacity,scale] motion-safe:duration-150 starting:scale-95 starting:opacity-0",
  ].join(" "),
  header: "flex flex-none flex-wrap items-baseline gap-x-3 border-0 border-b border-solid border-[color:var(--line)] px-5 py-4",
  heading: "m-0 flex-1 text-[17px] font-semibold leading-6",
  count: "text-[13px] text-[color:var(--muted)]",
  track: "mt-2.5 flex h-1.5 w-full flex-none overflow-hidden rounded-full bg-[var(--line)]",
  done: "bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-300",
  // Skipped moves the bar on, in a tint, so the list can be finished without calling a skipped task done.
  skipped: "bg-[var(--accent)] opacity-50",
  list: "m-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0",
  task: [
    "group/task flex items-start gap-3 border-0 border-solid border-[color:var(--line)] px-5 py-3 [&+&]:border-t",
    // A bar down the side, so the task to do next is found without reading, and not by its button's colour alone.
    "data-[next]:shadow-[inset_3px_0_var(--accent)] data-[open]:shadow-[inset_3px_0_var(--accent)]",
    // Tinted while its walkthrough is on screen.
    "data-[open]:bg-[var(--hover)]",
  ].join(" "),
  // One drawn circle for every state, so a task's status is read from its shape: `mark` picks which.
  checkbox: [
    "relative m-0 box-border grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] border-solid",
    "[&>svg]:h-3 [&>svg]:w-3",
    // Larger than the circle, for a finger.
    "enabled:cursor-pointer enabled:after:absolute enabled:after:-inset-[5px] enabled:after:content-['']",
    focus,
  ].join(" "),
  empty: "border-[color:var(--muted)] bg-transparent p-0 text-[color:var(--muted)]",
  // Half a pie: started, not finished.
  half: "border-[color:var(--accent)] bg-[conic-gradient(var(--accent)_50%,transparent_0)] bg-clip-content p-[3px]",
  filled: "border-[color:var(--accent)] bg-[var(--accent)] p-0 text-[color:var(--on-accent)]",
  body: "group min-w-0 flex-1",
  // The title's line: all of a task with nothing under its title.
  line: "flex items-center gap-2",
  // Its own arrow, at the end of the line, in place of the browser's at the start.
  summary: [
    "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
    "after:mb-[3px] after:ml-auto after:mr-0.5 after:h-1.5 after:w-1.5 after:flex-none after:rotate-45",
    "after:border-0 after:border-b-[1.5px] after:border-r-[1.5px] after:border-solid after:border-[color:var(--muted)]",
    "after:content-[''] group-open:after:-mb-[3px] group-open:after:rotate-[225deg]",
    focus,
  ].join(" "),
  // Heavier on the one task to do next; a finished task steps back to grey, with its mark left to say how it ended.
  title: [
    "min-w-0 text-[15px] font-medium group-data-[next]/task:font-semibold",
    "data-[status=done]:text-[color:var(--muted)] data-[status=skipped]:text-[color:var(--muted)]",
  ].join(" "),
  // Skipped is the one status the mark alone does not make plain.
  tag: "text-xs text-[color:var(--muted)]",
  description: "m-0 mt-0.5 text-[color:var(--muted)]",
  actions: "mb-1 mt-2.5 flex gap-2",
  primary: `${button} border-transparent bg-[var(--accent)] text-[color:var(--on-accent)] enabled:hover:brightness-90`,
  secondary: `${button} border-[color:var(--line)] bg-transparent text-[color:var(--text)] enabled:hover:bg-[var(--hover)]`,
  // Its text, not its hover square, lines up with the description above.
  quiet: [
    button,
    "border-transparent bg-transparent text-[color:var(--muted)] first:-ml-3",
    "enabled:hover:bg-[var(--hover)] enabled:hover:text-[color:var(--text)]",
  ].join(" "),
};

const icon = (path: string) => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

const marks: Record<TaskStatus, ReactNode> = {
  todo: null,
  done: icon("M2.5 6.5 5 9l4.5-5.5"),
  skipped: icon("M3 6h6"),
};

/** Put it wherever there is room: a header, a sidebar, a toolbar. The panel opens on `side`. */
export function ChecklistPopover({
  checklist,
  title = "Getting started",
  side = "below",
}: {
  checklist: ChecklistDefinition<AnyReactTask>;
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
  const { tasks, taskCount, finishedCount } = snapshot;
  const done = tasks.filter((row) => row.status === "done").length;
  const skipped = finishedCount - done;
  const progress = `${done} of ${taskCount} done${skipped > 0 ? ` · ${skipped} skipped` : ""}`;
  const share = (count: number) => `${(count / taskCount) * 100}%`;
  // The walkthrough under way, or else the first task still to do: the one row that starts open.
  const next = tasks.find((row) => row.walkthrough !== "none") ?? tasks.find((row) => row.status === "todo");

  return (
    <>
      <ChecklistTrigger className={classes.trigger} aria-label={`${title}, ${progress}`}>
        {/* A pie in a ring, like a started task's mark. The pie is a circle's stroke, as wide as the circle, drawn part of the way round. */}
        <svg className={classes.ring} viewBox="0 0 18 18" aria-hidden="true">
          <circle className={classes.ringTrack} cx="9" cy="9" r="8" />
          <circle className={classes.ringDone} cx="9" cy="9" r="3" pathLength={1} strokeDasharray={`${done / taskCount} 1`} transform="rotate(-90 9 9)" />
        </svg>
        {title}
        <span className={classes.triggerCount}>
          {done}/{taskCount}
        </span>
      </ChecklistTrigger>
      <ChecklistPanel side={side} gap={14} className={classes.panel} aria-label={title}>
        <div className={classes.header}>
          <h2 className={classes.heading}>{title}</h2>
          <span className={classes.count}>{progress}</span>
          <div className={classes.track} aria-hidden="true">
            <div className={classes.done} style={{ width: share(done) }} />
            <div className={classes.skipped} style={{ width: share(skipped) }} />
          </div>
        </div>
        <ol className={classes.list}>
          {tasks.map((row) => {
            const { task, status, walkthrough } = row;
            const isNext = next?.task.id === task.id;
            const mark = status === "done" ? classes.filled : status === "todo" && walkthrough !== "none" ? classes.half : classes.empty;
            const actions = actionsFor(row, isNext, start, skip);
            const heading = (
              <>
                <ChecklistTaskTitle className={classes.title}>{task.title}</ChecklistTaskTitle>
                {status === "skipped" && <span className={classes.tag}>Skipped</span>}
              </>
            );
            return (
              <ChecklistTask key={task.id} row={row} className={classes.task} data-next={isNext ? "" : undefined}>
                <ChecklistCheckbox className={`${classes.checkbox} ${mark}`}>{marks[status]}</ChecklistCheckbox>
                {task.description === undefined && actions === null ? (
                  <div className={`${classes.body} ${classes.line}`}>{heading}</div>
                ) : (
                  // Closed, a task is its title. The browser opens and closes it; the one to do next starts open.
                  <details className={classes.body} open={isNext}>
                    <summary className={`${classes.line} ${classes.summary}`}>{heading}</summary>
                    {task.description !== undefined && <p className={classes.description}>{task.description}</p>}
                    {actions}
                  </details>
                )}
              </ChecklistTask>
            );
          })}
        </ol>
      </ChecklistPanel>
    </>
  );
}

/** One filled button in the list, on what to do next; a finished task's button steps back. Null with nothing to show. */
function actionsFor<TTask extends AnyReactTask>(
  { task, status, walkthrough }: ChecklistRow<TTask>,
  next: boolean,
  start: (id: TTask["id"]) => void,
  skip: (id: TTask["id"]) => void,
) {
  // The app's own action, or else the task's walkthrough.
  const onSelect = task.action?.onSelect ?? (task.walkthrough && (() => start(task.id)));
  const label = task.action?.label ?? (status === "done" ? "Show me again" : walkthrough === "collapsed" ? "Continue" : "Show me");
  if (!onSelect && status !== "todo") return null;
  return (
    <div className={classes.actions}>
      {onSelect && (
        <button
          type="button"
          className={status !== "todo" ? classes.quiet : next ? classes.primary : classes.secondary}
          onClick={onSelect}
          // Nothing to start while the task's walkthrough is on screen.
          disabled={task.action === undefined && walkthrough === "open"}
        >
          {label}
        </button>
      )}
      {status === "todo" && (
        <button type="button" className={classes.quiet} onClick={() => skip(task.id)}>
          Skip
        </button>
      )}
    </div>
  );
}
