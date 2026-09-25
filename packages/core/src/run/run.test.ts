import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./run";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { RunEvent, Running } from "./types";
import type { Step } from "../walkthrough/types";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let clock: number;

const flush = (ms = 16) => {
  clock += ms;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(clock);
};

const addTarget = (waymark: string, rect: Partial<DOMRect> = {}) => {
  const element = document.createElement("button");
  element.dataset.waymark = waymark;
  const box = {
    x: 20,
    y: 20,
    top: 20,
    left: 20,
    right: 120,
    bottom: 60,
    width: 100,
    height: 40,
    ...rect,
  } as DOMRect;
  element.getBoundingClientRect = () => box;
  document.body.append(element);
  return element;
};

const clickAt = (node: Element, x: number, y: number) =>
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, detail: 1, clientX: x, clientY: y }),
  );

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

/** Subscribes so the Run starts watching, and reports the latest snapshot. */
const watch = <TStep extends Step>(run: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => unknown;
}) => {
  const stop = run.subscribe(() => {});
  return {
    stop,
    get snapshot() {
      return run.getSnapshot() as Running<TStep>;
    },
  };
};

beforeEach(() => {
  document.body.innerHTML = "";
  frames = new Map();
  nextFrame = 1;
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("createRun", () => {
  it("watches the page only while someone is subscribed", () => {
    const target = addTarget("save");
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));

    expect(run.getSnapshot()).toMatchObject({ waymark: { status: "searching" } });
    expect(frames.size).toBe(0);

    const view = watch(run);
    expect(view.snapshot.waymark).toEqual({
      status: "found",
      rect: expect.objectContaining({ top: 20, width: 100 }),
    });
    expect(target).toHaveAttribute("aria-haspopup", "dialog");
    expect(frames.size).toBe(1);

    view.stop();
    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
  });

  it("hands subscribers each new Snapshot", () => {
    const run = createRun(defineWalkthrough([{}, {}]));
    const listener = vi.fn();
    run.subscribe(listener);
    listener.mockClear();

    run.act("advance");
    expect(listener).toHaveBeenCalledWith(run.getSnapshot());
    expect(listener.mock.lastCall![0]).toMatchObject({ stepIndex: 1 });
  });

  it.each(["unsubscribe", "exit", "advance"])("restores authored ARIA attributes on %s", (cleanup) => {
    const target = addTarget("save");
    target.setAttribute("aria-haspopup", "menu");
    target.setAttribute("aria-expanded", "false");
    const run = createRun(defineWalkthrough([{ waymark: "save" }, {}]));
    const view = watch(run);
    expect(target).toHaveAttribute("aria-haspopup", "dialog");
    expect(target).toHaveAttribute("aria-expanded", "true");

    if (cleanup === "unsubscribe") view.stop();
    else run.act(cleanup === "exit" ? "exit" : "advance");

    expect(target).toHaveAttribute("aria-haspopup", "menu");
    expect(target).toHaveAttribute("aria-expanded", "false");
    view.stop();
  });

  it("updates expanded state on collapse and resume without losing original values", () => {
    const target = addTarget("save");
    target.setAttribute("aria-expanded", "");
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));
    const view = watch(run);

    run.act("collapse");
    expect(target).toHaveAttribute("aria-expanded", "false");
    run.act("resume");
    expect(target).toHaveAttribute("aria-expanded", "true");
    view.stop();

    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(target).toHaveAttribute("aria-expanded", "");
  });

  it("updates ARIA independently of advance-event listeners", () => {
    const target = addTarget("save");
    const listen = vi.spyOn(target, "addEventListener");
    const run = createRun(defineWalkthrough([
      { waymark: "save", advance: { event: "change", then: "unlock" } },
    ]));
    const view = watch(run);
    const signal = (listen.mock.calls[0]![2] as AddEventListenerOptions).signal!;

    run.act("collapse");
    expect(target).toHaveAttribute("aria-expanded", "false");
    run.act("resume");
    flush();
    expect(target).toHaveAttribute("aria-expanded", "true");
    expect(listen).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);

    const setAttribute = vi.spyOn(target, "setAttribute");
    const removeAttribute = vi.spyOn(target, "removeAttribute");
    target.dispatchEvent(new Event("change"));

    expect(view.snapshot.canAdvance).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("aria-expanded", "true");
    view.stop();
    expect(target).not.toHaveAttribute("aria-haspopup");
  });

  it("replaces event listeners on reset and rejects events queued for the old step visit", () => {
    const target = addTarget("save");
    const listen = vi.spyOn(target, "addEventListener");
    const run = createRun(defineWalkthrough([
      { waymark: "save", advance: { event: "change" } }, {},
    ]));
    const view = watch(run);
    const signal = (listen.mock.calls[0]![2] as AddEventListenerOptions).signal!;
    let once = true;
    const stop = run.subscribe(() => {
      if (!once) return;
      once = false;
      run.act("reset");
      target.dispatchEvent(new Event("change"));
    });

    run.act("collapse");
    expect(view.snapshot.stepIndex).toBe(0);
    expect(signal.aborted).toBe(true);

    flush();
    expect(listen).toHaveBeenCalledTimes(2);
    target.dispatchEvent(new Event("change"));
    expect(view.snapshot.stepIndex).toBe(1);
    stop();
    view.stop();
  });

  it("attaches a newly found target as collapsed when the run is collapsed", () => {
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));
    const view = watch(run);
    run.act("collapse");
    const target = addTarget("save");

    flush();

    expect(target).toHaveAttribute("aria-expanded", "false");
    view.stop();
    expect(target).not.toHaveAttribute("aria-expanded");
  });

  it("reports a waymark as lost once it leaves the page", () => {
    const target = addTarget("save");
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }])));

    target.remove();
    flush();

    expect(view.snapshot.waymark).toEqual({ status: "lost" });
  });

  it.each(["moved outside root", "renamed"])("replaces a cached target that was %s", (change) => {
    const root = document.createElement("section");
    document.body.append(root);
    const target = addTarget("save");
    root.append(target);
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }]), { root }));

    if (change === "moved outside root") document.body.append(target);
    else target.dataset.waymark = "other";
    flush();

    expect(view.snapshot.waymark.status).toBe("lost");
    expect(target).not.toHaveAttribute("aria-haspopup");

    const replacement = addTarget("save", { x: 40, left: 40 });
    root.append(replacement);
    flush();

    expect(view.snapshot.waymark).toMatchObject({ status: "found", rect: { x: 40 } });
    expect(replacement).toHaveAttribute("aria-haspopup", "dialog");
    view.stop();
  });

  it("reuses a valid cached target without searching the root again", () => {
    const root = document.createElement("section");
    document.body.append(root);
    root.append(addTarget("save"));
    const query = vi.spyOn(root, "querySelector");
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }]), { root }));

    flush();
    flush();

    expect(query).toHaveBeenCalledTimes(1);
    expect(view.snapshot.waymark.status).toBe("found");
    view.stop();
  });

  it("has no waymark to look for on a step without one", () => {
    const view = watch(createRun(defineWalkthrough([{}])));

    expect(view.snapshot.waymark).toEqual({ status: "absent" });
    expect(view.snapshot.canAdvance).toBe(true);
  });

  it("asks for frames only on steps the next look could change", () => {
    const run = createRun(defineWalkthrough([{}, { waymark: "save" }, {}]));
    const view = watch(run);
    expect(frames.size).toBe(0);

    run.act("advance");
    expect(frames.size).toBe(1);
    flush();
    expect(frames.size).toBe(1);

    run.act("advance");
    expect(frames.size).toBe(0);
    view.stop();
  });

  it("keeps the gate shut until an event opens it, and stays put", () => {
    const target = addTarget("name");
    const view = watch(
      createRun(
        defineWalkthrough([
          { waymark: "name", advance: { event: "change", then: "unlock" } },
          {},
        ]),
      ),
    );

    expect(view.snapshot.canAdvance).toBe(false);

    target.dispatchEvent(new Event("change"));

    expect(view.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
  });

  it("checks a step without a waymark without querying the DOM", () => {
    const root = document.createElement("section");
    const query = vi.spyOn(root, "querySelector");
    const check = vi.fn(() => true);
    const view = watch(createRun(defineWalkthrough([{ advance: { state: check } }, {}]), { root }));

    flush();

    expect(check).toHaveBeenCalledWith(null);
    expect(query).not.toHaveBeenCalled();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("keeps measuring the waymark after its advance check has unlocked", () => {
    const target = addTarget("ready");
    const measure = vi.spyOn(target, "getBoundingClientRect");
    const check = vi.fn(() => true);
    const view = watch(createRun(defineWalkthrough([
      { waymark: "ready", advance: { state: check, then: "unlock" } },
    ])));

    flush();
    expect(view.snapshot.canAdvance).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    measure.mockClear();
    flush();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    view.stop();
  });

  it("checks the element it measured on the same look, and notifies once", () => {
    const check = vi.fn((element: Element | null) => element !== null);
    const run = createRun(defineWalkthrough([
      { waymark: "later", advance: { state: check } }, {},
    ]));
    const view = watch(run);
    const seen: unknown[] = [];
    const stop = run.subscribe(() => seen.push(run.getSnapshot()));
    const target = addTarget("later");

    flush();

    expect(check).toHaveBeenCalledWith(target);
    expect(seen).toMatchObject([
      { stepIndex: 1, canAdvance: true, waymark: { status: "absent" } },
    ]);
    stop();
    view.stop();
  });

  it("rejects an advance result when the check itself resets the step", () => {
    const check = vi.fn(() => true);
    const run = createRun(defineWalkthrough([{ advance: { state: check } }, {}]));
    const view = watch(run);
    check.mockImplementationOnce(() => {
      run.act("reset");
      return true;
    });

    flush();
    expect(view.snapshot.stepIndex).toBe(0);
    flush();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("checks a satisfied event's delay without needing a state predicate", () => {
    const target = addTarget("ready");
    const view = watch(createRun(defineWalkthrough([
      { waymark: "ready", advance: { event: "change", delayMs: 50 } }, {},
    ])));
    target.dispatchEvent(new Event("change"));
    target.remove();
    flush(49);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(1);
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("advances by itself when the condition says so, after its delay", () => {
    addTarget("ready");
    let ready = false;
    const view = watch(
      createRun(
        defineWalkthrough([
          {
            waymark: "ready",
            advance: { state: () => ready, delayMs: 50 },
          },
          {},
        ]),
      ),
    );

    flush();
    expect(view.snapshot.stepIndex).toBe(0);

    ready = true;
    flush();
    expect(view.snapshot.stepIndex).toBe(0); // the delay has not run out

    flush(60);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("counts a click in the halo around a waymark as a click on it", () => {
    addTarget("save");
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]), {
        waymarkPadding: 20,
      }),
    );

    clickAt(document.body, 135, 70); // outside the rect, inside the halo
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("collapses on a click away, but not on a click on the walkthrough's own UI", () => {
    addTarget("panel");
    const dialog = document.createElement("div");
    document.body.append(dialog);
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "panel" }]), {
        ui: () => ({ dialog, beacon: null }),
      }),
    );

    clickAt(dialog, 400, 400);
    expect(view.snapshot.collapsed).toBe(false);

    clickAt(document.body, 400, 400);
    expect(view.snapshot.collapsed).toBe(true);
  });

  it.each(["dialog", "beacon", "marked"])("gives %s UI precedence over the target and its padding", (kind) => {
    const target = addTarget("save");
    const button = document.createElement("button");
    if (kind === "marked") {
      button.dataset.waymarkUi = "";
      target.append(button);
    } else document.body.append(button);
    const run = createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]), {
      waymarkPadding: 20,
      ui: () => ({
        dialog: kind === "dialog" ? button : null,
        beacon: kind === "beacon" ? button : null,
      }),
    });
    const view = watch(run);

    clickAt(button, 135, 70);

    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
    view.stop();
  });

  it("ignores keyboard click coordinates but accepts keyboard activation of the target", () => {
    const target = addTarget("save", { x: 0, y: 0, top: 0, left: 0 });
    const away = document.createElement("button");
    document.body.append(away);
    const run = createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]));
    const view = watch(run);

    away.click(); // Keyboard/programmatic activation has detail 0 and coordinates 0,0.
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: true });
    run.act("resume");
    target.click();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it.each(["altKey", "ctrlKey", "metaKey", "defaultPrevented"])("leaves %s key events alone", (kind) => {
    const run = createRun(defineWalkthrough([{}, {}]));
    const view = watch(run);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
      ...(kind === "defaultPrevented" ? {} : { [kind]: true }),
    });
    if (kind === "defaultPrevented") event.preventDefault();

    window.dispatchEvent(event);

    expect(view.snapshot.stepIndex).toBe(0);
    expect(event.defaultPrevented).toBe(kind === "defaultPrevented");
    press("ArrowRight");
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("takes the arrow keys and Escape", () => {
    const view = watch(createRun(defineWalkthrough([{}, {}])));

    press("ArrowRight");
    expect(view.snapshot.stepIndex).toBe(1);

    press("ArrowLeft");
    expect(view.snapshot.stepIndex).toBe(0);

    press("Escape");
    expect(view.snapshot.collapsed).toBe(true);

    press("ArrowRight"); // a collapsed run ignores the keyboard
    expect(view.snapshot.stepIndex).toBe(0);
  });

  it("announces what it did, and what it did it to", () => {
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{ waymark: "a" }, { waymark: "b" }]), {
      onEvent: (event: RunEvent) =>
        events.push(`${event.type}@${event.stepIndex}:${event.snapshot.phase}`),
    });
    watch(run);

    run.act("advance");
    run.act("advance");
    run.act("exit");

    expect(events).toEqual([
      "start@0:running",
      "advance@0:running",
      "advance@1:completed",
      "finish@1:completed",
    ]);
  });

  it("stops watching the page as soon as it ends", () => {
    const target = addTarget("save");
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));
    watch(run);

    run.act("exit");

    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(run.getSnapshot()).toEqual({
      phase: "exited",
      stepIndex: 0,
      stepCount: 1,
    });
  });

  it("has already found the waymark by the time it announces the start", () => {
    addTarget("save");
    const seen: unknown[] = [];
    const run = createRun(defineWalkthrough([{ waymark: "save" }]), {
      onEvent: (event: RunEvent) => seen.push(event.snapshot),
    });

    watch(run);

    expect(seen).toEqual([
      expect.objectContaining({
        waymark: { status: "found", rect: expect.objectContaining({ top: 20 }) },
      }),
    ]);
  });

  it("finishes announcing a change before obeying an act it caused", () => {
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{}]), {
      onEvent: (event: RunEvent) => {
        events.push(`${event.type}:${event.snapshot.phase}`);
        if (event.type === "advance") run.act("reset");
      },
    });
    watch(run);

    run.act("advance");

    // Without the queue, reset would land between advance and finish, and
    // finish would carry the running snapshot the reset produced.
    expect(events).toEqual([
      "start:running",
      "advance:completed",
      "finish:completed",
      "reset:running",
    ]);
    expect(run.getSnapshot().phase).toBe("running");
  });

  it("lets every listener see a change before a listener's act moves it on", () => {
    const run = createRun(defineWalkthrough([{}, {}, {}]));
    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];
    run.subscribe(() => {
      seenByFirst.push(run.getSnapshot().stepIndex);
      if (run.getSnapshot().stepIndex === 1) run.act("advance");
    });
    run.subscribe(() => seenBySecond.push(run.getSnapshot().stepIndex));

    run.act("advance");

    expect(seenByFirst).toEqual([1, 2]);
    expect(seenBySecond).toEqual([1, 2]);
  });

  it("ignores a condition met on a step the run has since left", () => {
    const target = addTarget("save");
    const run = createRun(
      defineWalkthrough([
        { waymark: "save", advance: "click" },
        { waymark: "save", advance: "click" },
      ]),
      { startAt: 1 },
    );
    const view = watch(run);
    let once = true;
    run.subscribe(() => {
      if (!once) return;
      once = false;
      // Both join the queue behind this notification, in this order.
      run.act("previous");
      clickAt(target, 50, 40);
    });

    run.act("collapse");

    // The click was raised on step 1; by the time it runs, step 0 is current.
    // Unguarded, it would satisfy step 0's click and move the run back to 1.
    expect(view.snapshot.stepIndex).toBe(0);
    expect(view.snapshot.canAdvance).toBe(false);
  });

  it("keeps going when a listener throws, and reports the error after", () => {
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{}]), {
      onEvent: (event: RunEvent) => events.push(event.type),
    });
    watch(run);
    const seen: string[] = [];
    const broken = run.subscribe(() => {
      throw new Error("renderer broke");
    });
    run.subscribe(() => seen.push(run.getSnapshot().phase));

    expect(() => run.act("advance")).toThrow("renderer broke");

    expect(seen).toEqual(["completed"]);
    expect(events).toEqual(["start", "advance", "finish"]);
    expect(frames.size).toBe(0);
    // The queue is clear: the run still answers.
    broken();
    run.act("reset");
    expect(run.getSnapshot().phase).toBe("running");
  });

  it("gathers several callback errors into one", () => {
    const run = createRun(defineWalkthrough([{}]));
    watch(run);
    run.subscribe(() => {
      throw new Error("one");
    });
    run.subscribe(() => {
      throw new Error("two");
    });

    expect(() => run.act("exit")).toThrow(AggregateError);
  });

  it("announces start before checking an immediately satisfied condition", () => {
    const events: string[] = [];
    const check = vi.fn(() => true);
    const run = createRun(
      defineWalkthrough([{ advance: { state: check } }]),
      { onEvent: (event) => events.push(`${event.type}:${event.snapshot.phase}`) },
    );
    watch(run);

    expect(events).toEqual(["start:running"]);
    expect(check).not.toHaveBeenCalled();
    flush();
    expect(events).toEqual(["start:running", "advance:completed", "finish:completed"]);
    expect(frames.size).toBe(0);
  });

  it("announces start before actions caused by the initial waymark notification", () => {
    addTarget("save");
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{ waymark: "save" }]), {
      onEvent: event => events.push(event.type),
    });
    const stop = run.subscribe(() => {
      if (run.getSnapshot().phase === "running") run.act("exit");
    });

    expect(events).toEqual(["start", "exit"]);
    expect(run.getSnapshot().phase).toBe("exited");
    expect(frames.size).toBe(0);
    stop();
  });

  it("finishes the start handler before running its actions", () => {
    const seen: string[] = [];
    const run = createRun(defineWalkthrough([{}]), {
      onEvent: (event) => {
        seen.push(event.type);
        if (event.type === "start") {
          run.act("exit");
          seen.push(run.getSnapshot().phase);
        }
      },
    });
    watch(run);

    expect(seen).toEqual(["start", "running", "exit"]);
    expect(run.getSnapshot().phase).toBe("exited");
    expect(frames.size).toBe(0);
  });

  it("continues observing and restarts the condition delay after a state check throws", () => {
    const failure = new Error("state check failed");
    const check = vi.fn(() => true);
    const run = createRun(defineWalkthrough([
      { advance: { state: check, delayMs: 50 } }, {},
    ]));
    const view = watch(run);

    flush();
    check.mockImplementationOnce(() => { throw failure; });
    expect(() => flush(25)).toThrow(failure);
    expect(frames.size).toBe(1);
    expect(view.snapshot.stepIndex).toBe(0);

    flush(25);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(49);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(1);
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("reports both check and subscriber errors after scheduling the next frame", () => {
    const checkError = new Error("check failed");
    const subscriberError = new Error("subscriber failed");
    const check = vi.fn(() => false);
    const run = createRun(defineWalkthrough([
      { waymark: "later", advance: { state: check } }, {},
    ]));
    const view = watch(run);
    const stopBroken = run.subscribe(() => { throw subscriberError; });
    addTarget("later");
    check.mockImplementationOnce(() => { throw checkError; });

    let reported: unknown;
    try { flush(); } catch (error) { reported = error; }

    expect(reported).toBeInstanceOf(AggregateError);
    expect((reported as AggregateError).errors).toEqual([checkError, subscriberError]);
    expect(frames.size).toBe(1);
    stopBroken();
    check.mockReturnValue(true);
    flush();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("continues observing after a frame subscriber throws", () => {
    const run = createRun(defineWalkthrough([{ waymark: "later" }]));
    const view = watch(run);
    const stopBroken = run.subscribe(() => { throw new Error("renderer"); });
    const target = addTarget("later");

    expect(() => flush()).toThrow("renderer");
    stopBroken();
    expect(frames.size).toBe(1);
    target.remove();
    flush();
    expect(view.snapshot.waymark.status).toBe("lost");
    view.stop();
    expect(frames.size).toBe(0);
  });

  it.each(["subscriber", "start handler"])("cleans up when the initial %s throws", (source) => {
    const target = addTarget("save");
    const fail = () => { throw new Error("startup failed"); };
    const run = createRun(defineWalkthrough([{ waymark: "save" }]), {
      onEvent: (event) => { if (source === "start handler" && event.type === "start") fail(); },
    });

    expect(() => run.subscribe(source === "subscriber" ? fail : () => {}))
      .toThrow("startup failed");
    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
    press("Escape");
    expect(run.getSnapshot()).toMatchObject({ collapsed: false });
    const view = watch(run);
    run.act("collapse");
    expect(view.snapshot.collapsed).toBe(true);
    view.stop();
  });

  it("rejects a walkthrough that cannot be run", () => {
    expect(() => defineWalkthrough([])).toThrow(/at least one step/);
    expect(() =>
      defineWalkthrough([{ waymark: "a", selector: ".a" }]),
    ).toThrow(/one waymark/);
  });
});
