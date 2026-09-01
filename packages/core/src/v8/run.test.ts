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
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
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

  it("rejects a tutorial that cannot be run", () => {
    expect(() => defineTutorial([])).toThrow(/at least one step/);
    expect(() =>
      defineTutorial([{ waymark: "a", selector: ".a" }]),
    ).toThrow(/one waymark/);
  });
});
