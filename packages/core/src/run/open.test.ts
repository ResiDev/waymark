import { describe, expect, it, onTestFinished, vi } from "vitest";
import { addTarget } from "../test/dom";
import { progressOf, watch } from "../test/run";
import { fakeFrames } from "../test/time";
import { createRun } from "./run";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Dismiss, Step } from "../walkthrough/types";
import type { Run, WaymarkEvent } from "./types";

const define = (id: string, steps: readonly Step[], dismiss?: Dismiss) =>
  defineWalkthrough({ id, steps, ...(dismiss === undefined ? {} : { dismiss }) });

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

const clickAway = () =>
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 400, clientY: 400 }));

/** Each walkthrough event as `id:type`, an interruption with who interrupted it. */
const recorder = () => {
  const events: string[] = [];
  const onEvent = (event: WaymarkEvent) => {
    if (!("walkthrough" in event)) return;
    events.push(
      event.type === "interrupt"
        ? `${event.walkthrough}:interrupt by ${event.interruptedBy}`
        : `${event.walkthrough}:${event.type}`,
    );
  };
  return { events, onEvent };
};

const openId = (run: Run) => run.getSnapshot().open?.walkthrough.id;

/** A clock for `changedAt`, which says which walkthrough was collapsed last. */
const fakeDate = () => {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return () => {
    now += 1;
  };
};

