import { useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type {
  AnyReactTask,
  ChecklistLabels,
  ChecklistProps,
  ChecklistRowProps,
  CoreChecklist,
  UseChecklistResult,
} from "./types";

/** The headless route: a view's live snapshot and its commands, for custom rendering. */
export function useChecklist<TTask extends AnyReactTask>(
  checklist: CoreChecklist<TTask>,
): UseChecklistResult<TTask> {
  const snapshot = useSyncExternalStore(
    checklist.subscribe,
    checklist.getSnapshot,
    checklist.getSnapshot,
  );
  return useMemo(
    () => ({
      snapshot,
      start: checklist.start,
      markDone: checklist.markDone,
      skip: checklist.skip,
    }),
    [checklist, snapshot],
  );
}

const DEFAULT_LABELS: ChecklistLabels = {
  start: "Show me",
  replay: "Show me again",
  markDone: "Mark as done",
  skip: "Skip",
};

const STATUS_TEXT = { todo: "To do", done: "Done", skipped: "Skipped" } as const;

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

const rowStyleFor = (status: keyof typeof STATUS_TEXT, active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 8,
  background: active ? "#eff6ff" : "#f8fafc",
  outline: active ? "1px solid #93c5fd" : "none",
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

const hidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * The default row. One primary button: an application action if the task has
 * one, else guidance (start, or replay once done), else none. A todo task with
 * neither guidance nor a condition offers manual completion. Todo tasks can
 * be skipped.
 */
function DefaultRow<TTask extends AnyReactTask>({
  task,
  status,
  active,
  start,
  markDone,
  skip,
  labels,
}: ChecklistRowProps<TTask> & { labels: ChecklistLabels }) {
  const glyph = status === "done" ? "✓" : status === "skipped" ? "–" : "○";
  const manual = status === "todo" && task.walkthrough === undefined && task.isComplete === undefined;

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
        disabled={active}
        style={{ ...primaryButton, cursor: active ? "default" : "pointer", opacity: active ? 0.6 : 1 }}
      >
        {status === "done" ? labels.replay : labels.start}
      </button>
    );
  }

  return (
    <>
      <span aria-hidden="true" style={{ width: 20, textAlign: "center", color: "#3b82f6" }}>
        {glyph}
      </span>
      <span style={hidden}>{STATUS_TEXT[status]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, textDecoration: status === "done" ? "line-through" : "none" }}>
          {task.title}
        </div>
        {task.description !== undefined && (
          <div style={{ color: "#475569", marginTop: 2 }}>{task.description}</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {primary}
        {manual && (
          <button type="button" onClick={() => markDone(task.id)} style={primaryButton}>
            {labels.markDone}
          </button>
        )}
        {status === "todo" && (
          <button type="button" onClick={() => skip(task.id)} style={secondaryButton}>
            {labels.skip}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * The default checklist UI, subscribed to the same view as custom UI would
 * be. Inline defaults like the popover; `style` and `rowStyle` override,
 * `renderRow` replaces a row's content, `labels` replace the button text.
 */
export function Checklist<TTask extends AnyReactTask>({
  checklist,
  style,
  rowStyle,
  labels,
  renderRow,
}: ChecklistProps<TTask>) {
  const { snapshot, start, markDone, skip } = useChecklist(checklist);
  const text = { ...DEFAULT_LABELS, ...labels };

  return (
    <div role="group" aria-label="Checklist" style={{ ...panelStyle, ...style }}>
      <div style={{ color: "#475569" }}>
        {snapshot.finishedCount} of {snapshot.taskCount} done
      </div>
      <ol style={listStyle}>
        {snapshot.tasks.map(({ task, status }) => {
          const active = snapshot.active?.task.id === task.id;
          const props: ChecklistRowProps<TTask> = { task, status, active, start, markDone, skip };
          return (
            <li
              key={task.id}
              aria-current={active ? "step" : undefined}
              style={{ ...rowStyleFor(status, active), ...rowStyle }}
            >
              {renderRow ? renderRow(props) : <DefaultRow {...props} labels={text} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
