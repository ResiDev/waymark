import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Rect, TaskStatus } from "waymark-core";
import { STATUS_TEXT, useChecklist, visuallyHidden } from "./Checklist";
import { placePopover } from "./placement";
import { useMeasuredSize } from "./useMeasuredSize";
import { useViewportSize } from "./useViewportSize";
import type {
  AnyReactTask,
  ChecklistCheckboxProps,
  ChecklistPanelProps,
  ChecklistRootProps,
  ChecklistTaskProps,
} from "./types";

// Long enough that a pointer crossing the trigger on its way to something else does not open it.
const OPEN_DELAY = 150;
// Long enough to cross the gap between the trigger and the panel.
const CLOSE_DELAY = 300;
const MARGIN = 8;

type RootContextValue = Readonly<{
  open: boolean;
  running: boolean;
  activeId: string | null;
  panelId: string;
  triggerRef: RefObject<HTMLButtonElement>;
  panelRef: RefObject<HTMLDivElement>;
  /** Focuses the panel once it is placed, if the keyboard opened it. */
  focusIfKeyboardOpened: (panel: HTMLElement) => void;
  hover: (inside: boolean) => void;
  togglePinned: (fromKeyboard: boolean) => void;
  close: () => void;
  toggle: (id: string) => void;
}>;

type TaskContextValue = Readonly<{
  task: AnyReactTask;
  status: TaskStatus;
  active: boolean;
  titleId: string;
  statusId: string;
}>;

const RootContext = createContext<RootContextValue | null>(null);
const TaskContext = createContext<TaskContextValue | null>(null);

function useRootContext(part: string): RootContextValue {
  const context = useContext(RootContext);
  if (context === null) throw new Error(`${part} must be inside a ChecklistRoot.`);
  return context;
}

function useTaskContext(part: string): TaskContextValue {
  const context = useContext(TaskContext);
  if (context === null) throw new Error(`${part} must be inside a ChecklistTask.`);
  return context;
}

// On every part of a Task, so each can be styled by its Task's state without reaching up to the row.
const taskData = ({ status, active }: TaskContextValue) => ({
  "data-status": status,
  "data-active": active ? "" : undefined,
});

/**
 * The page's own pointer events, not React's: React's enter and leave follow the
 * component tree, where the portalled panel sits inside the trigger's parent, and
 * so can report an enter on a panel the pointer never reached.
 */
function usePointerHover(
  ref: RefObject<HTMLElement>,
  hover: (inside: boolean) => void,
  mounted: boolean,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!mounted || !element) return;
    // A touch has no hover to end it, so only a press opens the checklist.
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== "touch") hover(true);
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType !== "touch") hover(false);
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
    };
  }, [ref, hover, mounted]);
}

