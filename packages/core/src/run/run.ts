import { statusIn, EMPTY } from "../checklists/record";
import { createStatuses } from "../checklists/statuses";
import { checkConditions, eventsBetween, finishTasks, reopen } from "../checklists/tasks";
import type { Moment } from "../checklists/tasks";
import type {
  AnyTask,
  Checklist,
  ChecklistDefinition,
  ChecklistGroup,
  DefinedTask,
  StorageStatus,
} from "../checklists/types";
import { createView, refresh } from "../checklists/views";
import type { View, ViewSource } from "../checklists/views";
import { inDevelopment } from "../dev";
import { dictionary } from "../dictionary";
import { problemReporter, recordDropped, recordUnreadable, storageFailed } from "../problems";
import type { WaymarkProblem } from "../problems";
import { createQueue } from "../queue";
import { adapterOf, loadFrom, saveTo } from "../storage/adapter";
import { DEFAULT_MAX_AGE, isEmptyRecord, parseRecord, staleness, storedRecord } from "../storage/records";
import type { Parsed, Read } from "../storage/records";
import { listen } from "../subscribe";
import { checkOf, hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import {
  apply,
  liveWatchers,
  needsAdvanceRead,
  NOTHING_LIVE,
  sameWaymarkAria,
  sameWaymarkEvents,
  sight,
  unsighted,
} from "./rules";
import type { AdvanceRead, Message, Sighting, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import { opening, stepAt } from "./state";
import type { State } from "./state";
import type {
  Action,
  AttachOptions,
  Beacon,
  Ended,
  OpenWalkthrough,
  Rect,
  Run,
  RunEvent,
  RunOptions,
  RunSnapshot,
  Snapshot,
  UiElements,
} from "./types";

const NO_UI: UiElements = { dialog: null };
const NO_PROGRESS: Readonly<Record<string, WalkthroughProgress>> = Object.freeze(dictionary<WalkthroughProgress>());
const NO_BEACONS: readonly Beacon[] = Object.freeze([]);

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < globalThis.innerHeight &&
  rect.left < globalThis.innerWidth;

type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

const syncWatcher = <K>(
  watcher: Watcher<K>,
  key: K | undefined,
  open: (key: K) => () => void,
  same: (a: K, b: K) => boolean = Object.is,
): Watcher<K> => {
  if (watcher !== undefined && key !== undefined && same(watcher.key, key)) return watcher;
  watcher?.close();
  return key === undefined ? undefined : { key, close: open(key) };
};

const openInput = (
  onClick: (event: MouseEvent) => void,
  onKeyDown: (event: KeyboardEvent) => void,
) => {
  const control = new AbortController();
  const { signal } = control;
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  return () => control.abort();
};

const openWaymarkAria = ({ element, expanded }: WaymarkAria) => {
  const originalAttributes = ["aria-haspopup", "aria-expanded"].map(
    (name) => [name, element.getAttribute(name)] as const,
  );
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", String(expanded));
  return () => {
    for (const [name, value] of originalAttributes) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
};

const listenToWaymarkEvents = ({ element, events }: WaymarkEvents, onEvent: () => void) => {
  const control = new AbortController();
  for (const name of events) {
    element.addEventListener(name, onEvent, { signal: control.signal });
  }
  return () => control.abort();
};

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

/** The open walkthrough and its State, the one thing `rules.ts` works on. */
type Machine = { readonly walkthrough: Walkthrough; state: State };

type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

type Flags = Readonly<{
  /** No checklist events: the change came from storage or a checklist arriving, not the user. */
  silent?: boolean;
  /** False: the record is neither saved nor handed to `onChange`. */
  persist?: boolean;
}>;

/** What checklists are drawn from. */
type Seen = Moment & Readonly<{ open: string | undefined; storageStatus: StorageStatus }>;

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
// The body works on any walkthrough, as one Run holds walkthroughs of many
// step types. TypeScript checks this signature against the one above only
// loosely.
export function createRun(options: RunOptions = {}): Run {
  // Read as late as possible, so a Run can be made on a server, where there is no document.
  const root = () => options.root ?? document;
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  /** Handed over as each walkthrough is used, and never saved. */
  const definitions = new Map<string, Walkthrough>();
  /** Progress from storage not yet checked against its definition. Until then it waits as data. */
  const restored = new Set<string>();
  let progress = NO_PROGRESS;
  const statuses = createStatuses();
  let storageStatus: StorageStatus = adapter !== undefined && options.initial === undefined ? "loading" : "ready";
  /**
   * The stored record could not be read. It may be fine, as with a newer
   * version, so what the Run does by itself does not save over it; a change
   * the user makes does.
   */
  let storedUnread = false;
  let context = options.context;
  /** From `requestStart`, oldest first. */
  const waiting: Walkthrough[] = [];
  let machine: Machine | undefined;
  /** The step generation of the last step shown, which the next walkthrough's steps follow. */
  let lastGeneration = -1;
  /** Where each collapsed walkthrough's Waymark is, while none is open. */
  const sightings = new Map<string, Sighting>();
  const attachments: Attachment[] = [];
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  /** The checklist whose Start began each running walkthrough, by its id, so a skip from its popover names it. */
  const startedFrom = new Map<string, string>();

  const groups = new Set<ChecklistGroup>();
  /** Every Task of the checklists that have reached the Run, the first definition of each id. */
  const tasks: DefinedTask[] = [];
  const taskById = new Map<string, DefinedTask>();
  const views = new Map<ChecklistDefinition<AnyTask>, View<AnyTask>>();
  const checklists = new Map<ChecklistDefinition<AnyTask>, Checklist<AnyTask>>();

  let snapshot: RunSnapshot = { storageStatus, progress, open: null, beacons: NO_BEACONS };

  // Gathered while a change is made, and announced once it is done.
  let events: RunEvent[] = [];
  let problems: WaymarkProblem[] = [];
  /** The checklist each Task's status was changed from, for its event. */
  let credits = new Map<string, string>();

  const setProgress = (id: string, value: WalkthroughProgress | undefined) => {
    const next = Object.assign(dictionary<WalkthroughProgress>(), progress);
    if (value === undefined) delete next[id];
    else next[id] = value;
    progress = next;
  };

  /** A new object only when the step, the phase or whether it is collapsed changed. */
  const record = (id: string, shown: Snapshot) => {
    const status = shown.phase === "running" ? "running" : shown.phase === "completed" ? "finished" : "exited";
    const hidden = shown.phase === "running" && shown.collapsed;
    const was = progress[id];
    if (
      was?.status === status &&
      was.step === shown.stepIndex &&
      was.stepCount === shown.stepCount &&
      was.collapsed === hidden
    ) {
      return;
    }
    setProgress(id, { status, step: shown.stepIndex, stepCount: shown.stepCount, collapsed: hidden, changedAt: Date.now() });
  };

  /** Collapsed walkthroughs the Run can draw as beacons: none while one is open. */
  const collapsedNow = (): [Walkthrough, WalkthroughProgress][] => {
    if (machine !== undefined) return [];
    const found: [Walkthrough, WalkthroughProgress][] = [];
    for (const [id, saved] of Object.entries(progress)) {
      const walkthrough = definitions.get(id);
      if (saved.status === "running" && saved.collapsed && walkthrough !== undefined && !restored.has(id)) {
        found.push([walkthrough, saved]);
      }
    }
    return found;
  };

  /** A walkthrough already part way through opens as it was, and sends no `start` when drawn. */
  const open = (walkthrough: Walkthrough, index: number, how: "fresh" | "resume" | "restore") => {
    const state = opening(walkthrough, index, {
      stepGeneration: lastGeneration,
      attached: attachments.length > 0,
      resumed: how !== "fresh",
    });
    machine = { walkthrough, state };
    record(walkthrough.id, state.snapshot);
    if (how === "resume") {
      const step = stepAt(walkthrough, index);
      events.push({ type: "resume", walkthrough: walkthrough.id, step, stepIndex: index, snapshot: state.snapshot });
    }
  };

  /** Brings progress up to the open walkthrough's state, and lets go of it once it is no longer open. */
  const release = () => {
    if (machine === undefined) return;
    const { walkthrough, state } = machine;
    const shown = state.snapshot;
    record(walkthrough.id, shown);
    if (shown.phase === "running" && !shown.collapsed) return;
    // Its beacon starts where the walkthrough last saw its Waymark.
    if (shown.phase === "running") {
      sightings.set(walkthrough.id, {
        stepIndex: shown.stepIndex,
        waymark: shown.waymark,
        unseenSince: state.unseenSince,
        element: state.element,
      });
    }
    lastGeneration = state.stepGeneration;
    machine = undefined;
  };

  /** When nothing is open, a waiting request goes before the beacons show. */
  const settle = () => {
    release();
    if (machine === undefined) {
      // A request the user has since started, finished or exited is dropped on the way.
      const next = waiting.find((walkthrough) => progress[walkthrough.id] === undefined);
      waiting.splice(0, next === undefined ? waiting.length : waiting.indexOf(next) + 1);
      if (next !== undefined) open(next, 0, "fresh");
    }
    // A beacon's Waymark is looked for afresh each time it shows: it may have moved while another walkthrough was open.
    const shown = new Map<string, Sighting>();
    for (const [walkthrough, saved] of collapsedNow()) {
      const sighting = sightings.get(walkthrough.id);
      shown.set(
        walkthrough.id,
        sighting?.stepIndex === saved.step ? sighting : unsighted(stepAt(walkthrough, saved.step), saved.step),
      );
    }
    sightings.clear();
    for (const [id, sighting] of shown) sightings.set(id, sighting);
  };

  const obey = (message: Message) => {
    if (machine === undefined) return;
    const { walkthrough, state } = machine;
    const from = state.snapshot;
    const outcome = apply(state, message, walkthrough);
    outcome.scrollTo?.scrollIntoView({ behavior: "smooth", block: "center" });
    machine.state = outcome.state;
    if (from.phase !== "running") return;
    const { id } = walkthrough;
    const { step, stepIndex } = from;
    if (outcome.waymarkGone !== undefined) {
      const type = outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing";
      problems.push({ type, walkthrough: id, step, stepIndex });
    }
    for (const type of outcome.events) {
      events.push({ type, walkthrough: id, step, stepIndex, snapshot: outcome.state.snapshot });
    }
  };

  /** Sets the open walkthrough aside as its `dismiss` says, for the one started over it. */
  const interrupt = (by: string) => {
    if (machine === undefined) return;
    const { walkthrough, state } = machine;
    const from = state.snapshot;
    if (from.phase !== "running") return;
    machine.state = apply(state, { kind: "act", action: walkthrough.dismiss ?? "collapse" }, walkthrough).state;
    events.push({
      type: "interrupt",
      walkthrough: walkthrough.id,
      step: from.step,
      stepIndex: from.stepIndex,
      snapshot: machine.state.snapshot,
      interruptedBy: by,
    });
    release();
  };

  /**
   * A walkthrough's definition meets its restored progress: dropped if it
   * cannot be picked up again, and, if it was open, open again, or set aside as
   * if interrupted when another is.
   */
  const arrive = (walkthrough: Walkthrough) => {
    const { id } = walkthrough;
    if (!restored.delete(id)) return;
    const saved = progress[id];
    if (saved === undefined) return;
    const reason = staleness(saved, walkthrough.steps.length, walkthrough.maxAge ?? DEFAULT_MAX_AGE);
    if (reason !== undefined) {
      // Dropped before the handler hears, so a walkthrough it starts keeps its progress.
      setProgress(id, undefined);
      problems.push(recordDropped(id, reason));
      return;
    }
    if (saved.status !== "running" || saved.collapsed) return;
    if (machine === undefined) open(walkthrough, saved.step, "restore");
    else if (walkthrough.dismiss === "exit") setProgress(id, { ...saved, status: "exited", changedAt: Date.now() });
    else setProgress(id, { ...saved, collapsed: true, changedAt: Date.now() });
  };

  const begin = (walkthrough: Walkthrough) => {
    const at = waiting.indexOf(walkthrough);
    if (at !== -1) waiting.splice(at, 1);
    if (machine?.walkthrough.id === walkthrough.id) return;
    interrupt(walkthrough.id);
    const saved = progress[walkthrough.id];
    if (saved?.status === "running") open(walkthrough, saved.step, saved.collapsed ? "resume" : "restore");
    else open(walkthrough, 0, "fresh");
  };

  const request = (walkthrough: Walkthrough) => {
    if (progress[walkthrough.id] !== undefined || waiting.includes(walkthrough)) return;
    if (machine === undefined) open(walkthrough, 0, "fresh");
    else waiting.push(walkthrough);
  };

  const resetOne = (walkthrough: Walkthrough) => {
    if (machine?.walkthrough.id === walkthrough.id) {
      obey({ kind: "act", action: "reset" });
      return;
    }
    restored.delete(walkthrough.id);
    if (progress[walkthrough.id] !== undefined) setProgress(walkthrough.id, undefined);
  };

  const actOn = (walkthrough: Walkthrough, action: Action) => {
    if (action === "reset") {
      resetOne(walkthrough);
      return;
    }
    arrive(walkthrough);
    if (machine?.walkthrough.id === walkthrough.id) {
      obey({ kind: "act", action });
      return;
    }
    if (action === "resume") {
      begin(walkthrough);
      return;
    }
    const saved = progress[walkthrough.id];
    if (action !== "exit" || saved?.status !== "running") return;
    const ended: Ended = { phase: "exited", stepIndex: saved.step, stepCount: saved.stepCount };
    record(walkthrough.id, ended);
    const step = stepAt(walkthrough, saved.step);
    events.push({ type: "exit", walkthrough: walkthrough.id, step, stepIndex: saved.step, snapshot: ended });
  };

  const conditions = () => {
    if (context !== undefined) checkConditions(tasks, statuses, context, (error) => queue.fail("isComplete", error));
  };

  const credit = (id: string, from: string | undefined) => {
    if (from !== undefined) credits.set(id, from);
  };

  const skip = (id: string, from: string | undefined) => {
    const task = taskById.get(id);
    if (task === undefined || statuses.status(id) !== "todo") return;
    statuses.set(id, "skipped");
    const walkthrough = task.walkthrough === undefined ? undefined : definitions.get(task.walkthrough.id);
    credit(id, from ?? (walkthrough === undefined ? undefined : startedFrom.get(walkthrough.id)));
    if (walkthrough !== undefined) actOn(walkthrough, "exit");
  };

  const toggle = (id: string, from: string) => {
    const task = taskById.get(id);
    if (task === undefined) return;
    if (statuses.status(id) === "todo") statuses.set(id, "done");
    else reopen(task, statuses);
    credit(id, from);
  };

  const markTodo = (id: string, from: string) => {
    const task = taskById.get(id);
    if (task === undefined) return;
    reopen(task, statuses);
    credit(id, from);
  };

  const moment = (): Moment => ({ statuses: statuses.record(), progress });

  // Snapshots

  let openShown: OpenWalkthrough | null = null;
  const beaconsShown = new Map<string, Beacon>();

  const openNow = (): OpenWalkthrough | null => {
    if (machine === undefined) return null;
    const { walkthrough, state } = machine;
    const { snapshot: shown } = state;
    if (shown.phase !== "running") return null;
    const task = tasks.find((candidate) => candidate.walkthrough?.id === walkthrough.id)?.id ?? null;
    if (openShown?.walkthrough !== walkthrough || openShown.snapshot !== shown || openShown.task !== task) {
      openShown = { walkthrough, snapshot: shown, task };
    }
    return openShown;
  };

  /** Each where its Waymark is found; only the one collapsed most recently goes without, at the bottom of the screen. */
  const beaconsNow = (previous: readonly Beacon[]): readonly Beacon[] => {
    const candidates = collapsedNow();
    let latest: Walkthrough | undefined;
    let latestAt = -Infinity;
    for (const [walkthrough, saved] of candidates) {
      if (saved.changedAt >= latestAt) {
        latest = walkthrough;
        latestAt = saved.changedAt;
      }
    }
    const shown: Beacon[] = [];
    for (const [walkthrough, saved] of candidates) {
      const waymark = sightings.get(walkthrough.id)?.waymark;
      if (waymark === undefined) continue;
      const anywhere = waymark.status === "absent" || waymark.status === "lost" || waymark.status === "missing";
      if (waymark.status !== "found" && !(anywhere && walkthrough === latest)) continue;
      const last = beaconsShown.get(walkthrough.id);
      const beacon =
        last?.walkthrough === walkthrough && last.stepIndex === saved.step && last.waymark === waymark
          ? last
          : { walkthrough, step: stepAt(walkthrough, saved.step), stepIndex: saved.step, waymark };
      beaconsShown.set(walkthrough.id, beacon);
      shown.push(beacon);
    }
    if (shown.length === 0) return NO_BEACONS;
    return shown.length === previous.length && shown.every((beacon, index) => beacon === previous[index])
      ? previous
      : shown;
  };

  const build = (previous: RunSnapshot): RunSnapshot => {
    const opened = openNow();
    const beacons = beaconsNow(previous.beacons);
    return previous.storageStatus === storageStatus &&
      previous.progress === progress &&
      previous.open === opened &&
      previous.beacons === beacons
      ? previous
      : { storageStatus, progress, open: opened, beacons };
  };

  // Checklists

  const seen = (): Seen => ({ ...moment(), open: machine?.walkthrough.id, storageStatus });

  const sourceFor = (definition: ChecklistDefinition<AnyTask>, now: () => Seen): ViewSource => {
    const walkthroughOf = new Map(definition.group.tasks.map((task) => [task.id, task.walkthrough?.id]));
    const progressOf = (id: string) => {
      const walkthrough = walkthroughOf.get(id);
      return walkthrough === undefined ? undefined : now().progress[walkthrough];
    };
    return {
      status: (id) => statusIn(now().statuses, id),
      inProgress: (id) => {
        const saved = progressOf(id);
        return saved?.status === "running" && saved.collapsed;
      },
      isOpen: (id) => {
        const walkthrough = walkthroughOf.get(id);
        return walkthrough !== undefined && walkthrough === now().open;
      },
      storageStatus: () => now().storageStatus,
    };
  };

  // Changes

  const commit = (work: () => void, flags: Flags = {}) => {
    const before = moment();
    events = [];
    problems = [];
    credits = new Map();
    work();
    settle();
    finishTasks(tasks, before, moment(), statuses);
    const after = moment();
    for (const id of startedFrom.keys()) {
      if (after.progress[id]?.status !== "running") startedFrom.delete(id);
    }
    const announced = { events, problems, credits };

    const next = build(snapshot);
    const changed = next !== snapshot;
    snapshot = next;
    // Every snapshot is up to date before any callback runs, so a callback that reads another sees this change too.
    const refreshed = refresh(views.values());
    // Always, not only on change: a frame that has just fired must be
    // re-requested even when its look found nothing new.
    reconcile();
    lookOnOpening();

    if (changed) queue.notify(listeners, snapshot);
    for (const view of refreshed.changed) queue.notify(view.listeners, view.snapshot);
    if (flags.persist !== false && (after.progress !== before.progress || after.statuses !== before.statuses)) save();
    // After notify, so a handler sees a renderer that has already redrawn.
    for (const problem of announced.problems) queue.invoke(() => report(problem));
    const onEvent = options.onEvent;
    if (onEvent === undefined) return;
    for (const event of announced.events) queue.callApp("onEvent", () => onEvent(event));
    if (flags.silent === true) return;
    for (const event of eventsBetween(tasks, before, after, (id) => announced.credits.get(id))) {
      queue.callApp("onEvent", () => onEvent(event));
    }
    for (const view of refreshed.completed) {
      queue.callApp("onEvent", () =>
        onEvent({ type: "checklistComplete", checklist: view.name, snapshot: view.snapshot }),
      );
    }
  };

  const change = (work: () => void, flags?: Flags) => queue.run(() => commit(work, flags));

  const send = (...messages: Message[]) => {
    for (const message of messages) change(() => obey(message));
  };

  const save = () => {
    storedUnread = false;
    const stored = storedRecord(progress, statuses.record());
    if (adapter !== undefined) {
      const saved = isEmptyRecord(stored) ? null : stored;
      queue.invoke(() => saveTo(adapter, saved, (error) => report(storageFailed(error))));
    }
    const onChange = options.onChange;
    if (onChange !== undefined) queue.callApp("onChange", () => onChange(stored));
  };

  /** While the record loads, a command waits, so it acts on the user's progress rather than none. */
  const later = (command: () => void) => {
    if (storageStatus === "loading") held.push(command);
    else command();
  };

  /** The Run's definition for this id; another under an id already taken is a mistake. */
  const take = (walkthrough: Walkthrough): Walkthrough => {
    const known = definitions.get(walkthrough.id);
    if (known === undefined) {
      definitions.set(walkthrough.id, walkthrough);
      return walkthrough;
    }
    if (known !== walkthrough && inDevelopment()) {
      throw new Error(
        `Walkthrough "${walkthrough.id}" was handed to the Run by two different definitions. Define each walkthrough once, outside render, and give each its own id.`,
      );
    }
    return known;
  };

  // The page

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    const where = root();
    const reusable =
      cached !== null &&
      cached.isConnected &&
      where.contains(cached) &&
      cached.matches(selector);
    const element = reusable ? cached : where.querySelector(selector);
    const box = element?.getBoundingClientRect();
    // An empty box, as `display: none` gives, is on the page but has nowhere to point.
    const rect = box && (box.width > 0 || box.height > 0) ? box : null;
    return { element, rect, inView: rect !== null && inViewport(rect) };
  };

  // A check that throws would throw every frame; each distinct error once per step is enough to see the bug.
  let thrownStep: number | undefined;
  let thrownErrors = new Set<string>();
  const firstThrowThisStep = (error: unknown, stepGeneration: number): boolean => {
    if (thrownStep !== stepGeneration) {
      thrownStep = stepGeneration;
      thrownErrors = new Set();
    }
    const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (thrownErrors.has(key)) return false;
    thrownErrors.add(key);
    return true;
  };

  const sendRead = (...after: Message[]) => {
    if (machine === undefined) return;
    const { state } = machine;
    const shown = state.snapshot;
    if (shown.phase !== "running") return;
    const { step } = shown;
    // Stamped before the check runs: the check is the author's code and may act on the Run.
    const stepGeneration = state.stepGeneration;
    const selector = selectorOf(step);
    const waymark = selector === undefined ? undefined : measure(selector, state.element);

    let advance: AdvanceRead | undefined;
    if (needsAdvanceRead(state)) {
      let holds = false;
      try {
        holds = checkOf(step)?.(waymark?.element ?? null) === true;
      } catch (error) {
        // Thrown once the look is sent, so the next frame is still scheduled.
        if (firstThrowThisStep(error, stepGeneration)) queue.fail("stateCheck", error);
      }
      advance = { holds };
    }

    const stepRead: StepRead = { now: performance.now(), waymark, advance };
    const read: Message[] = waymark || advance ? [{ kind: "stepRead", stepGeneration, stepRead }] : [];
    send(...read, ...after);
  };

  const lookAtBeacons = () => {
    const now = performance.now();
    for (const [walkthrough, saved] of collapsedNow()) {
      const step = stepAt(walkthrough, saved.step);
      const selector = selectorOf(step);
      const previous = sightings.get(walkthrough.id);
      if (selector === undefined || previous === undefined) continue;
      sightings.set(walkthrough.id, sight(previous, measure(selector, previous.element), now, step));
    }
  };

  /**
   * A walkthrough is looked at as soon as it is drawn: as it opens while
   * attached, and as the Run attaches. Its first look comes before its `start`,
   * and both before anything a listener does on seeing it.
   */
  let looked: Machine | undefined;
  const lookOnOpening = () => {
    if (machine === undefined || looked === machine || !machine.state.attached) return;
    looked = machine;
    sendRead({ kind: "start", stepGeneration: machine.state.stepGeneration });
  };

  const inputContext = (): InputContext => {
    const attachment = attachments.at(-1);
    const shown = machine?.state.snapshot;
    return {
      dismiss: machine?.walkthrough.dismiss ?? "collapse",
      element: machine?.state.element ?? null,
      rect: shown?.phase === "running" && shown.waymark.status === "found" ? shown.waymark.rect : null,
      padding: attachment?.padding ?? 0,
      ui: attachment?.ui() ?? NO_UI,
    };
  };

  const onClick = (event: MouseEvent) => {
    if (machine === undefined) return;
    send({
      kind: "click",
      stepGeneration: machine.state.stepGeneration,
      hit: whereClicked(event, inputContext()),
      now: performance.now(),
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyAction(event, inputContext());
    if (action !== undefined) send({ kind: "act", action });
  };

  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      // A fired frame has closed itself; `reconcile` opens the next if still wanted.
      frame = undefined;
      if (machine === undefined) change(lookAtBeacons);
      else sendRead();
    });
    return () => cancelAnimationFrame(id);
  };

  const openWaymarkEvents = (to: WaymarkEvents) =>
    listenToWaymarkEvents(to, () =>
      send({ kind: "event", stepGeneration: to.stepGeneration, now: performance.now() }),
    );

  function reconcile() {
    const live = machine === undefined ? NOTHING_LIVE : liveWatchers(machine.state);
    const beacons =
      attachments.length > 0 &&
      collapsedNow().some(([walkthrough, saved]) => hasWaymark(stepAt(walkthrough, saved.step)));
    input = syncWatcher(input, live.input || undefined, () => openInput(onClick, onKeyDown));
    frame = syncWatcher(frame, live.frame || beacons || undefined, openFrame);
    waymarkAria = syncWatcher(waymarkAria, live.waymarkAria, openWaymarkAria, sameWaymarkAria);
    waymarkEvents = syncWatcher(waymarkEvents, live.waymarkEvents, openWaymarkEvents, sameWaymarkEvents);
  }

  const setAttached = (attached: boolean) => {
    obey({ kind: attached ? "attached" : "detached" });
    // Nobody looked while detached, so that time does not count towards missing or lost.
    if (!attached) {
      looked = undefined;
      for (const [id, sighting] of sightings) sightings.set(id, { ...sighting, unseenSince: undefined });
    }
  };

  const countAttached = (by: 1 | -1) => {
    const where = root();
    const page = where instanceof Document ? where : where.ownerDocument;
    const count = (attachedRuns.get(page) ?? 0) + by;
    attachedRuns.set(page, count);
    if (by === 1 && count > 1 && inDevelopment()) {
      console.warn(
        "Two Waymark Runs are attached to one page, and each will draw its walkthroughs over the other's. Make one Run per user, drawn by one renderer.",
      );
    }
  };

  const attach = (ui: () => UiElements, { waymarkPadding = 0 }: AttachOptions = {}) => {
    const attachment: Attachment = { ui, padding: waymarkPadding };
    const detach = () => {
      const at = attachments.indexOf(attachment);
      if (at === -1) return;
      attachments.splice(at, 1);
      if (attachments.length > 0) return;
      countAttached(-1);
      change(() => setAttached(false));
    };
    attachments.push(attachment);
    if (attachments.length > 1) return detach;
    countAttached(1);
    try {
      change(() => setAttached(true));
    } catch (error) {
      // The caller gets no detach to call, so nothing may stay attached.
      detach();
      throw error;
    }
    return detach;
  };

  // Checklists reaching the Run

  const viewOf = (definition: ChecklistDefinition<AnyTask>): View<AnyTask> => {
    const known = views.get(definition);
    if (known !== undefined) return known;
    const view = createView(
      definition.name,
      definition.tasks,
      sourceFor(definition, seen),
      sourceFor(definition, () => server),
    );
    views.set(definition, view);
    return view;
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    if (groups.has(group)) return;
    const walkthroughs = group.tasks.flatMap((task) => (task.walkthrough === undefined ? [] : [take(task.walkthrough)]));
    groups.add(group);
    for (const task of group.tasks) {
      if (taskById.has(task.id)) continue;
      taskById.set(task.id, task);
      tasks.push(task);
    }
    for (const definition of group.checklists) viewOf(definition);
    // Silent: a checklist reaching the Run must not announce what the user did before.
    if (storageStatus !== "loading") {
      change(
        () => {
          for (const walkthrough of walkthroughs) arrive(walkthrough);
          conditions();
        },
        { silent: true, persist: !storedUnread },
      );
    }
  };

  const checklistOf = (definition: ChecklistDefinition<AnyTask>): Checklist<AnyTask> => {
    const known = checklists.get(definition);
    if (known !== undefined) return known;
    const view = viewOf(definition);
    const { name, group } = definition;
    const command = (work: (id: string) => void) => (id: string) => {
      join(group);
      later(() => change(() => work(id)));
    };
    const made: Checklist<AnyTask> = {
      getSnapshot: () => view.snapshot,
      getServerSnapshot: () => view.serverSnapshot,
      subscribe: (listener) => {
        join(group);
        return listen(queue, view.listeners, () => view.snapshot)(listener);
      },
      start: (id) => {
        join(group);
        const walkthrough = taskById.get(id)?.walkthrough;
        if (walkthrough === undefined) return;
        const taken = take(walkthrough);
        later(() =>
          change(() => {
            arrive(taken);
            begin(taken);
            startedFrom.set(taken.id, name);
          }),
        );
      },
      markDone: command((id) => {
        if (taskById.has(id)) statuses.set(id, "done");
      }),
      markTodo: command((id) => markTodo(id, name)),
      skip: command((id) => skip(id, name)),
      toggle: command((id) => toggle(id, name)),
    };
    checklists.set(definition, made);
    return made;
  };

  const checklist = <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>): Checklist<TTask> =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
    checklistOf(definition) as Checklist<TTask>;

  // Loading

  const load = (read: Parsed<Read> | "failed") => {
    change(
      () => {
        if (read !== "failed" && read.ok) {
          progress = read.value?.walkthroughs ?? NO_PROGRESS;
          statuses.replace(read.value?.tasks ?? EMPTY);
          for (const id of Object.keys(progress)) restored.add(id);
          storageStatus = "ready";
          return;
        }
        if (read !== "failed") problems.push(recordUnreadable(read.error));
        storedUnread = true;
        storageStatus = "error";
      },
      // Restoring saves nothing: storage already holds it.
      { silent: true, persist: false },
    );
    change(
      () => {
        for (const walkthrough of definitions.values()) arrive(walkthrough);
        conditions();
      },
      { silent: true, persist: !storedUnread },
    );
  };

  /** Statuses changed elsewhere. The open walkthrough keeps its place, and the next save wins. */
  const hear = (value: unknown) => {
    const parsed = parseRecord(value);
    if (!parsed.ok) {
      report(recordUnreadable(parsed.error));
      return;
    }
    change(() => statuses.replace(parsed.value?.tasks ?? EMPTY), { silent: true, persist: false });
  };

  const loaded = (read: Parsed<Read> | "failed") => {
    try {
      load(read);
      for (const command of held.splice(0)) command();
    } finally {
      adapter?.subscribe?.(hear);
    }
  };

  if (options.initial !== undefined) loaded(parseRecord(options.initial));
  snapshot = build(snapshot);
  /** What a server render shows: it cannot see the browser's storage. */
  const server: Seen = seen();
  const serverSnapshot = snapshot;
  if (adapter !== undefined && options.initial === undefined) {
    loadFrom(
      adapter,
      (value) => loaded(parseRecord(value)),
      (error) => {
        try {
          report(storageFailed(error));
        } finally {
          loaded("failed");
        }
      },
    );
  }

  return {
    start: (walkthrough) => {
      const taken = take(walkthrough);
      later(() =>
        change(() => {
          arrive(taken);
          begin(taken);
        }),
      );
    },
    requestStart: (walkthrough) => {
      const taken = take(walkthrough);
      let withdrawn = false;
      later(() => {
        if (withdrawn) return;
        change(() => {
          arrive(taken);
          request(taken);
        });
      });
      return () => {
        withdrawn = true;
        const at = waiting.indexOf(taken);
        if (at !== -1) waiting.splice(at, 1);
      };
    },
    act: (action, walkthrough) => {
      const given = walkthrough === undefined ? undefined : take(walkthrough);
      later(() => {
        const target = given ?? machine?.walkthrough;
        if (target !== undefined) change(() => actOn(target, action));
      });
    },
    reset: (walkthrough) => {
      const taken = take(walkthrough);
      later(() => change(() => resetOne(taken)));
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: listen(queue, listeners, () => snapshot),
    attach,
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (storageStatus !== "loading") change(conditions, { persist: !storedUnread });
    },
    checklist,
    skipTask: (id) => later(() => change(() => skip(id, undefined))),
  };
}
