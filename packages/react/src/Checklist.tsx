import { useId, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { ChecklistDefinition, TaskStatus } from "waymark-core";
import { Button, CHECK, DASH, Icon } from "./controls";
import { color } from "./theme";
import type {
  AnyReactTask,
  ChecklistLabels,
  ChecklistProps,
  ChecklistRowProps,
  UseChecklistResult,
} from "./types";
import { withDefaults } from "./labels";
import { useRun } from "./useRun";

/** A checklist's state and commands, from the Run of the `<WaymarkRoot>` above. */
export function useChecklist<TTask extends AnyReactTask>(
  checklist: ChecklistDefinition<TTask>,
): UseChecklistResult<TTask> {
  const run = useRun();
  const view = useMemo(() => run.checklist(checklist), [run, checklist]);
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getServerSnapshot);
  return useMemo(
    () => ({
      snapshot,
      start: view.start,
      markDone: view.markDone,
      markTodo: view.markTodo,
      skip: view.skip,
      toggle: view.toggle,
    }),
    [view, snapshot],
  );
}

const DEFAULT_LABELS: ChecklistLabels = {
  start: "Show me",
  resume: "Continue",
  replay: "Show me again",
  skip: "Skip",
};

export const STATUS_TEXT = { todo: "To do", done: "Done", skipped: "Skipped" } as const;

export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

const MARK = 20;

/** One drawn circle for every state, so a Task's status is read from its shape and not from a character of the page's font. */
function Mark({ status, underWay }: { status: TaskStatus; underWay: boolean }) {
  const look: CSSProperties | null =
    status === "done"
      ? { borderColor: color.accent, color: color.onAccent, background: color.accent }
      : status === "todo" && underWay
        ? // Half a pie: started, not finished.
          { padding: 3, borderColor: color.accent, background: `conic-gradient(${color.accent} 50%, transparent 0) content-box` }
        : null;
  return (
    <span
      style={{
        boxSizing: "border-box",
        display: "grid",
        flex: "none",
        placeItems: "center",
        width: MARK,
        height: MARK,
        border: `1.5px solid ${color.muted}`,
        borderRadius: "50%",
        color: color.muted,
        ...look,
      }}
    >
      {status === "done" ? <Icon d={CHECK} /> : status === "skipped" && <Icon d={DASH} />}
    </span>
  );
}

