import { decide } from "./decide";
import type { Input } from "./decide";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { observe } from "./observe";
import type { Reading } from "./observe";
import type { Announcement, Outcome } from "./outcome";
import { CLOSED, createResource, keepInSync, OPEN } from "./resources";
import { buildSnapshot, enterStep, rendersTheSame } from "./state";
import type { Definition, State } from "./state";
import { advanceRule, selectorFor } from "./tutorial";
import type { AdvanceRule } from "./tutorial";
import type {
  Action,
  Rect,
  Run,
  RunOptions,
  Snapshot,
  Step,
  Tutorial,
  UiElements,
} from "./types";

/**
 * The driver: everything impure, and nothing else, in four named parts.
 *
 *   readPage()       every DOM read of a frame, packaged as one Reading
 *   dispatch()       the one place the State changes
 *   four resources   what must be live right now, derived from the State
 *   snapshot         rebuilt in dispatch, so reading one is just a read
 *
 * It enforces no rules. Moving between Steps is `decide` handing back a State
 * built by `enterStep`, and the resources noticing that their deps changed.
 *
 * Everything that can live at module scope does: only the functions that read
 * or write the Run's mutable cells — `state`, `snapshot`, `listeners` — are
 * closures inside `createRun`.
 */

const NO_UI = { dialog: null, beacon: null };

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

/** A Reading the driver may write into. Reused every frame; see `createRun`. */
type ReadingBuffer = { -readonly [K in keyof Reading]: Reading[K] };

/** The only DOM reads of a frame, packaged as data into the given buffer. */
const readPage = (
  root: Document | Element,
  state: State,
  definition: Definition,
  into: ReadingBuffer,
): Reading => {
  const selector = selectorFor(definition.steps[state.index]);
  const element =
    selector === undefined
      ? null
      : state.element?.isConnected
        ? state.element
        : root.querySelector(selector);
  const rect = element ? element.getBoundingClientRect() : null;
  into.element = element;
  into.rect = rect;
  into.inView = rect !== null && inViewport(rect);
  into.conditionHolds =
    definition.rules[state.index]?.byCheck?.(element) ?? false;
  into.now = performance.now();
  return into;
};

/** What the input functions need to know, read off the State. */
const inputContext = (
  state: State,
  padding: number,
  ui: UiElements,
): InputContext => ({
  collapsed: state.collapsed,
  element: state.element,
  rect: state.location.status === "found" ? state.location.rect : null,
  padding,
  ui,
});

/** A tick can end the Run, which closes this loop from inside itself. */
const openFrameLoop = (tick: () => void) => {
  let live = true;
  /** requestAnimationFrame id of the pending tick. */
  let frameId = requestAnimationFrame(function loop() {
    tick();
    if (live) frameId = requestAnimationFrame(loop);
  });
  return () => {
    live = false;
    cancelAnimationFrame(frameId);
  };
};

const openWindowInput = (
  onClick: (event: MouseEvent) => void,
  onKeyDown: (event: KeyboardEvent) => void,
) => {
  const control = new AbortController();
  const { signal } = control;
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  return () => control.abort();
};

/** Tells assistive technology that the Waymark has a popover attached. */
const openWaymarkAria = (element: Element) => {
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", "true");
  return () => {
    element.removeAttribute("aria-haspopup");
    element.removeAttribute("aria-expanded");
  };
};

const notify = (listeners: ReadonlySet<() => void>): void => {
  for (const listener of listeners) listener();
};

/** Hands one Announcement to the caller's onEvent, dressed up as a RunEvent. */
const announce = <TStep extends Step>(
  onEvent: RunOptions<TStep>["onEvent"],
  steps: readonly TStep[],
  snapshot: Snapshot<TStep>,
  announcement: Announcement,
): void =>
  onEvent?.({
    type: announcement.type,
    step: steps[announcement.stepIndex],
    stepIndex: announcement.stepIndex,
    snapshot,
  });

const openWaymarkEvents = (
  element: Element,
  names: readonly string[],
  fire: () => void,
) => {
  const control = new AbortController();
  for (const name of names) {
    element.addEventListener(name, fire, { signal: control.signal });
  }
  return () => control.abort();
};

