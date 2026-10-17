import { useId, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ChecklistDefinition } from "waymark-core";
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
  replay: "Show me again",
  skip: "Skip",
};

export const STATUS_TEXT = { todo: "To do", done: "Done", skipped: "Skipped" } as const;

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  color: "#0f172a",
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  fontSize: 14,
  lineHeight: 1.5,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const rowStyleFor = (status: keyof typeof STATUS_TEXT, open: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 8,
  background: open ? "#eff6ff" : "#f8fafc",
  outline: open ? "1px solid #93c5fd" : "none",
  opacity: status === "todo" ? 1 : 0.7,
});

const primaryButton: CSSProperties = {
  border: 0,
  padding: "6px 12px",
  color: "white",
  background: "#3b82f6",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryButton: CSSProperties = {
  border: 0,
  padding: "6px 4px",
  color: "#64748b",
  background: "transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const boxStyle: CSSProperties = {
  flex: "none",
  width: 20,
  padding: 0,
  border: 0,
  font: "inherit",
  textAlign: "center",
  color: "#3b82f6",
  background: "transparent",
};

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

function DefaultRow<TTask extends AnyReactTask>({
  task,
  status,
  open,
  start,
  skip,
  toggle,
  labels,
}: ChecklistRowProps<TTask> & { labels: ChecklistLabels }) {
  const titleId = useId();
  const statusId = useId();
  const glyph = status === "done" ? "✓" : status === "skipped" ? "–" : "○";

  let primary: ReactNode = null;
  if (task.action !== undefined) {
    primary = (
      <button type="button" onClick={task.action.onSelect} style={primaryButton}>
        {task.action.label}
      </button>
    );
  } else if (task.walkthrough !== undefined) {
    primary = (
      <button
        type="button"
        onClick={() => start(task.id)}
        disabled={open}
        style={{ ...primaryButton, cursor: open ? "default" : "pointer", opacity: open ? 0.6 : 1 }}
      >
        {status === "done" ? labels.replay : labels.start}
      </button>
    );
  }

  return (
    <>
      {task.toggleable === false ? (
        <span aria-hidden="true" style={boxStyle}>
          {glyph}
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={status === "done"}
          aria-labelledby={titleId}
          aria-describedby={statusId}
          onClick={() => toggle(task.id)}
          style={{ ...boxStyle, cursor: "pointer" }}
        >
          <span aria-hidden="true">{glyph}</span>
        </button>
      )}
      <span id={statusId} style={visuallyHidden}>
        {STATUS_TEXT[status]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          id={titleId}
          style={{ fontWeight: 600, textDecoration: status === "done" ? "line-through" : "none" }}
        >
          {task.title}
        </div>
        {task.description !== undefined && (
          <div style={{ color: "#475569", marginTop: 2 }}>{task.description}</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {primary}
        {status === "todo" && (
          <button type="button" onClick={() => skip(task.id)} style={secondaryButton}>
            {labels.skip}
          </button>
        )}
      </div>
    </>
  );
}

export function Checklist<TTask extends AnyReactTask>({
  checklist,
  style,
  rowStyle,
  labels,
  renderRow,
}: ChecklistProps<TTask>) {
  const { snapshot, start, markDone, markTodo, skip, toggle } = useChecklist(checklist);
  const text = withDefaults(DEFAULT_LABELS, labels);

  return (
    <div
      role="group"
      aria-label="Checklist"
      aria-busy={snapshot.storageStatus === "loading"}
      style={{ ...panelStyle, ...style }}
    >
      <div style={{ color: "#475569" }}>
        {snapshot.finishedCount} of {snapshot.taskCount} done
      </div>
      <ol style={listStyle}>
        {snapshot.tasks.map(({ task, status, inProgress }) => {
          const open = snapshot.open?.id === task.id;
          const props: ChecklistRowProps<TTask> = {
            task,
            status,
            open,
            inProgress,
            start,
            markDone,
            markTodo,
            skip,
            toggle,
          };
          return (
            <li
              key={task.id}
              aria-current={open ? "step" : undefined}
              style={{ ...rowStyleFor(status, open), ...rowStyle }}
            >
              {renderRow ? renderRow(props) : <DefaultRow {...props} labels={text} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
