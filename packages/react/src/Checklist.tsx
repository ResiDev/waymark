import {
  useId,
  useMemo,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ChecklistDefinition, TaskStatus } from "waymark-core";
import { Button, CheckIcon, DashIcon, LockIcon, UndoIcon } from "./controls";
import { color, focusRing, useInteraction, usePalette } from "./theme";
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

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: color.text,
  background: color.surface,
  border: `1px solid ${color.lineStrong}`,
  borderRadius: 14,
  fontSize: 14,
  lineHeight: "22px",
  textAlign: "start",
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const rowStyleFor = (open: boolean, next: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "14px 20px",
  borderTop: `1px solid ${color.line}`,
  // Tinted while its walkthrough is on screen.
  background: open ? color.accentSoft : "transparent",
  // A bar down the side, so the Task to do next is found without reading, and not by its button's colour alone.
  boxShadow: open || next ? `inset 3px 0 ${color.accent}` : "none",
});

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

const tagStyle: CSSProperties = {
  flex: "none",
  padding: "0 8px",
  border: `1px solid ${color.line}`,
  borderRadius: 999,
  color: color.muted,
  background: color.hover,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
};

const MARK = 20;

const markBase: CSSProperties = {
  boxSizing: "border-box",
  display: "grid",
  flex: "none",
  placeItems: "center",
  width: MARK,
  height: MARK,
  // Longhands, so React dropping one state's `borderColor` leaves this one standing.
  borderWidth: 1.5,
  borderStyle: "solid",
  borderColor: color.edge,
  borderRadius: "50%",
  color: color.muted,
  background: color.surface,
  transition: "background-color 120ms, border-color 120ms",
};

/** One drawn circle for every state, so a Task's status is read from its shape and not from a character of the page's font. */
function Mark({
  status,
  inProgress,
  inert,
  hovered,
}: {
  status: TaskStatus;
  inProgress: boolean;
  inert: boolean;
  hovered: boolean;
}) {
  if (status === "done") {
    return (
      <span style={{ ...markBase, borderColor: color.accent, color: color.onAccent, background: color.accent }}>
        <CheckIcon />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      // Under the pointer it shows what a press does: brings the Task back.
      <span style={{ ...markBase, ...(hovered ? { borderColor: color.muted } : { borderStyle: "dashed" }) }}>
        {hovered ? <UndoIcon /> : <DashIcon />}
      </span>
    );
  }
  if (inProgress) {
    return (
      <span
        style={{
          ...markBase,
          padding: 3,
          borderColor: color.accent,
          // Half a pie: started, not finished.
          background: `conic-gradient(${color.accent} 50%, transparent 0) content-box`,
        }}
      />
    );
  }
  // A box that cannot be ticked is locked and faint, so it does not invite a press.
  if (inert) {
    return (
      <span style={{ ...markBase, borderColor: color.lineStrong, color: color.muted, background: color.hover }}>
        <LockIcon size={11} />
      </span>
    );
  }
  return (
    <span style={{ ...markBase, color: color.accent, ...(hovered ? { borderColor: color.accent, background: color.accentSoft } : null) }}>
      {hovered && <CheckIcon />}
    </span>
  );
}

