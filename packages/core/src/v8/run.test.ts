import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./run";
import { defineTutorial } from "./tutorial";
import type { RunEvent, Running, Step } from "./types";

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
    const run = createRun(defineTutorial([{ waymark: "save" }]));

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

  it("reports a waymark as lost once it leaves the page", () => {
    const target = addTarget("save");
    const view = watch(createRun(defineTutorial([{ waymark: "save" }])));

    target.remove();
    flush();

    expect(view.snapshot.waymark).toEqual({ status: "lost" });
  });

  it("has no waymark to look for on a step without one", () => {
    const view = watch(createRun(defineTutorial([{}])));

    expect(view.snapshot.waymark).toEqual({ status: "absent" });
    expect(view.snapshot.canAdvance).toBe(true);
  });

  it("keeps the gate shut until an event opens it, and stays put", () => {
    const target = addTarget("name");
    const view = watch(
      createRun(
        defineTutorial([
          { waymark: "name", advance: { when: { event: "change" }, then: "unlock" } },
          {},
        ]),
      ),
    );

    expect(view.snapshot.canAdvance).toBe(false);

    target.dispatchEvent(new Event("change"));

    expect(view.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
  });

  it("advances by itself when the condition says so, after its delay", () => {
    addTarget("ready");
    let ready = false;
    const view = watch(
      createRun(
        defineTutorial([
          {
            waymark: "ready",
            advance: { when: { state: () => ready }, delayMs: 50 },
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
      createRun(defineTutorial([{ waymark: "save", advance: "click" }, {}]), {
        waymarkPadding: 20,
      }),
    );

    clickAt(document.body, 135, 70); // outside the rect, inside the halo
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("collapses on a click away, but not on a click on the tutorial's own UI", () => {
    addTarget("panel");
    const dialog = document.createElement("div");
    document.body.append(dialog);
    const view = watch(
      createRun(defineTutorial([{ waymark: "panel" }]), {
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
    const run = createRun(defineTutorial([{ waymark: "save", advance: "click" }, {}]), {
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
    const run = createRun(defineTutorial([{ waymark: "save", advance: "click" }, {}]));
    const view = watch(run);

    away.click(); // Keyboard/programmatic activation has detail 0 and coordinates 0,0.
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: true });
    run.act("resume");
    target.click();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it.each(["altKey", "ctrlKey", "metaKey", "defaultPrevented"])("leaves %s key events alone", (kind) => {
    const run = createRun(defineTutorial([{}, {}]));
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
    const view = watch(createRun(defineTutorial([{}, {}])));

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
    const run = createRun(defineTutorial([{ waymark: "a" }, { waymark: "b" }]), {
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
    const run = createRun(defineTutorial([{ waymark: "save" }]));
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
    const run = createRun(defineTutorial([{ waymark: "save" }]), {
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
    const run = createRun(defineTutorial([{}]), {
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
    const run = createRun(defineTutorial([{}, {}, {}]));
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
      defineTutorial([
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
    const run = createRun(defineTutorial([{}]), {
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
    const run = createRun(defineTutorial([{}]));
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
      defineTutorial([{ advance: { when: { state: check } } }]),
      { onEvent: (event) => events.push(`${event.type}:${event.snapshot.phase}`) },
    );
    watch(run);

    expect(events).toEqual(["start:running"]);
    expect(check).not.toHaveBeenCalled();
    flush();
    expect(events).toEqual(["start:running", "advance:completed", "finish:completed"]);
    expect(frames.size).toBe(0);
  });

  it("finishes the start handler before running its actions", () => {
    const seen: string[] = [];
    const run = createRun(defineTutorial([{}]), {
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

  it("continues observing after a frame subscriber throws", () => {
    const run = createRun(defineTutorial([{ waymark: "later" }]));
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
    const run = createRun(defineTutorial([{ waymark: "save" }]), {
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

  it("rejects a tutorial that cannot be run", () => {
    expect(() => defineTutorial([])).toThrow(/at least one step/);
    expect(() =>
      defineTutorial([{ waymark: "a", selector: ".a" }]),
    ).toThrow(/one waymark/);
  });
});