function DefaultRow<TTask extends AnyReactTask>({
  task,
  status,
  walkthrough,
  start,
  skip,
  toggle,
  labels,
  next,
}: ChecklistRowProps<TTask> & { labels: ChecklistLabels; next: boolean }) {
  const titleId = useId();
  const statusId = useId();
  const finished = status !== "todo";
  const mark = <Mark status={status} underWay={walkthrough !== "none"} />;

  // The app's own action, or else the Task's walkthrough.
  const onSelect = task.action?.onSelect ?? (task.walkthrough && (() => start(task.id)));
  const label = task.action?.label ?? (status === "done" ? labels.replay : walkthrough === "collapsed" ? labels.resume : labels.start);

  return (
    <>
      {task.toggleable === false ? (
        mark
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={status === "done"}
          aria-labelledby={titleId}
          aria-describedby={statusId}
          onClick={() => toggle(task.id)}
          style={{
            // Larger than the circle it shows, for a finger; pulled back so the circle keeps its place in the row.
            display: "grid",
            flex: "none",
            margin: -4,
            padding: 4,
            border: 0,
            borderRadius: "50%",
            background: "none",
            cursor: "pointer",
            outlineColor: color.accent,
          }}
        >
          {mark}
        </button>
      )}
      {/* On a narrow row the buttons wrap under the text. */}
      <div style={{ display: "flex", flex: 1, flexWrap: "wrap", alignItems: "flex-start", gap: "12px 16px", minWidth: 0 }}>
        {/* A finished Task is one line, short enough to keep its button beside it on a phone. */}
        <div style={{ flex: finished ? "1 1 140px" : "1 1 240px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            {/* Heavier on the one Task to do next, so a list of titles is not all one weight. */}
            <div id={titleId} style={{ color: finished ? color.muted : color.text, fontSize: 15, fontWeight: next ? 600 : 500 }}>
              {task.title}
            </div>
            {/* Skipped is the one status the mark alone does not make plain. */}
            <span id={statusId} style={status === "skipped" ? { color: color.muted, fontSize: 12 } : visuallyHidden}>
              {STATUS_TEXT[status]}
            </span>
          </div>
          {/* Said while the Task is to be done; a finished Task steps back to its title. */}
          {task.description !== undefined && !finished && <div style={{ color: color.muted }}>{task.description}</div>}
        </div>
        {/*
          Pulled up and down, so a button sits on the title's line, and right, so the last one's text ends where the
          header's does. Left too where the first button has no box, so its text lines up with the title when the
          buttons wrap under it.
        */}
        <div style={{ display: "flex", gap: 8, margin: `-6px -12px -6px ${finished || !onSelect ? -12 : 0}px` }}>
          {onSelect && (
            // One filled button in the list, on what to do next; a finished Task's button steps back. Nothing starts
            // while the Task's walkthrough is on screen.
            <Button
              variant={finished ? "quiet" : next ? "primary" : "secondary"}
              onClick={onSelect}
              disabled={task.action === undefined && walkthrough === "open"}
            >
              {label}
            </Button>
          )}
          {status === "todo" && (
            <Button variant="quiet" onClick={() => skip(task.id)}>
              {labels.skip}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

export function Checklist<TTask extends AnyReactTask>({
  checklist,
  title,
  style,
  rowStyle,
  labels,
  renderRow,
}: ChecklistProps<TTask>) {
  const { snapshot, start, markDone, markTodo, skip, toggle } = useChecklist(checklist);
  const text = withDefaults(DEFAULT_LABELS, labels);
  const { tasks, taskCount, finishedCount } = snapshot;
  const done = tasks.filter((row) => row.status === "done").length;
  const skipped = finishedCount - done;
  // The walkthrough under way, or else the first Task still to do that has a button.
  const next =
    tasks.find((row) => row.walkthrough !== "none") ??
    tasks.find(({ task, status }) => status === "todo" && (task.action ?? task.walkthrough) !== undefined);
  const share = (count: number) => `${(count / taskCount) * 100}%`;

  return (
    <div
      role="group"
      aria-label="Checklist"
      aria-busy={snapshot.storageStatus === "loading"}
      style={{
        boxSizing: "border-box",
        overflow: "hidden",
        color: color.text,
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        fontSize: 14,
        lineHeight: "20px",
        textAlign: "start",
        ...style,
      }}
    >
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 12px" }}>
          {title !== undefined && <div style={{ flex: 1, fontSize: 16, fontWeight: 600, lineHeight: "24px" }}>{title}</div>}
          <div style={{ color: color.muted, fontSize: 13 }}>
            {done} of {taskCount} done
            {skipped > 0 && <> · {skipped} skipped</>}
          </div>
        </div>
        <div aria-hidden="true" style={{ display: "flex", height: 6, marginTop: 10, overflow: "hidden", borderRadius: 999, background: color.line }}>
          <div style={{ width: share(done), background: color.accent, transition: "width 300ms" }} />
          {/* Skipped moves the bar on, in a tint, so the list can be finished without calling a skipped Task done. */}
          <div style={{ width: share(skipped), background: color.accent, opacity: 0.35 }} />
        </div>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {tasks.map(({ task, status, walkthrough }) => {
          const open = walkthrough === "open";
          const isNext = !renderRow && next?.task.id === task.id;
          const props: ChecklistRowProps<TTask> = { task, status, walkthrough, start, markDone, markTodo, skip, toggle };
          return (
            <li
              key={task.id}
              aria-current={open ? "step" : undefined}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 20px",
                borderTop: `1px solid ${color.line}`,
                // Tinted while its walkthrough is on screen.
                background: open ? color.hover : "none",
                // A bar down the side, so the Task to do next is found without reading, and not by its button's colour alone.
                boxShadow: open || isNext ? `inset 3px 0 ${color.accent}` : "none",
                ...rowStyle,
              }}
            >
              {renderRow ? renderRow(props) : <DefaultRow {...props} labels={text} next={isNext} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
