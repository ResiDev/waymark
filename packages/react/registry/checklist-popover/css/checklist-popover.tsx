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
import styles from "./checklist-popover.module.css";

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
      <ChecklistTrigger className={styles.trigger} aria-label={`${title}, ${progress}`}>
        {/*
          How far through the list, skipped tasks too, as the panel's bar shows it: a pie in a ring, like a started
          task's mark. The pie is a circle's stroke, as wide as the circle, drawn part of the way round. The number
          beside it is the tasks done, as the panel's text says it.
        */}
        <svg className={styles.ring} viewBox="0 0 18 18" aria-hidden="true">
          <circle className={styles.ringTrack} cx="9" cy="9" r="8" />
          <circle className={styles.ringDone} cx="9" cy="9" r="3" pathLength={1} strokeDasharray={`${finishedCount / taskCount} 1`} transform="rotate(-90 9 9)" />
        </svg>
        {title}
        <span className={styles.triggerCount}>
          {done}/{taskCount}
        </span>
      </ChecklistTrigger>
      <ChecklistPanel side={side} gap={14} className={styles.panel} aria-label={title}>
        <div className={styles.header}>
          <h2 className={styles.heading}>{title}</h2>
          <span className={styles.count}>{progress}</span>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.done} style={{ width: share(done) }} />
            {/* Skipped moves the bar on, in a tint, so the list can be finished without calling a skipped task done. */}
            <div className={styles.skipped} style={{ width: share(skipped) }} />
          </div>
        </div>
        <ol className={styles.list}>
          {tasks.map((row) => {
            const { task, status } = row;
            const isNext = next?.task.id === task.id;
            const actions = actionsFor(row, isNext, start, skip);
            const heading = (
              <>
                <ChecklistTaskTitle className={styles.title}>{task.title}</ChecklistTaskTitle>
                {status === "skipped" && <span className={styles.tag}>Skipped</span>}
              </>
            );
            return (
              <ChecklistTask key={task.id} row={row} className={styles.task} data-next={isNext ? "" : undefined}>
                <ChecklistCheckbox className={styles.checkbox}>{marks[status]}</ChecklistCheckbox>
                {task.description === undefined && actions === null ? (
                  <div className={`${styles.body} ${styles.summary}`}>{heading}</div>
                ) : (
                  // Closed, a task is its title. The browser opens and closes it; the one to do next starts open.
                  <details className={styles.body} open={isNext}>
                    <summary className={styles.summary}>{heading}</summary>
                    {task.description !== undefined && <p className={styles.description}>{task.description}</p>}
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
    <div className={styles.actions}>
      {onSelect && (
        <button
          type="button"
          className={status !== "todo" ? styles.quiet : next ? styles.primary : styles.secondary}
          onClick={onSelect}
          // Nothing to start while the task's walkthrough is on screen.
          disabled={task.action === undefined && walkthrough === "open"}
        >
          {label}
        </button>
      )}
      {status === "todo" && (
        <button type="button" className={styles.quiet} onClick={() => skip(task.id)}>
          Skip
        </button>
      )}
    </div>
  );
}
