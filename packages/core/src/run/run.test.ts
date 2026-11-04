import { describe, expect, it, vi } from "vitest";
import { addFarTarget, addTarget, addToBody } from "../test/dom";
import { skipFirstCall } from "../test/listeners";
import { progressOf, watch } from "../test/run";
import { fakeFrames } from "../test/time";
import { everyProblem } from "../problems";
import { createRun } from "./run";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Step } from "../walkthrough/types";
import { actions, type RunOptions } from "./types";

const clickAt = (node: Element, x: number, y: number) =>
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, detail: 1, clientX: x, clientY: y }),
  );

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

const tourOf = (steps: readonly Step[]) => defineWalkthrough({ id: "tour", steps });

/** A new Run with a walkthrough of `steps`, id "tour", started on it. */
const started = (steps: readonly Step[], options: RunOptions = {}) => {
  const run = createRun(options);
  run.start(tourOf(steps));
  return run;
};

/** A record that has the tour open at `step`, as an earlier page left it. */
const openAt = (step: number, stepCount: number): RunOptions => ({
  initial: {
    version: 1,
    walkthroughs: { tour: { status: "running", step, stepCount, collapsed: false, changedAt: Date.now() } },
    tasks: {},
  },
});

/** Moves a target, so the next look sees a change. */
const nudge = (target: Element) => {
  const box = target.getBoundingClientRect();
  target.getBoundingClientRect = () => new DOMRect(box.x + 1, box.y, box.width, box.height);
};