/** Holds the checklist's state for its trigger and panel. Renders no element of its own. */
export function ChecklistRoot<TTask extends AnyReactTask>({
  checklist,
  children,
}: ChecklistRootProps<TTask>) {
  const state = useChecklist(checklist);
  const activeId = state.snapshot.active?.task.id ?? null;
  const activeRun = state.snapshot.active?.run ?? null;
  const running = activeId !== null;

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPanel = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const hover = useCallback((inside: boolean) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(inside), inside ? OPEN_DELAY : CLOSE_DELAY);
  }, []);
  const focusIfKeyboardOpened = useCallback((panel: HTMLElement) => {
    if (!focusPanel.current) return;
    focusPanel.current = false;
    panel.focus({ preventScroll: true });
  }, []);
  const close = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
    setPinned(false);
  }, []);

  useEffect(() => {
    const timer = hoverTimer;
    return () => clearTimeout(timer.current);
  }, []);

  // A Task started from the open panel should not leave it covering the page being guided.
  // In a layout effect, so it closes before the page paints and before a pending hover fires;
  // done during render instead, StrictMode's replayed render lost it.
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- resets pin and hover; an `open` derived from `running` would reopen when the Run ends
    if (activeRun !== null) close();
  }, [activeRun, close]);

  useEffect(() => {
    if (!pinned) return;
    const closeOutside = (event: PointerEvent) => {
      const { target } = event;
      const inside = [triggerRef, panelRef].some(
        (ref) => target instanceof Node && ref.current?.contains(target) === true,
      );
      if (!inside) setPinned(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [pinned]);

  const context = useMemo<RootContextValue>(
    () => ({
      open,
      running,
      activeId,
      panelId,
      triggerRef,
      panelRef,
      focusIfKeyboardOpened,
      hover,
      togglePinned: (fromKeyboard) => {
        focusPanel.current = fromKeyboard && !pinned;
        setPinned(!pinned);
      },
      close,
      toggle: (id) => {
        const row = checklist.getSnapshot().tasks.find(({ task }) => task.id === id);
        if (row) checklist.toggle(row.task.id);
      },
    }),
    [open, running, activeId, panelId, focusIfKeyboardOpened, hover, close, pinned, checklist],
  );

  return (
    <RootContext.Provider value={context}>
      {typeof children === "function" ? children({ ...state, open }) : children}
    </RootContext.Provider>
  );
}

/** Opens the panel under a resting mouse; a press pins it open, which is how a keyboard or a touch opens it. */
export function ChecklistTrigger({ onClick, onKeyDown, ...props }: ComponentPropsWithoutRef<"button">) {
  const { open, running, panelId, triggerRef, hover, togglePinned, close } =
    useRootContext("ChecklistTrigger");
  usePointerHover(triggerRef, hover, true);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      {...props}
      ref={triggerRef}
      data-state={open ? "open" : "closed"}
      data-running={running ? "" : undefined}
      data-waymark-ui=""
      onClick={(event) => {
        onClick?.(event);
        // Keyboard activation has no pointer, so its detail is 0.
        if (!event.defaultPrevented) togglePinned(event.detail === 0);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Escape" || !open || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    />
  );
}

/** Rendered only while open, placed against the trigger on `side` or, if that has no room, another. */
export function ChecklistPanel({
  side = "below",
  gap = 8,
  portal = true,
  style,
  onKeyDown,
  onBlur,
  ...props
}: ChecklistPanelProps) {
  const root = useRootContext("ChecklistPanel");
  const { open, triggerRef, panelRef, focusIfKeyboardOpened } = root;
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const mounted = open && anchor !== null;
  const size = useMeasuredSize(panelRef, mounted);
  const viewport = useViewportSize();
  usePointerHover(panelRef, root.hover, mounted);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const trigger = triggerRef.current;
      if (trigger) setAnchor(trigger.getBoundingClientRect());
    };
    measure();
    // Captured, so a scroll inside any container that moves the trigger counts too.
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [open, triggerRef]);

  useLayoutEffect(() => {
    if (panelRef.current) focusIfKeyboardOpened(panelRef.current);
  });

  if (!open || anchor === null) return null;

  const placed = placePopover({
    anchor,
    popover: size,
    viewport,
    preferred: side,
    gap,
    margin: MARGIN,
  });
  const position: CSSProperties & Record<`--${string}`, string> = {
    ...style,
    position: "fixed",
    top: placed.top,
    left: placed.left,
    "--waymark-available-height": `${placed.maxHeight}px`,
  };

  const node = (
    <div
      role="dialog"
      aria-label="Checklist"
      tabIndex={-1}
      {...props}
      ref={panelRef}
      id={root.panelId}
      style={position}
      data-side={placed.placement}
      data-running={root.running ? "" : undefined}
      data-waymark-ui=""
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Marks it handled, for anything else on the page listening for Escape.
        event.preventDefault();
        root.close();
        triggerRef.current?.focus();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        const next = event.relatedTarget;
        if (next === null) return;
        if (panelRef.current?.contains(next) === true || next === triggerRef.current) return;
        root.close();
      }}
    />
  );

  return portal ? createPortal(node, document.body) : node;
}

export function ChecklistTask({ row, ...props }: ChecklistTaskProps) {
  const { activeId } = useRootContext("ChecklistTask");
  const titleId = useId();
  const statusId = useId();
  const active = activeId === row.task.id;
  const context = useMemo<TaskContextValue>(
    () => ({ task: row.task, status: row.status, active, titleId, statusId }),
    [row.task, row.status, active, titleId, statusId],
  );
  return (
    <TaskContext.Provider value={context}>
      <li aria-current={active ? "step" : undefined} {...props} {...taskData(context)} />
    </TaskContext.Provider>
  );
}

/** A checkbox named by the Task's title, or a plain mark when the Task is not toggleable. */
export function ChecklistCheckbox({
  statusText = STATUS_TEXT,
  onClick,
  ...props
}: ChecklistCheckboxProps) {
  const { toggle } = useRootContext("ChecklistCheckbox");
  const context = useTaskContext("ChecklistCheckbox");
  const { task, status, titleId, statusId } = context;

  const statusLabel = (
    <span id={statusId} style={visuallyHidden}>
      {statusText[status]}
    </span>
  );

  if (task.toggleable === false) {
    return (
      <>
        <span aria-hidden="true" className={props.className} style={props.style} {...taskData(context)}>
          {props.children}
        </span>
        {statusLabel}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={status === "done"}
        aria-labelledby={titleId}
        aria-describedby={statusId}
        {...props}
        {...taskData(context)}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) toggle(task.id);
        }}
      />
      {statusLabel}
    </>
  );
}

export function ChecklistTaskTitle(props: ComponentPropsWithoutRef<"div">) {
  const context = useTaskContext("ChecklistTaskTitle");
  return <div {...props} id={context.titleId} {...taskData(context)} />;
}