function Checkbox({
  mark,
  ...props
}: ComponentPropsWithoutRef<"button"> & { mark: Omit<Parameters<typeof Mark>[0], "hovered" | "inert"> }) {
  const [{ hovered, focused }, interaction] = useInteraction();
  return (
    <button
      type="button"
      role="checkbox"
      {...props}
      {...interaction}
      style={{
        display: "grid",
        flex: "none",
        placeItems: "center",
        // Larger than the circle it shows, for a finger; pulled back so the circle keeps its place in the row.
        width: MARK + 8,
        height: MARK + 8,
        margin: "-3px -4px",
        padding: 0,
        border: 0,
        borderRadius: "50%",
        background: "transparent",
        cursor: "pointer",
        ...(focused ? { ...focusRing, outlineOffset: -2 } : null),
      }}
    >
      <Mark {...mark} inert={false} hovered={hovered} />
    </button>
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
  const open = walkthrough === "open";
  const underWay = walkthrough !== "none";
  const titleId = useId();
  const statusId = useId();
  const finished = status !== "todo";
  // One filled button in the list, on what to do next; the others show their box only under the pointer, and a finished Task's button steps back.
  const variant = finished ? "quiet" : next ? "primary" : "plain";
  // A quiet button's text, not its hover square, lines up with the text above when the buttons wrap under it.
  const flush = { marginLeft: -10 };
  // The same for a plain button, which is padded a little more.
  const plain = { marginLeft: -12 };
  // A done Task's button reads a shade stronger than Skip, which gives a Task up; a skipped Task's stays as quiet as the Task.
  const again = status === "done" ? { ...flush, color: color.body } : flush;

  let primary: ReactNode = null;
  if (task.action !== undefined) {
    primary = (
      <Button variant={variant} onClick={task.action.onSelect} style={finished ? again : next ? undefined : plain}>
        {task.action.label}
      </Button>
    );
  } else if (open) {
    // Its walkthrough is on screen, so the button has nothing to start: it says so, and does not look broken.
    primary = (
      <Button variant="quiet" disabled style={{ color: color.accent, fontSize: 13, opacity: 1, cursor: "default" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
        In progress
      </Button>
    );
  } else if (task.walkthrough !== undefined) {
    primary = (
      <Button variant={variant} onClick={() => start(task.id)} style={finished ? again : next ? undefined : plain}>
        {status === "done" ? labels.replay : walkthrough === "collapsed" ? labels.resume : labels.start}
      </Button>
    );
  }

  const lone = primary === null && status === "todo";
  const heading = (
    <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 8, minWidth: 0 }}>
      <div
        id={titleId}
        style={{
          minWidth: 0,
          color: finished ? color.muted : color.text,
          // Heavier on the one Task to do next, so a list of titles is not all one weight.
          fontWeight: next ? 600 : 500,
        }}
      >
        {task.title}
      </div>
      {/* Skipped is the one status the mark alone does not make plain. */}
      <span id={statusId} style={status === "skipped" ? tagStyle : visuallyHidden}>
        {STATUS_TEXT[status]}
      </span>
    </div>
  );
  // Said once the Task is to be done; a finished Task steps back to its title.
  const description = task.description !== undefined && !finished && (
    <div style={{ color: color.muted, textWrap: "pretty" }}>{task.description}</div>
  );
  // Pulled up, so a button sits on the title's line whatever the row's height, and right, so a quiet button's text ends where the header's does.
  const actions = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "-5px -10px -5px 0" }}>
      {primary}
      {status === "todo" && (
        <Button variant="quiet" onClick={() => skip(task.id)}>
          {labels.skip}
        </Button>
      )}
    </div>
  );

  return (
    <>
      {task.toggleable === false ? (
        <span aria-hidden="true" style={{ display: "grid", flex: "none", height: 22, placeItems: "center" }}>
          <Mark status={status} inProgress={underWay} inert hovered={false} />
        </span>
      ) : (
        <Checkbox
          aria-checked={status === "done"}
          aria-labelledby={titleId}
          aria-describedby={statusId}
          onClick={() => toggle(task.id)}
          mark={{ status, inProgress: underWay }}
        />
      )}
      {lone ? (
        // A lone Skip is small enough to stay on the title's line at any width, with the description under both.
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            {heading}
            {actions}
          </div>
          {description}
        </div>
      ) : (
        // On a narrow row the buttons wrap under the text; the row gap is what is left once they are pulled up.
        <div style={{ display: "flex", flex: 1, flexWrap: "wrap", alignItems: "flex-start", gap: "11px 16px", minWidth: 0 }}>
          {/* A finished Task is one line, short enough to keep its button beside it on a phone. */}
          <div style={{ flex: finished ? "1 1 140px" : "1 1 260px", minWidth: 0 }}>
            {heading}
            {description}
          </div>
          {actions}
        </div>
      )}
    </>
  );
}

const barStyle: CSSProperties = { height: "100%", borderRadius: 999, transition: "width 300ms" };

export function Checklist<TTask extends AnyReactTask>({
  checklist,
  title,
  style,
  rowStyle,
  labels,
  renderRow,
}: ChecklistProps<TTask>) {
  const palette = usePalette();
  const { snapshot, start, markDone, markTodo, skip, toggle } = useChecklist(checklist);
  const text = withDefaults(DEFAULT_LABELS, labels);
  const { tasks, taskCount, finishedCount, complete } = snapshot;
  const done = tasks.filter((row) => row.status === "done").length;
  const skipped = finishedCount - done;
  // The walkthrough under way, or else the first Task still to do that has a button.
  const next =
    tasks.find((row) => row.walkthrough !== "none") ??
    tasks.find(({ task, status }) => status === "todo" && (task.action ?? task.walkthrough) !== undefined);
  const share = (count: number) => `${taskCount === 0 ? 0 : (count / taskCount) * 100}%`;

  return (
    <div
      role="group"
      aria-label="Checklist"
      aria-busy={snapshot.storageStatus === "loading"}
      style={{ ...palette, ...panelStyle, ...style }}
    >
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 12px" }}>
          {title !== undefined && (
            <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, lineHeight: "24px", letterSpacing: "-0.01em" }}>
              {title}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: complete ? color.text : color.muted,
              fontSize: 13,
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {complete && (
              <span style={{ display: "grid", color: color.accent }}>
                <CheckIcon size={14} />
              </span>
            )}
            <span>
              {complete ? (
                skipped > 0 ? (
                  <>{done} done</>
                ) : (
                  "All done"
                )
              ) : (
                <>
                  {done} of {taskCount} done
                </>
              )}
              {skipped > 0 && <span style={{ color: color.muted, fontWeight: 400 }}> · {skipped} skipped</span>}
            </span>
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{ display: "flex", gap: 2, height: 6, marginTop: 10, overflow: "hidden", borderRadius: 999, background: color.line }}
        >
          {/* Drawn only with something to show: an empty part would still leave its gap. */}
          {done > 0 && <div style={{ ...barStyle, width: share(done), background: color.accent }} />}
          {/* Skipped moves the bar on, in grey, so the list can be finished without calling a skipped Task done. */}
          {skipped > 0 && <div style={{ ...barStyle, width: share(skipped), background: color.skipped }} />}
        </div>
      </div>
      <ol style={listStyle}>
        {tasks.map(({ task, status, walkthrough }) => {
          const open = walkthrough === "open";
          const isNext = next?.task.id === task.id;
          const props: ChecklistRowProps<TTask> = {
            task,
            status,
            walkthrough,
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
              style={{ ...rowStyleFor(open, !renderRow && isNext), ...rowStyle }}
            >
              {renderRow ? renderRow(props) : <DefaultRow {...props} labels={text} next={isNext} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