describe("createRun", () => {
  it("watches the page only while attached", () => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const run = started([{ waymark: "save" }]);

    expect(run.getSnapshot().open?.snapshot).toMatchObject({ waymark: { status: "searching" } });
    expect(frames.size).toBe(0);

    const view = watch(run);
    expect(view.snapshot.waymark).toEqual({
      status: "found",
      rect: expect.objectContaining({ top: 20, width: 100 }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    });
    expect(target).toHaveAttribute("aria-haspopup", "dialog");
    expect(frames.size).toBe(1);

    view.stop();
    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
  });

  it("adds no listeners, frames or aria for a subscriber alone", () => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const listen = vi.spyOn(window, "addEventListener");
    const events: string[] = [];
    const run = started([{ waymark: "save" }, {}], { onEvent: (event) => events.push(event.type) });

    run.subscribe(() => {});
    press("ArrowRight");
    clickAt(document.body, 400, 400);

    expect(listen).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
    expect(events).toEqual([]);
  });

  it("calls a subscriber at once with the current Snapshot, then with each new one", () => {
    fakeFrames();
    const run = started([{}, {}]);
    const listener = vi.fn();
    run.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());

    run.act("advance");
    expect(listener).toHaveBeenLastCalledWith(run.getSnapshot());
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 1 });
  });

  it("calls a subscriber added from inside a listener before subscribe returns", () => {
    fakeFrames();
    const run = started([{}, {}]);
    const inner = vi.fn();
    let calledBeforeReturn = false;
    run.subscribe(skipFirstCall(() => {
      run.subscribe(inner);
      calledBeforeReturn = inner.mock.calls.length === 1;
    }));

    run.act("advance");
    expect(calledBeforeReturn).toBe(true);
    expect(inner).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());
  });

  it("does not notify on a look that changes nothing a renderer shows", () => {
    const { flush } = fakeFrames();
    addTarget("save");
    let ready = false;
    const run = started([{ waymark: "save", advance: { state: () => ready, delayMs: 50 } }, {}]);
    watch(run);
    const listener = vi.fn();
    run.subscribe(listener);
    listener.mockClear();

    flush(); // the waymark has not moved
    ready = true;
    flush(); // the delay starts
    expect(listener).not.toHaveBeenCalled();

    flush(50);
    expect(listener).toHaveBeenCalledOnce();
  });

  it.each(["detach", "exit", "advance", "collapse"])("restores authored ARIA attributes on %s", (cleanup) => {
    fakeFrames();
    const target = addTarget("save");
    target.setAttribute("aria-haspopup", "menu");
    target.setAttribute("aria-expanded", "false");
    const run = started([{ waymark: "save" }, {}]);
    const view = watch(run);
    expect(target).toHaveAttribute("aria-haspopup", "dialog");
    expect(target).toHaveAttribute("aria-expanded", "true");

    if (cleanup === "detach") view.stop();
    else run.act(cleanup === "exit" ? "exit" : cleanup === "collapse" ? "collapse" : "advance");

    expect(target).toHaveAttribute("aria-haspopup", "menu");
    expect(target).toHaveAttribute("aria-expanded", "false");
  });

  it("marks only the open step's waymark, and marks it again on resume", () => {
    fakeFrames();
    const target = addTarget("save");
    target.setAttribute("aria-expanded", "");
    const tour = tourOf([{ waymark: "save" }]);
    const run = createRun();
    run.start(tour);
    watch(run);

    run.act("collapse");
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(target).toHaveAttribute("aria-expanded", "");
    run.act("resume", tour);
    expect(target).toHaveAttribute("aria-haspopup", "dialog");
    expect(target).toHaveAttribute("aria-expanded", "true");
  });

  it("updates ARIA independently of advance-event listeners", () => {
    fakeFrames();
    const target = addTarget("save");
    const listen = vi.spyOn(target, "addEventListener");
    const run = started([{ waymark: "save", advance: { event: "change", then: "unlock" } }]);
    const view = watch(run);
    const signal = (listen.mock.calls[0]![2] as AddEventListenerOptions).signal!;
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
    const { flush } = fakeFrames();
    const target = addTarget("save");
    const listen = vi.spyOn(target, "addEventListener");
    const run = started([{ waymark: "save", advance: { event: "change" } }, {}]);
    const view = watch(run);
    const signal = (listen.mock.calls[0]![2] as AddEventListenerOptions).signal!;
    let once = true;
    run.subscribe(skipFirstCall(() => {
      if (!once) return;
      once = false;
      run.act("reset");
      target.dispatchEvent(new Event("change"));
    }));

    nudge(target);
    flush();
    expect(view.snapshot.stepIndex).toBe(0);
    expect(signal.aborted).toBe(true);

    flush();
    expect(listen).toHaveBeenCalledTimes(2);
    target.dispatchEvent(new Event("change"));
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("leaves a collapsed walkthrough's waymark unmarked, and finds it for its beacon", () => {
    const { flush } = fakeFrames();
    const run = started([{ waymark: "save" }]);
    watch(run);
    run.act("collapse");
    const target = addTarget("save");

    flush();

    expect(run.getSnapshot().beacons).toMatchObject([{ waymark: { status: "found" } }]);
    expect(target).not.toHaveAttribute("aria-expanded");
  });

  it("searches for a waymark until it first appears, and reports it lost once it leaves", () => {
    const { flush, flushLost } = fakeFrames();
    const view = watch(started([{ waymark: "save" }]));
    flush();
    expect(view.snapshot.waymark).toEqual({ status: "searching" });

    const target = addTarget("save");
    flush();
    expect(view.snapshot.waymark.status).toBe("found");

    target.remove();
    flushLost();
    expect(view.snapshot.waymark).toEqual({ status: "lost" });
  });

  it("waits for a waymark after half a second of searching, with its gate shut and nothing reported", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    const view = watch(
      started([{ waymark: "save", advance: "click" }, {}], { onEvent: (event) => events.push(event.type) }),
    );
    flush(499);
    expect(view.snapshot).toMatchObject({ waymark: { status: "searching" }, canAdvance: false });

    flush(1);
    expect(view.snapshot).toMatchObject({ waymark: { status: "waiting" }, canAdvance: false });
    expect(events).toEqual(["start"]);

    addTarget("save");
    flush();
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: false });
  });

  it("calls a waymark missing after three seconds of searching, and lets the user past its gate", () => {
    const { flush } = fakeFrames();
    const view = watch(started([{ waymark: "save", advance: "click" }, {}]));
    flush(500);
    flush(2499);
    expect(view.snapshot).toMatchObject({ waymark: { status: "waiting" }, canAdvance: false });

    flush(1);
    expect(view.snapshot).toMatchObject({ waymark: { status: "missing" }, canAdvance: true });

    press("ArrowRight");
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("waits as long as its step's missingAfterMs before calling a waymark missing", () => {
    const { flush } = fakeFrames();
    const view = watch(started([{ waymark: "save", missingAfterMs: 6000 }]));
    flush(5999);
    expect(view.snapshot.waymark.status).toBe("waiting");

    flush(1);
    expect(view.snapshot.waymark.status).toBe("missing");
  });

  it("opens the gate once a waymark has been gone for 200ms, and shuts it again when it returns", () => {
    const { flush } = fakeFrames();
    const target = addTarget("save");
    const view = watch(started([{ waymark: "save", advance: "click" }, {}]));
    expect(view.snapshot.canAdvance).toBe(false);

    target.remove();
    flush();
    flush(199);
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: false });

    flush(1);
    expect(view.snapshot).toMatchObject({ waymark: { status: "lost" }, canAdvance: true });

    addTarget("save");
    flush();
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: false });
  });

  it("tells problemHandlers once when a waymark goes missing, and each time it is lost", () => {
    const { flush, flushLost } = fakeFrames();
    const events: string[] = [];
    watch(
      started([{ waymark: "save" }], {
        problemHandlers: everyProblem((problem) => events.push(problem.type)),
        onEvent: (event) => events.push(event.type),
      }),
    );
    flush(3000);
    flush();
    expect(events).toEqual(["start", "waymarkMissing"]);

    const target = addTarget("save");
    flush();
    target.remove();
    flushLost();
    document.body.append(target);
    flush();
    target.remove();
    flushLost();
    expect(events).toEqual(["start", "waymarkMissing", "waymarkLost", "waymarkLost"]);
  });

  it("names the walkthrough and the step a waymark went missing on", () => {
    const { flush } = fakeFrames();
    const onProblem = vi.fn();
    watch(started([{ waymark: "save" }], { problemHandlers: everyProblem(onProblem) }));
    flush(3000);
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "waymarkMissing",
      walkthrough: "tour",
      step: { waymark: "save" },
      stepIndex: 0,
    });
  });

  it("reports a waymark going missing before an advance in the same frame", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    watch(
      started([{ waymark: "save", advance: { state: () => performance.now() >= 4000 } }, {}], {
        problemHandlers: everyProblem((problem) => events.push(problem.type)),
        onEvent: (event) => events.push(event.type),
      }),
    );
    flush(3000);
    expect(events).toEqual(["start", "waymarkMissing", "advance"]);
  });

  it("keeps checking a state condition while its waymark is missing", () => {
    const { flush } = fakeFrames();
    let ready = false;
    const view = watch(started([{ waymark: "save", advance: { state: () => ready } }, {}]));
    flush(3000);
    expect(view.snapshot.waymark.status).toBe("missing");

    ready = true;
    flush();
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("keeps a met condition's unlock when its waymark is lost and comes back", () => {
    const { flush, flushLost } = fakeFrames();
    addTarget("save");
    const view = watch(started([{ waymark: "save", advance: { state: () => true, then: "unlock" } }, {}]));
    flush();
    expect(view.snapshot.canAdvance).toBe(true);

    document.querySelector('[data-waymark="save"]')?.remove();
    flushLost();
    expect(view.snapshot.waymark.status).toBe("lost");

    addTarget("save");
    flush();
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: true });
  });

  it("keeps a waymark found, in its last place, while a re-render swaps its element", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    const target = addTarget("save");
    const view = watch(started([{ waymark: "save", advance: "click" }, {}], { onEvent: (event) => events.push(event.type) }));
    const found = view.snapshot.waymark;

    target.remove();
    flush();
    flush(100);
    expect(view.snapshot).toMatchObject({ waymark: found, canAdvance: false });

    addTarget("save");
    flush(100);
    flush(100);
    expect(view.snapshot).toMatchObject({ waymark: found, canAdvance: false });
    expect(events).toEqual(["start"]);
  });

  it("does not count time it was detached towards a waymark going missing", () => {
    const { flush } = fakeFrames();
    const run = started([{ waymark: "save" }]);
    watch(run).stop();
    flush(5000);

    const view = watch(run);
    flush();
    expect(view.snapshot.waymark.status).toBe("searching");
  });

  it("treats a waymark hidden with display: none as gone, not found at 0,0", () => {
    const { flushLost } = fakeFrames();
    const target = addTarget("save");
    const view = watch(started([{ waymark: "save" }]));
    expect(view.snapshot.waymark.status).toBe("found");

    target.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    flushLost();
    expect(view.snapshot.waymark).toEqual({ status: "lost" });
  });

  it.each(["moved outside root", "renamed"])("replaces a cached target that was %s", (change) => {
    const { flush, flushLost } = fakeFrames();
    const root = addToBody(document.createElement("section"));
    const target = addTarget("save");
    root.append(target);
    const view = watch(started([{ waymark: "save" }], { root }));

    if (change === "moved outside root") document.body.append(target);
    else target.dataset["waymark"] = "other";
    flushLost();

    expect(view.snapshot.waymark.status).toBe("lost");
    expect(target).not.toHaveAttribute("aria-haspopup");

    const replacement = addTarget("save", { x: 40, left: 40 });
    root.append(replacement);
    flush();

    expect(view.snapshot.waymark).toMatchObject({ status: "found", rect: { x: 40 } });
    expect(replacement).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("reuses a valid cached target without searching the root again", () => {
    const { flush } = fakeFrames();
    const root = addToBody(document.createElement("section"));
    root.append(addTarget("save"));
    const query = vi.spyOn(root, "querySelector");
    const view = watch(started([{ waymark: "save" }], { root }));

    flush();
    flush();

    expect(query).toHaveBeenCalledTimes(1);
    expect(view.snapshot.waymark.status).toBe("found");
  });

  it.each([["once", 1], ["always", 3], ["never", 0]] as const)(
    "scrolls to an off-screen waymark %s",
    (scroll, times) => {
      const { flush } = fakeFrames();
      const far = addFarTarget("far");
      watch(started([{ waymark: "far", scroll }]));

      flush();
      flush();

      expect(far.scroll).toHaveBeenCalledTimes(times);
    },
  );

  it("scrolls to each step's off-screen waymark, not only the first step's", () => {
    const { flush } = fakeFrames();
    const first = addFarTarget("first");
    const second = addFarTarget("second");
    const run = started([{ waymark: "first" }, { waymark: "second" }]);
    watch(run);

    run.act("advance");
    flush();

    expect(first.scroll).toHaveBeenCalledOnce();
    expect(second.scroll).toHaveBeenCalledOnce();
  });

  it("scrolls to a waymark found on the look that starts its step's delay", () => {
    const { flush } = fakeFrames();
    const view = watch(started([{ waymark: "far", advance: { state: (element) => element !== null, delayMs: 50 } }, {}]));
    const far = addFarTarget("far");

    flush();

    expect(view.snapshot.stepIndex).toBe(0);
    expect(far.scroll).toHaveBeenCalledOnce();
  });

  it("does not scroll to a waymark whose step it has just left", () => {
    const { flush } = fakeFrames();
    const view = watch(started([{ waymark: "far", advance: { state: (element) => element !== null } }, {}]));
    const far = addFarTarget("far");

    flush();

    expect(view.snapshot.stepIndex).toBe(1);
    expect(far.scroll).not.toHaveBeenCalled();
  });

  it("has no waymark to look for on a step without one", () => {
    fakeFrames();
    const view = watch(started([{}]));

    expect(view.snapshot.waymark).toEqual({ status: "absent" });
    expect(view.snapshot.canAdvance).toBe(true);
  });

  it("asks for frames only on steps the next look could change", () => {
    const { frames, flush } = fakeFrames();
    const run = started([{}, { waymark: "save" }, {}]);
    watch(run);
    expect(frames.size).toBe(0);

    run.act("advance");
    expect(frames.size).toBe(1);
    flush();
    expect(frames.size).toBe(1);

    run.act("advance");
    expect(frames.size).toBe(0);
  });

  it("keeps the gate shut until an event opens it, and stays put", () => {
    fakeFrames();
    const target = addTarget("name");
    const view = watch(started([{ waymark: "name", advance: { event: "change", then: "unlock" } }, {}]));

    expect(view.snapshot.canAdvance).toBe(false);

    target.dispatchEvent(new Event("change"));

    expect(view.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
  });

  it("will not be moved past a shut gate, by command or by key", () => {
    fakeFrames();
    addTarget("save");
    const run = started([{ waymark: "save", advance: "click" }, {}]);
    const view = watch(run);

    run.act("advance");
    press("ArrowRight");

    expect(view.snapshot).toMatchObject({ stepIndex: 0, canAdvance: false });
  });

  it("does not take a click on the waymark for the event its step waits for", () => {
    fakeFrames();
    const target = addTarget("name");
    const view = watch(started([{ waymark: "name", advance: { event: "change" } }, {}]));

    clickAt(target, 50, 40);
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });

    target.dispatchEvent(new Event("change"));
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("needs a click on each step that waits for one", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const publish = addTarget("publish", { x: 200, left: 200, right: 300 });
    const view = watch(started([
      { waymark: "save", advance: "click" },
      { waymark: "publish", advance: "click" },
      {},
    ]));

    clickAt(save, 50, 40);
    flush();
    expect(view.snapshot.stepIndex).toBe(1);

    clickAt(publish, 250, 40);
    expect(view.snapshot.stepIndex).toBe(2);
  });

  it("checks a step without a waymark without querying the DOM", () => {
    const { flush } = fakeFrames();
    const root = document.createElement("section");
    const query = vi.spyOn(root, "querySelector");
    const check = vi.fn(() => true);
    const view = watch(started([{ advance: { state: check } }, {}], { root }));

    flush();

    expect(check).toHaveBeenCalledWith(null);
    expect(query).not.toHaveBeenCalled();
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("keeps measuring the waymark after its advance check has unlocked", () => {
    const { flush } = fakeFrames();
    const target = addTarget("ready");
    const measure = vi.spyOn(target, "getBoundingClientRect");
    const check = vi.fn(() => true);
    const view = watch(started([{ waymark: "ready", advance: { state: check, then: "unlock" } }]));

    flush();
    expect(view.snapshot.canAdvance).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    measure.mockClear();
    flush();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("checks the element it measured on the same look, and notifies once", () => {
    const { flush } = fakeFrames();
    const check = vi.fn((element: Element | null) => element !== null);
    const run = started([{ waymark: "later", advance: { state: check } }, {}]);
    watch(run);
    const seen: unknown[] = [];
    run.subscribe(skipFirstCall(() => seen.push(run.getSnapshot().open?.snapshot)));
    const target = addTarget("later");

    flush();

    expect(check).toHaveBeenCalledWith(target);
    expect(seen).toMatchObject([
      { stepIndex: 1, canAdvance: true, waymark: { status: "absent" } },
    ]);
  });

  it("rejects an advance result when the check itself resets the step", () => {
    const { flush } = fakeFrames();
    const check = vi.fn(() => true);
    const run = started([{ advance: { state: check } }, {}]);
    const view = watch(run);
    check.mockImplementationOnce(() => {
      run.act("reset");
      return true;
    });

    flush();
    expect(view.snapshot.stepIndex).toBe(0);
    flush();
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("checks a satisfied event's delay without needing a state predicate", () => {
    const { flush } = fakeFrames();
    const target = addTarget("ready");
    const view = watch(started([{ waymark: "ready", advance: { event: "change", delayMs: 50 } }, {}]));
    target.dispatchEvent(new Event("change"));
    target.remove();
    flush(49);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(1);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("advances by itself when the condition says so, after its delay", () => {
    const { flush } = fakeFrames();
    addTarget("ready");
    let ready = false;
    const view = watch(started([{ waymark: "ready", advance: { state: () => ready, delayMs: 50 } }, {}]));

    flush();
    expect(view.snapshot.stepIndex).toBe(0);

    ready = true;
    flush();
    expect(view.snapshot.stepIndex).toBe(0); // the delay has not run out

    flush(60);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("starts the delay again if the condition stops holding before it is due", () => {
    const { flush } = fakeFrames();
    let ready = true;
    const view = watch(started([{ advance: { state: () => ready, delayMs: 50 } }, {}]));

    flush(); // holding
    ready = false;
    flush(20);
    ready = true;
    flush(20); // holding again, from here
    flush(40);
    expect(view.snapshot.stepIndex).toBe(0);

    flush(10);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("times each step's delay from its own condition, not the step before's", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const view = watch(started([
      { waymark: "save", advance: { click: true, delayMs: 50 } },
      { advance: { state: () => true, delayMs: 50 } },
      {},
    ]));

    clickAt(save, 50, 40);
    flush(50);
    expect(view.snapshot.stepIndex).toBe(1);

    flush(); // step 1's condition holds from here
    flush(49);
    expect(view.snapshot.stepIndex).toBe(1);
    flush(1);
    expect(view.snapshot.stepIndex).toBe(2);
  });

  it("restarts a state check's delay after a spell detached", () => {
    const { flush } = fakeFrames();
    const run = started([{ advance: { state: () => true, delayMs: 50 } }, {}]);
    let view = watch(run);
    flush(); // holding
    view.stop();

    flush(100); // no one watched it hold
    view = watch(run);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(50);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("keeps a click's delay through a spell detached", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const run = started([{ waymark: "save", advance: { click: true, delayMs: 50 } }, {}]);
    let view = watch(run);
    clickAt(save, 50, 40);
    view.stop();

    flush(100); // the click still happened
    view = watch(run);
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("counts a click in the halo around a waymark as a click on it", () => {
    fakeFrames();
    addTarget("save");
    const view = watch(started([{ waymark: "save", advance: "click" }, {}]), { waymarkPadding: 20 });

    clickAt(document.body, 135, 70); // outside the rect, inside the halo
    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("takes the newest attachment's elements and padding, and watches the page until the last detaches", () => {
    fakeFrames();
    addTarget("save");
    const older = addToBody(document.createElement("div"));
    const newer = addToBody(document.createElement("div"));
    const run = started([{ waymark: "save", advance: "click" }, {}, {}]);
    const first = watch(run, { ui: () => ({ dialog: older }) });
    const second = watch(run, { ui: () => ({ dialog: newer }), waymarkPadding: 20 });

    clickAt(newer, 400, 400);
    expect(progressOf(run)).toMatchObject({ step: 0, collapsed: false });
    clickAt(document.body, 135, 70); // in the newer attachment's padding
    expect(progressOf(run)).toMatchObject({ step: 1, collapsed: false });

    first.stop();
    press("ArrowRight");
    expect(progressOf(run)?.step).toBe(2);
    second.stop();
    press("ArrowLeft");
    expect(progressOf(run)?.step).toBe(2);
  });

  it("collapses on a click away, but not on a click on the walkthrough's own UI", () => {
    fakeFrames();
    addTarget("panel");
    const dialog = addToBody(document.createElement("div"));
    const run = started([{ waymark: "panel" }]);
    watch(run, { ui: () => ({ dialog }) });

    clickAt(dialog, 400, 400);
    expect(progressOf(run)?.collapsed).toBe(false);

    clickAt(document.body, 400, 400);
    expect(progressOf(run)?.collapsed).toBe(true);
    expect(run.getSnapshot().open).toBeNull();
  });

  it.each(["dialog", "marked"])("gives %s UI precedence over the target and its padding", (kind) => {
    fakeFrames();
    const target = addTarget("save");
    const button = document.createElement("button");
    if (kind === "marked") {
      button.dataset["waymarkUi"] = "";
      target.append(button);
    } else addToBody(button);
    const run = started([{ waymark: "save", advance: "click" }, {}]);
    const view = watch(run, { waymarkPadding: 20, ui: () => ({ dialog: kind === "dialog" ? button : null }) });

    clickAt(button, 135, 70);

    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
  });

  it("ignores keyboard click coordinates but accepts keyboard activation of the target", () => {
    fakeFrames();
    const target = addTarget("save", { x: 0, y: 0, top: 0, left: 0 });
    const away = addToBody(document.createElement("button"));
    const tour = tourOf([{ waymark: "save", advance: "click" }, {}]);
    const run = createRun();
    run.start(tour);
    watch(run);

    away.click(); // Keyboard/programmatic activation has detail 0 and coordinates 0,0.
    expect(progressOf(run)).toMatchObject({ step: 0, collapsed: true });
    run.act("resume", tour);
    target.click();
    expect(progressOf(run)?.step).toBe(1);
  });

  it.each(["altKey", "ctrlKey", "metaKey", "defaultPrevented"])("leaves %s key events alone", (kind) => {
    fakeFrames();
    const run = started([{}, {}]);
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
  });

  it.each(["Escape", "ArrowRight", "ArrowLeft", "Tab"])("leaves %s from other Waymark UI to that UI", (key) => {
    fakeFrames();
    const dialog = document.createElement("div");
    dialog.append(document.createElement("button"));
    const other = document.createElement("button");
    other.dataset["waymarkUi"] = "";
    addToBody(dialog);
    addToBody(other);
    const run = started([{}, {}]);
    const view = watch(run, { ui: () => ({ dialog }) });
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

    other.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
  });

  it("takes keys from marked content inside its own dialog", () => {
    fakeFrames();
    const dialog = document.createElement("div");
    const marked = document.createElement("button");
    marked.dataset["waymarkUi"] = "";
    dialog.append(marked);
    addToBody(dialog);
    const run = started([{}, {}]);
    const view = watch(run, { ui: () => ({ dialog }) });

    marked.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(view.snapshot.stepIndex).toBe(1);
  });

  it("takes the arrow keys and Escape", () => {
    fakeFrames();
    const run = started([{}, {}]);
    const view = watch(run);

    press("ArrowRight");
    expect(view.snapshot.stepIndex).toBe(1);

    press("ArrowLeft");
    expect(view.snapshot.stepIndex).toBe(0);

    press("Escape");
    expect(progressOf(run)?.collapsed).toBe(true);

    press("ArrowRight"); // a collapsed walkthrough ignores the keyboard
    expect(progressOf(run)?.step).toBe(0);
  });

  it("announces what it did, what it did it to, and to which walkthrough", () => {
    fakeFrames();
    const events: string[] = [];
    const run = started([{ waymark: "a" }, { waymark: "b" }], {
      onEvent: (event) => {
        if ("stepIndex" in event) events.push(`${event.walkthrough}:${event.type}@${event.stepIndex}:${event.snapshot.phase}`);
      },
    });
    watch(run);

    run.act("advance");
    run.act("advance");
    run.act("exit");

    expect(events).toEqual([
      "tour:start@0:running",
      "tour:advance@0:running",
      "tour:advance@1:completed",
      "tour:finish@1:completed",
    ]);
  });

  it("stops watching the page as soon as it ends", () => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const run = started([{ waymark: "save" }]);
    watch(run);

    run.act("exit");

    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(run.getSnapshot().open).toBeNull();
    expect(progressOf(run)).toMatchObject({ status: "exited", step: 0, stepCount: 1 });
  });

  it("takes only resume, reset and exit for a walkthrough that is not open", () => {
    const events: string[] = [];
    const tour = tourOf([{}, {}]);
    const run = createRun({ ...openAt(1, 2), onEvent: (event) => events.push(event.type) });
    run.start(tour);
    run.act("exit");
    const ended = run.getSnapshot();

    for (const action of actions) if (action !== "reset" && action !== "resume") run.act(action, tour);
    expect(run.getSnapshot()).toBe(ended);

    run.act("resume", tour);
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ phase: "running", stepIndex: 0 });
    run.act("collapse");
    run.act("reset", tour);
    expect(progressOf(run)).toBeUndefined();
    expect(events).toEqual(["exit", "collapse"]);
  });

  it("has already found the waymark by the time it announces the start", () => {
    fakeFrames();
    addTarget("save");
    const seen: unknown[] = [];
    const run = started([{ waymark: "save" }], {
      onEvent: (event) => {
        if ("walkthrough" in event) seen.push(event.snapshot);
      },
    });

    watch(run);

    expect(seen).toEqual([
      expect.objectContaining({
        waymark: { status: "found", rect: expect.objectContaining({ top: 20 }) }, // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      }),
    ]);
  });

  it("finishes announcing a change before obeying an act it caused", () => {
    fakeFrames();
    const events: string[] = [];
    const tour = tourOf([{}]);
    const run = createRun({
      onEvent: (event) => {
        if (!("walkthrough" in event)) return;
        events.push(`${event.type}:${event.snapshot.phase}`);
        if (event.type === "advance") run.start(tour);
      },
    });
    run.start(tour);
    watch(run);

    run.act("advance");

    // Without the queue, the start would land between advance and finish, and
    // finish would carry the running snapshot the start produced.
    expect(events).toEqual([
      "start:running",
      "advance:completed",
      "finish:completed",
      "start:running",
    ]);
    expect(run.getSnapshot().open?.snapshot.phase).toBe("running");
  });

  it("lets every listener see a change before a listener's act moves it on", () => {
    fakeFrames();
    const run = started([{}, {}, {}]);
    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];
    const stepIndex = () => run.getSnapshot().open!.snapshot.stepIndex;
    run.subscribe(skipFirstCall(() => {
      seenByFirst.push(stepIndex());
      if (stepIndex() === 1) run.act("advance");
    }));
    run.subscribe(skipFirstCall(() => seenBySecond.push(stepIndex())));

    run.act("advance");

    expect(seenByFirst).toEqual([1, 2]);
    expect(seenBySecond).toEqual([1, 2]);
  });

  it("ignores a condition met on a step the walkthrough has since left", () => {
    const { flush } = fakeFrames();
    const target = addTarget("save");
    const run = createRun(openAt(1, 2));
    run.start(tourOf([{ waymark: "save", advance: "click" }, { waymark: "save", advance: "click" }]));
    const view = watch(run);
    let once = true;
    run.subscribe(skipFirstCall(() => {
      if (!once) return;
      once = false;
      // Both join the queue behind this notification, in this order.
      run.act("previous");
      clickAt(target, 50, 40);
    }));

    nudge(target);
    flush();

    // The click was raised on step 1; by the time it runs, step 0 is current.
    // Unguarded, it would satisfy step 0's click and move the walkthrough back to 1.
    expect(view.snapshot.stepIndex).toBe(0);
    expect(view.snapshot.canAdvance).toBe(false);
  });

  it("keeps going when a listener throws, and reports the error after", () => {
    const { frames } = fakeFrames();
    const events: string[] = [];
    const tour = tourOf([{}]);
    const run = createRun({ onEvent: (event) => events.push(event.type) });
    run.start(tour);
    watch(run);
    const seen: (string | undefined)[] = [];
    const broken = run.subscribe(skipFirstCall(() => {
      throw new Error("renderer broke");
    }));
    run.subscribe(skipFirstCall(() => seen.push(progressOf(run)?.status)));

    expect(() => run.act("advance")).toThrow("renderer broke");

    expect(seen).toEqual(["finished"]);
    expect(events).toEqual(["start", "advance", "finish"]);
    expect(frames.size).toBe(0);
    // The queue is clear: the Run still answers.
    broken();
    run.start(tour);
    expect(run.getSnapshot().open?.snapshot.phase).toBe("running");
  });

  it("gathers several callback errors into one", () => {
    fakeFrames();
    const run = started([{}]);
    watch(run);
    run.subscribe(skipFirstCall(() => {
      throw new Error("one");
    }));
    run.subscribe(skipFirstCall(() => {
      throw new Error("two");
    }));

    expect(() => run.act("exit")).toThrow(AggregateError);
  });

  it("announces start before checking an immediately satisfied condition", () => {
    const { frames, flush } = fakeFrames();
    const events: string[] = [];
    const check = vi.fn(() => true);
    const run = started([{ advance: { state: check } }], {
      onEvent: (event) => {
        if ("walkthrough" in event) events.push(`${event.type}:${event.snapshot.phase}`);
      },
    });
    watch(run);

    expect(events).toEqual(["start:running"]);
    expect(check).not.toHaveBeenCalled();
    flush();
    expect(events).toEqual(["start:running", "advance:completed", "finish:completed"]);
    expect(frames.size).toBe(0);
  });

  it("announces start before anything a subscriber does on seeing the walkthrough open", () => {
    const { frames } = fakeFrames();
    addTarget("save");
    const events: string[] = [];
    const run = createRun({ onEvent: (event) => events.push(event.type) });
    watch(run);
    run.subscribe(() => {
      if (run.getSnapshot().open !== null) run.act("exit");
    });

    run.start(tourOf([{ waymark: "save" }]));

    expect(events).toEqual(["start", "exit"]);
    expect(progressOf(run)?.status).toBe("exited");
    expect(frames.size).toBe(0);
  });

  it("finishes the start handler before running its actions", () => {
    const { frames } = fakeFrames();
    const seen: string[] = [];
    const run = started([{}], {
      onEvent: (event) => {
        seen.push(event.type);
        if (event.type === "start") {
          run.act("exit");
          seen.push(progressOf(run)?.status ?? "none");
        }
      },
    });
    watch(run);

    expect(seen).toEqual(["start", "running", "exit"]);
    expect(progressOf(run)?.status).toBe("exited");
    expect(frames.size).toBe(0);
  });

  it("continues observing and restarts the condition delay after a state check throws", () => {
    const { frames, flush } = fakeFrames();
    const failure = new Error("state check failed");
    const check = vi.fn(() => true);
    const view = watch(started([{ advance: { state: check, delayMs: 50 } }, {}]));

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
  });

  it("throws each distinct state check error once per step, not on every frame", () => {
    const { frames, flush } = fakeFrames();
    let failure: unknown = new TypeError("el is null");
    const check = vi.fn((): boolean => { throw failure; });
    const run = started([{ advance: { state: check } }, {}]);
    watch(run);

    expect(() => flush()).toThrow("el is null");
    expect(() => flush()).not.toThrow();
    expect(check).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);

    failure = new RangeError("bad index");
    expect(() => flush()).toThrow("bad index");
    failure = new TypeError("el is null");
    expect(() => flush()).not.toThrow();
    failure = "not an Error";
    expect(() => flush()).toThrow("not an Error");

    run.act("reset");
    failure = new TypeError("el is null");
    expect(() => flush()).toThrow("el is null");
  });

  it("reports both check and subscriber errors after scheduling the next frame", () => {
    const { frames, flush } = fakeFrames();
    const checkError = new Error("check failed");
    const subscriberError = new Error("subscriber failed");
    const check = vi.fn(() => false);
    const run = started([{ waymark: "later", advance: { state: check } }, {}]);
    const view = watch(run);
    const stopBroken = run.subscribe(skipFirstCall(() => { throw subscriberError; }));
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
  });

  it("continues observing after a frame subscriber throws", () => {
    const { frames, flush, flushLost } = fakeFrames();
    const run = started([{ waymark: "later" }]);
    const view = watch(run);
    const stopBroken = run.subscribe(skipFirstCall(() => { throw new Error("renderer"); }));
    const target = addTarget("later");

    expect(() => flush()).toThrow("renderer");
    stopBroken();
    expect(frames.size).toBe(1);
    target.remove();
    flushLost();
    expect(view.snapshot.waymark.status).toBe("lost");
    view.stop();
    expect(frames.size).toBe(0);
  });

  it("drops a subscriber whose first call throws", () => {
    fakeFrames();
    const run = started([{}, {}]);
    const broken = vi.fn(() => {
      throw new Error("startup failed");
    });
    expect(() => run.subscribe(broken)).toThrow("startup failed");

    run.act("advance");
    expect(broken).toHaveBeenCalledOnce();
  });

  it("stays detached when the start handler throws as it attaches", () => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const run = started([{ waymark: "save" }], {
      onEvent: (event) => {
        if (event.type === "start") throw new Error("startup failed");
      },
    });

    expect(() => run.attach(() => ({ dialog: null }))).toThrow("startup failed");
    expect(frames.size).toBe(0);
    expect(target).not.toHaveAttribute("aria-haspopup");
    press("Escape");
    expect(progressOf(run)?.collapsed).toBe(false);
    watch(run);
    press("Escape");
    expect(progressOf(run)?.collapsed).toBe(true);
  });

  it("hands an app callback's error to problemHandlers in place of throwing it, and carries on", () => {
    const { flush } = fakeFrames();
    const broken = new Error("broken");
    const onProblem = vi.fn();
    const run = started([{ advance: { state: () => { throw broken; } } }], {
      problemHandlers: everyProblem(onProblem),
      onEvent: () => { throw broken; },
    });
    watch(run);
    run.subscribe(skipFirstCall(() => { throw broken; }));

    expect(() => flush()).not.toThrow();
    expect(() => run.act("exit")).not.toThrow();
    expect(progressOf(run)?.status).toBe("exited");
    const threw = (callback: string) => [{ type: "callbackThrew", callback, error: broken }];
    expect(onProblem.mock.calls).toEqual([
      threw("onEvent"),
      threw("stateCheck"),
      threw("subscriber"),
      threw("onEvent"),
    ]);
  });

  it("sends a state check's error once per step to problemHandlers too", () => {
    const { flush } = fakeFrames();
    const onProblem = vi.fn();
    const run = started([{ advance: { state: () => { throw new Error("broken"); } } }, {}], {
      problemHandlers: everyProblem(onProblem),
    });
    watch(run);
    flush();
    flush();
    flush();
    expect(onProblem).toHaveBeenCalledOnce();
  });

  it("throws what a handler itself throws, without handing it back", () => {
    fakeFrames();
    const callbackThrew = vi.fn(() => {
      throw new Error("handler broke");
    });
    const run = started([{}], { problemHandlers: { callbackThrew } });
    watch(run);
    run.subscribe(skipFirstCall(() => { throw new Error("renderer broke"); }));

    expect(() => run.act("advance")).toThrow("handler broke");
    expect(callbackThrew).toHaveBeenCalledOnce();
  });

  it("leaves a problem with no handler of its own to Waymark's default", () => {
    fakeFrames();
    const broken = new Error("broken");
    const run = started([{}], {
      problemHandlers: { waymarkMissing: () => {} },
      onEvent: () => {
        throw broken;
      },
    });
    expect(() => run.attach(() => ({ dialog: null }))).toThrow(broken);
  });

  it("rejects a walkthrough that cannot be run", () => {
    expect(() => defineWalkthrough({ id: "tour", steps: [] })).toThrow(/at least one step/);
    expect(() =>
      defineWalkthrough({ id: "tour", steps: [{ waymark: "a", selector: ".a" } as never] }),
    ).toThrow(/one waymark/);
  });
});
