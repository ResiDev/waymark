import { useState, type ReactNode } from "react";
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

const icon = { viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

// A to-do task carries the tick it would get, which the stylesheet shows under the pointer.
const tick = (
  <svg {...icon} aria-hidden="true">
    <path d="M2.5 6.5 5 9l4.5-5.5" />
  </svg>
);

// On a task the app ticks, in place of a tick nobody can give it.
const lock = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.25" y="5.5" width="7.5" height="5" rx="1.25" fill="currentColor" stroke="none" />
    <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
  </svg>
);

const marks: Record<TaskStatus, ReactNode> = {
  todo: tick,
  done: tick,
  // A dash, and under the pointer the arrow that says a press brings the task back.
  skipped: (
    <>
      <svg {...icon} className={styles.dash} aria-hidden="true">
        <path d="M3 6h6" />
      </svg>
      <svg {...icon} strokeWidth={1.5} className={styles.undo} aria-hidden="true">
        <path d="M3 4.5h4a2.5 2.5 0 0 1 0 5H4.5M3 4.5l2-2M3 4.5l2 2" />
      </svg>
    </>
  ),
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
  const { tasks, taskCount, finishedCount, complete } = snapshot;
  const done = tasks.filter((row) => row.status === "done").length;
  const skipped = finishedCount - done;
  const share = (count: number) => (taskCount === 0 ? 0 : count / taskCount);
  const progress = `${done} of ${taskCount} done${skipped > 0 ? `, ${skipped} skipped` : ""}`;

  // The walkthrough under way, or else the first task still to do: the one row that opens by itself.
  const next = tasks.find((row) => row.walkthrough !== "none") ?? tasks.find((row) => row.status === "todo");
  // The row the user opened instead, or "" once they have closed every row.
  const [chosen, setChosen] = useState<string | null>(null);
  const expanded = chosen ?? next?.task.id ?? "";

  return (
    <>
      <ChecklistTrigger className={styles.trigger} aria-label={`${title}, ${progress}`}>
        <svg className={styles.ring} viewBox="0 0 18 18" aria-hidden="true">
          {complete ? (
            <path className={styles.ringCheck} d="M4.5 9.5 7.5 12.5 13.5 5.5" />
          ) : (
            <>
              <circle className={styles.ringTrack} cx="9" cy="9" r="7" />
              {/* Only what is done, which is all a ring this small can show; the panel counts what was skipped. An arc of no length would still draw its round end, as a dot. */}
              {done > 0 && (
                <circle className={styles.ringDone} cx="9" cy="9" r="7" pathLength={1} strokeDasharray={`${share(done)} 1`} transform="rotate(-90 9 9)" />
              )}
            </>
          )}
        </svg>
        {title}
        {/* Finished, the tick says it all. */}
        {!complete && (
          <span className={styles.triggerCount}>
            {done}/{taskCount}
          </span>
        )}
      </ChecklistTrigger>
      <ChecklistPanel side={side} gap={14} className={styles.panel} aria-label={title}>
        <div className={styles.header}>
          <div className={styles.headline}>
            <h2 className={styles.heading}>{title}</h2>
            <span className={styles.count} data-complete={complete ? "" : undefined}>
              {complete && tick}
              <span>
                {complete ? (skipped > 0 ? `${done} done` : "All done") : `${done} of ${taskCount} done`}
                {skipped > 0 && <span className={styles.countSkipped}> · {skipped} skipped</span>}
              </span>
            </span>
          </div>
          <div className={styles.track} aria-hidden="true">
            {/* Drawn only with something to show: an empty part would still leave its gap. */}
            {done > 0 && <div className={styles.done} style={{ width: `${share(done) * 100}%` }} />}
            {skipped > 0 && <div className={styles.skipped} style={{ width: `${share(skipped) * 100}%` }} />}
          </div>
        </div>
        <ol className={styles.list}>
          {tasks.map((row) => {
            const { task, status } = row;
            const hasActions = task.action !== undefined || task.walkthrough !== undefined || status === "todo";
            const { description } = task;
            const hasDetails = description !== undefined || hasActions;
            const open = hasDetails && expanded === task.id;
            return (
              <ChecklistTask key={task.id} row={row} className={styles.task} data-next={next?.task.id === task.id ? "" : undefined}>
                <ChecklistCheckbox className={styles.checkbox}>
                  <span className={styles.mark}>{status === "todo" && task.toggleable === false ? lock : marks[status]}</span>
                </ChecklistCheckbox>
                <div className={styles.body}>
                  <div className={styles.summary} onClick={hasDetails ? () => setChosen(open ? "" : task.id) : undefined}>
                    <ChecklistTaskTitle className={styles.title}>{task.title}</ChecklistTaskTitle>
                    {status === "skipped" && <span className={styles.tag}>Skipped</span>}
                    {hasDetails && (
                      <button
                        type="button"
                        className={styles.expander}
                        aria-expanded={open}
                        aria-label={open ? "Hide details" : "Show details"}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 6l4 4 4-4" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {open && (
                    <>
                      {description !== undefined && <p className={styles.description}>{description}</p>}
                      {hasActions && <Actions row={row} next={next?.task.id === task.id} start={start} skip={skip} />}
                    </>
                  )}
                </div>
              </ChecklistTask>
            );
          })}
        </ol>
      </ChecklistPanel>
    </>
  );
}

/** One filled button in the list, on what to do next; a finished task's button steps back. */
function Actions<TTask extends AnyReactTask>({
  row: { task, status, walkthrough },
  next,
  start,
  skip,
}: {
  row: ChecklistRow<TTask>;
  next: boolean;
  start: (id: TTask["id"]) => void;
  skip: (id: TTask["id"]) => void;
}) {
  const look = `${styles.button} ${status === "done" ? `${styles.quiet} ${styles.again}` : status === "skipped" ? styles.quiet : next ? styles.primary : styles.plain}`;
  let primary: ReactNode = null;
  if (task.action !== undefined) {
    primary = (
      <button type="button" className={look} onClick={task.action.onSelect}>
        {task.action.label}
      </button>
    );
  } else if (walkthrough === "open") {
    primary = (
      <button type="button" className={`${styles.button} ${styles.quiet} ${styles.running}`} disabled>
        In progress
      </button>
    );
  } else if (task.walkthrough !== undefined) {
    primary = (
      <button type="button" className={look} onClick={() => start(task.id)}>
        {status === "done" ? "Show me again" : walkthrough === "collapsed" ? "Continue" : "Show me"}
      </button>
    );
  }

  return (
    <div className={styles.actions}>
      {primary}
      {status === "todo" && (
        <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={() => skip(task.id)}>
          Skip
        </button>
      )}
    </div>
  );
}