export function createRun<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  options: RunOptions<TStep> = {},
): Run<TStep> {
  const root = options.root ?? document;
  const padding = options.waymarkPadding ?? 0;
  const ui = options.ui ?? (() => NO_UI);
  const steps = tutorial.steps;
  const definition: Definition<TStep> = {
    steps,
    rules: steps.map(advanceRule),
  };

  const listeners = new Set<() => void>();
  let state: State = enterStep(options.startAt ?? 0, definition);
  let hasAnnouncedStart = false;

  // ---- the snapshot: rebuilt where the State changes, so it cannot go stale --

  let snapshot: Snapshot<TStep> = buildSnapshot(state, definition);
  const getSnapshot = (): Snapshot<TStep> => snapshot;

  // One Reading, reused every frame. Safe because observe never keeps a
  // Reading: it takes the element reference out and copies the rect only when
  // it is news. The rect itself is the browser's own DOMRect, uncopied here.
  const reading: ReadingBuffer = {
    element: null,
    rect: null,
    inView: false,
    conditionHolds: false,
    now: 0,
  };

  // ---- the one place the State changes --------------------------------------

  const commit = (outcome: Outcome) => {
    if (outcome.state !== state) {
      const renderChanged = !rendersTheSame(state, outcome.state);
      state = outcome.state;
      if (renderChanged) snapshot = buildSnapshot(state, definition);
      syncResources();
      if (renderChanged) notify(listeners);
    }
    for (const announcement of outcome.announcements) {
      announce(options.onEvent, steps, snapshot, announcement);
    }
    outcome.scrollTo?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const dispatch = (input: Input) => commit(decide(state, input, definition));

  /** The frame path skips the Input envelope: observe is fed directly. */
  const look = () => {
    const page = readPage(root, state, definition, reading);
    const outcome = observe(state, page, definition);
    commit(outcome);
  };

  // ---- what the user is doing ----------------------------------------------

  /** On the Waymark: perhaps the condition. Away from it: put the Run away. */
  const onClick = (event: MouseEvent) => {
    const hit = whereClicked(event, inputContext(state, padding, ui()));
    if (hit === "waymark") {
      if (definition.rules[state.index]?.byClick) {
        dispatch({ kind: "conditionMet", now: performance.now() });
      }
    } else if (hit === "away") {
      dispatch({ kind: "act", action: "collapse" });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext(state, padding, ui()));
    if (action) dispatch({ kind: "act", action });
  };

  // ---- the four resources, named, and nothing else --------------------------

  const frameLoop = createResource();
  const windowInput = createResource();
  const waymarkAria = createResource();
  const waymarkEvents = createResource();

  /** No subscribers, or a Run that has ended, means nothing should be live. */
  const isWatched = () => listeners.size > 0 && state.phase === "running";

  // What the resources were last derived from; when none of it has changed,
  // there is nothing to diff — the common case on a frame that only moved.
  let derivedFrom: {
    watched: boolean;
    element: Element | null;
    rule: AdvanceRule | undefined;
  } = { watched: false, element: null, rule: undefined };

  function syncResources() {
    const watched = isWatched();
    const element = state.element;
    const rule = definition.rules[state.index];
    if (
      watched === derivedFrom.watched &&
      element === derivedFrom.element &&
      rule === derivedFrom.rule
    ) {
      return;
    }
    derivedFrom = { watched, element, rule };

    keepInSync({
      resource: frameLoop,
      deps: watched ? OPEN : CLOSED,
      open: () => openFrameLoop(look),
    });

    keepInSync({
      resource: windowInput,
      deps: watched ? OPEN : CLOSED,
      open: () => openWindowInput(onClick, onKeyDown),
    });

    keepInSync({
      resource: waymarkAria,
      deps: watched && element ? [element] : CLOSED,
      open: () => openWaymarkAria(element!),
    });

    // One AdvanceRule object per Step, so these deps change when the Step does.
    keepInSync({
      resource: waymarkEvents,
      deps:
        watched && element && rule?.byEvents.length ? [element, rule] : CLOSED,
      open: () =>
        openWaymarkEvents(element!, rule!.byEvents, () =>
          dispatch({ kind: "conditionMet", now: performance.now() }),
        ),
    });
  }

  return {
    act: (action: Action) => dispatch({ kind: "act", action }),
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      syncResources();
      if (isWatched()) {
        look(); // Locate now, so the first paint is not a frame behind.
        if (!hasAnnouncedStart) {
          hasAnnouncedStart = true;
          announce(options.onEvent, steps, snapshot, {
            type: "start",
            stepIndex: state.index,
          });
        }
      }
      return () => {
        listeners.delete(listener);
        syncResources();
      };
    },
  };
}
