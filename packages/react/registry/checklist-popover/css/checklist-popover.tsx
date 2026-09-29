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
import styles from "./checklist-popover.module.css";

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
        className={styles.trigger}
        aria-label={`${title}, ${finishedCount} of ${taskCount} done`}
      >
        <svg className={styles.ring} viewBox="0 0 16 16" aria-hidden="true">
          <circle className={styles.ringTrack} cx="8" cy="8" r="6" />
          <circle
            className={styles.ringFill}
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
      <ChecklistPanel side={side} className={styles.panel} aria-label={title}>
        <div className={styles.header}>
          <h2 className={styles.heading}>{title}</h2>
          <span className={styles.count}>{snapshot.complete ? "All done" : count}</span>
        </div>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ width: `${progress * 100}%` }} />
        </div>
        <ol className={styles.list}>
          {snapshot.tasks.map((row) => (
            <ChecklistTask key={row.task.id} row={row} className={styles.task}>
              <ChecklistCheckbox className={styles.checkbox}>{marks[row.status]}</ChecklistCheckbox>
              <div className={styles.body}>
                <ChecklistTaskTitle className={styles.title}>{row.task.title}</ChecklistTaskTitle>
                {row.task.description !== undefined && (
                  <p className={styles.description}>{row.task.description}</p>
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
      <button type="button" className={styles.primary} onClick={task.action.onSelect}>
        {task.action.label}
      </button>
    );
  } else if (task.walkthrough !== undefined) {
    primary = (
      <button type="button" className={styles.primary} disabled={active} onClick={() => start(task.id)}>
        {status === "done" ? "Show me again" : "Show me"}
      </button>
    );
  }

  if (primary === null && status !== "todo") return null;
  return (
    <div className={styles.actions}>
      {primary}
      {status === "todo" && (
        <button type="button" className={styles.secondary} onClick={() => skip(task.id)}>
          Skip
        </button>
      )}
    </div>
  );
}