describe("one Run", () => {
  it("sends start once per walkthrough, the first time it is drawn", () => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}, {}]);
    const run = createRun({ onEvent });

    run.start(tour);
    expect(events).toEqual([]);

    watch(run).stop();
    watch(run);
    run.act("collapse");
    run.start(tour);
    expect(events).toEqual(["tour:start", "tour:collapse", "tour:resume"]);
  });

  it("collapses an open walkthrough that another is started over, keeping its step, and sends interrupt naming the other", () => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}, {}]);
    const hint = define("hint", [{}]);
    const run = createRun({ onEvent });
    watch(run);
    run.start(tour);
    run.act("advance");

    run.start(hint);

    expect(openId(run)).toBe("hint");
    expect(progressOf(run, "tour")).toMatchObject({ status: "running", step: 1, collapsed: true });
    expect(events).toEqual(["tour:start", "tour:advance", "tour:interrupt by hint", "hint:start"]);
  });

  it("exits an open walkthrough whose dismiss is exit when another is started over it, sending interrupt", () => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const hint = define("hint", [{}, {}], "exit");
    const tour = define("tour", [{}]);
    const run = createRun({ onEvent });
    watch(run);
    run.start(hint);

    run.start(tour);

    expect(progressOf(run, "hint")).toMatchObject({ status: "exited" });
    expect(events).toEqual(["hint:start", "hint:interrupt by tour", "tour:start"]);
  });

  it("shows no beacon while a walkthrough is open, then every collapsed one where its waymark is", () => {
    const { flush } = fakeFrames();
    addTarget("a");
    addTarget("b", { x: 200, left: 200, right: 300 });
    const run = createRun();
    watch(run);

    run.start(define("a", [{ waymark: "a" }]));
    run.start(define("b", [{ waymark: "b" }]));
    expect(run.getSnapshot().beacons).toEqual([]);

    run.act("collapse");
    flush();
    expect(run.getSnapshot().beacons).toMatchObject([
      { walkthrough: { id: "a" }, waymark: { status: "found", rect: { left: 20 } } },
      { walkthrough: { id: "b" }, waymark: { status: "found", rect: { left: 200 } } },
    ]);
  });

  it("puts only the walkthrough collapsed most recently at the bottom of the screen when its waymark is not on the page", () => {
    const { flush } = fakeFrames();
    const next = fakeDate();
    const a = define("a", [{ waymark: "a" }]);
    const general = define("general", [{}]);
    const run = createRun();
    watch(run);
    run.start(a);
    run.start(general);
    next();
    run.act("collapse");
    flush(3000);

    expect(run.getSnapshot().beacons).toMatchObject([{ walkthrough: { id: "general" }, waymark: { status: "absent" } }]);

    run.start(a);
    next();
    run.act("collapse");
    flush(3000);
    expect(run.getSnapshot().beacons).toMatchObject([{ walkthrough: { id: "a" }, waymark: { status: "missing" } }]);

    addTarget("a");
    flush();
    expect(run.getSnapshot().beacons).toMatchObject([{ walkthrough: { id: "a" }, waymark: { status: "found" } }]);
  });

  it("makes a request wait while a walkthrough is open, and opens it before the beacons show", () => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}]);
    const whatsNew = define("whatsNew", [{}]);
    const run = createRun({ onEvent });
    watch(run);
    run.start(tour);

    run.requestStart(whatsNew);
    expect(openId(run)).toBe("tour");
    expect(progressOf(run, "whatsNew")).toBeUndefined();

    run.act("collapse");
    expect(openId(run)).toBe("whatsNew");
    expect(run.getSnapshot().beacons).toEqual([]);

    run.act("advance");
    expect(run.getSnapshot().beacons).toMatchObject([{ walkthrough: { id: "tour" } }]);
    expect(events).toEqual(["tour:start", "tour:collapse", "whatsNew:start", "whatsNew:advance", "whatsNew:finish"]);
  });

  it("opens a request at once when nothing is open, even with beacons showing", () => {
    fakeFrames();
    const tour = define("tour", [{}]);
    const run = createRun();
    run.start(tour);
    run.act("collapse");
    expect(run.getSnapshot().beacons).toHaveLength(1);

    run.requestStart(define("whatsNew", [{}]));
    expect(openId(run)).toBe("whatsNew");
    expect(run.getSnapshot().beacons).toEqual([]);
  });

  it.each(["advance", "exit"] as const)("does nothing on a request for a walkthrough the user ended with %s", (action) => {
    const whatsNew = define("whatsNew", [{}]);
    const run = createRun();
    run.start(whatsNew);
    run.act(action);
    const ended = run.getSnapshot();

    run.requestStart(whatsNew);
    expect(run.getSnapshot()).toBe(ended);
  });

  it("leaves a collapsed walkthrough collapsed on a request, as it was", () => {
    const tour = define("tour", [{}]);
    const run = createRun();
    run.start(tour);
    run.act("collapse");

    run.requestStart(tour);
    expect(run.getSnapshot().open).toBeNull();
    expect(progressOf(run)?.collapsed).toBe(true);
  });

  it("starts a walkthrough a handler starts and advances in one go, so its step hears the user", () => {
    const { flush } = fakeFrames();
    const target = addTarget("save");
    const { events, onEvent } = recorder();
    const other = define("other", [{}]);
    const t = define("t", [{}, { waymark: "save", advance: "click" }]);
    const run = createRun({
      onEvent: (event) => {
        onEvent(event);
        if ("walkthrough" in event && event.walkthrough === "other" && event.type === "start") {
          run.start(t);
          run.act("advance", t);
        }
      },
    });
    watch(run);
    run.start(other);
    flush();

    expect(events).toContain("t:start");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 50, clientY: 40 }));
    expect(events.slice(-2)).toEqual(["t:advance", "t:finish"]);
  });

  it("lets a request be withdrawn while it waits", () => {
    const run = createRun();
    run.start(define("tour", [{}]));
    const withdraw = run.requestStart(define("whatsNew", [{}]));

    withdraw();
    run.act("exit");
    expect(run.getSnapshot().open).toBeNull();
  });

  it.each(["advance", "exit"] as const)("starts a walkthrough ended with %s again at step 1", (action) => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}, {}]);
    const run = createRun({ onEvent });
    watch(run);
    run.start(tour);
    run.act("advance");
    run.act(action);

    run.start(tour);
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
    expect(progressOf(run)).toMatchObject({ status: "running", step: 0 });
    expect(events.at(-1)).toBe("tour:start");
  });

  it("keeps at most one walkthrough running and not collapsed", () => {
    fakeFrames();
    const a = define("a", [{}, {}]);
    const b = define("b", [{}, {}], "exit");
    const c = define("c", [{}]);
    const run = createRun();
    watch(run);
    const commands = [
      () => run.start(a),
      () => run.start(b),
      () => run.requestStart(c),
      () => run.act("advance"),
      () => run.start(a),
      () => press("Escape"),
      () => run.start(b),
      () => run.act("resume", a),
      () => run.requestStart(c),
      () => run.act("collapse"),
      () => run.start(c),
      () => run.reset(a),
      () => run.act("resume", a),
    ];
    for (const command of commands) {
      command();
      const open = Object.entries(run.getSnapshot().progress).filter(
        ([, progress]) => progress.status === "running" && !progress.collapsed,
      );
      expect(open.length).toBeLessThanOrEqual(1);
      expect(open[0]?.[0]).toBe(openId(run));
    }
  });

  it("forgets a walkthrough that is not open on reset, and takes an open one back to step 1", () => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}, {}]);
    const hint = define("hint", [{}, {}]);
    const run = createRun({ onEvent });
    run.start(tour);
    run.act("advance");
    run.start(hint);
    run.act("advance");

    run.reset(tour);
    expect(progressOf(run, "tour")).toBeUndefined();
    run.reset(hint);
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
    expect(events.slice(-1)).toEqual(["hint:reset"]);

    run.requestStart(tour);
    run.act("exit");
    expect(openId(run)).toBe("tour");
  });

  it("exits a collapsed walkthrough from its beacon", () => {
    const { events, onEvent } = recorder();
    const tour = define("tour", [{}, {}]);
    const run = createRun({ onEvent });
    run.start(tour);
    run.act("collapse");

    run.act("exit", tour);
    expect(progressOf(run)).toMatchObject({ status: "exited", step: 0 });
    expect(run.getSnapshot().beacons).toEqual([]);
    expect(events).toEqual(["tour:collapse", "tour:exit"]);
  });

  it("throws in development for a different definition under an id already taken, and takes the same one twice", () => {
    const run = createRun();
    const tour = define("tour", [{}]);
    run.start(tour);
    run.start(tour);
    expect(() => run.start(define("tour", [{}]))).toThrow(/two different definitions/);
  });

  it("keeps the first definition of an id in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const run = createRun();
    const first = define("tour", [{}]);
    run.start(first);
    run.act("exit");

    run.start(define("tour", [{}, {}]));
    expect(run.getSnapshot().open?.walkthrough).toBe(first);
  });

  it("warns in development when a second Run attaches to the page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = createRun();
    watch(first);
    watch(first);
    expect(warn).not.toHaveBeenCalled();

    const second = watch(createRun());
    expect(warn).toHaveBeenCalledOnce();
    second.stop();
    watch(createRun());
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("dismiss", () => {
  it.each([
    ["a click away", clickAway],
    ["Escape", () => press("Escape")],
  ])("exits a walkthrough whose dismiss is exit on %s, and records it exited", (_, dismiss) => {
    fakeFrames();
    const { events, onEvent } = recorder();
    const run = createRun({ onEvent });
    watch(run);
    run.start(define("hint", [{}, {}], "exit"));

    dismiss();

    expect(progressOf(run, "hint")).toMatchObject({ status: "exited" });
    expect(run.getSnapshot().beacons).toEqual([]);
    expect(events).toEqual(["hint:start", "hint:exit"]);
  });

  it("still collapses one whose dismiss is exit on an explicit collapse", () => {
    fakeFrames();
    const run = createRun();
    watch(run);
    run.start(define("hint", [{}], "exit"));

    run.act("collapse");
    expect(progressOf(run, "hint")).toMatchObject({ status: "running", collapsed: true });
  });

  it("collapses by default", () => {
    fakeFrames();
    const run = createRun();
    watch(run);
    run.start(define("tour", [{}]));

    clickAway();
    expect(progressOf(run)).toMatchObject({ status: "running", collapsed: true });
  });
});
