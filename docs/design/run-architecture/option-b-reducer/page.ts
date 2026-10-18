// Sketch: packages/core/src/run/page.ts (~240 lines implemented)
// The shell's hands and eyes on the page: attachments, the watchers the state
// wants, the frame loop, measuring, and the step's check. The check is the
// app's code, so it runs here, between changes, and what it found goes into
// the core as a message. This module holds no Run state: it reads the model
// and asks for changes.

import { inDevelopment } from "../dev";
import type { CallbackName } from "../problems";
import { checkOf, selectorOf } from "../walkthrough/walkthrough";
import { keyAction, whereClicked } from "./input";
import type { InputContext } from "./input";
import { needsAdvanceRead, sameWaymarkAria, sameWaymarkEvents } from "./rules";
import type { AdvanceRead, LiveWatchers, Message, StepRead, WaymarkAria, WaymarkEvents, WaymarkRead } from "./rules";
import type { Command, Model } from "./model";
import { beaconTargets } from "./select";
import type { AttachOptions, Rect, UiElements } from "./types";

export type Page = Readonly<{
  /** A renderer is attached. Read as each change begins, for its `World`. */
  attached: () => boolean;
  /** As `Run["attach"]`. */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /** Opens and closes watchers until they match. */
  watch: (wanted: LiveWatchers) => void;
  /**
   * Measures the open step and runs its check, then asks for the read and
   * each of `after` as changes of their own. The read carries the step
   * generation from before the check, which may act on the Run.
   */
  look: (after: readonly Message[]) => void;
}>;

export type PageDeps = Readonly<{
  root: () => Document | Element;
  model: () => Model;
  change: (make: () => Command) => void;
  fail: (callback: CallbackName, error: unknown) => void;
}>;

const NO_UI: UiElements = { dialog: null };

/** How many Runs are attached to each page, so a second can be warned of. */
const attachedRuns = new WeakMap<Document, number>();

type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

export function createPage({ root, model, change, fail }: PageDeps): Page {
  const attachments: Attachment[] = [];
  let input: Watcher<true>;
  let frame: Watcher<true>;
  let waymarkAria: Watcher<WaymarkAria>;
  let waymarkEvents: Watcher<WaymarkEvents>;
  // A check that throws would throw every frame; each distinct error once per step is enough to see the bug.
  let thrownStep: number | undefined;
  let thrownErrors = new Set<string>();

  const send = (...messages: Message[]) => {
    for (const message of messages) change(() => ({ kind: "message", message }));
  };

  const firstThrowThisStep = (error: unknown, stepGeneration: number): boolean => {
    // TODO: moved unchanged from run.ts.
    throw new Error("not implemented");
  };

  const measure = (selector: string, cached: Element | null): WaymarkRead => {
    // TODO: moved unchanged from run.ts (reuse a connected cached element under root() that still matches).
    throw new Error("not implemented");
  };

  const look = (after: readonly Message[]) => {
    // TODO: as run.ts `sendRead`:
    // machine = model().state.open; none, or not running -> return (and `after` is not sent).
    // stepGeneration = machine.state.stepGeneration   — stamped before the check runs
    // waymark = selector ? measure(selector, machine.state.element) : undefined
    // advance: if needsAdvanceRead(machine.state):
    //   try holds = checkOf(step)?.(waymark?.element ?? null) === true
    //   catch: firstThrowThisStep(error, stepGeneration) && fail("stateCheck", error)
    //     — reported now; thrown once the read's change drains, so the next frame is still asked for.
    // send(...(waymark || advance ? [{ kind: "stepRead", stepGeneration, stepRead }] : []), ...after)
    throw new Error("not implemented");
  };

  /** Measured inside the change, so it measures the beacons that change sees. */
  const lookAtBeacons = () =>
    change(() => {
      const now = performance.now();
      const reads = new Map<string, WaymarkRead>();
      for (const { id, selector, element } of beaconTargets(model().state)) reads.set(id, measure(selector, element));
      return { kind: "beaconReads", reads, now };
    });

  const inputContext = (): InputContext => {
    // TODO: moved from run.ts, reading model().state.open and attachments.at(-1).
    throw new Error("not implemented");
  };

  const onClick = (event: MouseEvent) => {
    const machine = model().state.open;
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

  const openFrame = () => {
    const id = requestAnimationFrame(() => {
      // A fired frame has closed itself; the next change's `watch` opens another if still wanted.
      frame = undefined;
      if (model().state.open === undefined) lookAtBeacons();
      else look([]);
    });
    return () => cancelAnimationFrame(id);
  };

  const openWaymarkEvents = (to: WaymarkEvents) =>
    listenToWaymarkEvents(to, () => send({ kind: "event", stepGeneration: to.stepGeneration, now: performance.now() }));

  const watch = (wanted: LiveWatchers) => {
    input = syncWatcher(input, wanted.input || undefined, () => openInput(onClick, onKeyDown));
    frame = syncWatcher(frame, wanted.frame || undefined, openFrame);
    waymarkAria = syncWatcher(waymarkAria, wanted.waymarkAria, openWaymarkAria, sameWaymarkAria);
    waymarkEvents = syncWatcher(waymarkEvents, wanted.waymarkEvents, openWaymarkEvents, sameWaymarkEvents);
  };

  const countAttached = (by: 1 | -1) => {
    // TODO: moved unchanged from run.ts; warns through inDevelopment() on a second Run attached to one page.
    throw new Error("not implemented");
  };

  const attach = (ui: () => UiElements, { waymarkPadding = 0 }: AttachOptions = {}) => {
    const attachment: Attachment = { ui, padding: waymarkPadding };
    const detach = () => {
      const at = attachments.indexOf(attachment);
      if (at === -1) return;
      attachments.splice(at, 1);
      if (attachments.length > 0) return;
      countAttached(-1);
      change(() => ({ kind: "attach", attached: false }));
    };
    attachments.push(attachment);
    if (attachments.length > 1) return detach;
    countAttached(1);
    try {
      change(() => ({ kind: "attach", attached: true }));
    } catch (error) {
      // The caller gets no detach to call, so nothing may stay attached.
      detach();
      throw error;
    }
    return detach;
  };

  return { attached: () => attachments.length > 0, attach, watch, look };
}

// Moved unchanged from run.ts.

const inViewport = (rect: Rect): boolean =>
  rect.bottom > 0 && rect.right > 0 && rect.top < globalThis.innerHeight && rect.left < globalThis.innerWidth;

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

declare function openInput(onClick: (event: MouseEvent) => void, onKeyDown: (event: KeyboardEvent) => void): () => void;
declare function openWaymarkAria(to: WaymarkAria): () => void;
declare function listenToWaymarkEvents(to: WaymarkEvents, onEvent: () => void): () => void;
