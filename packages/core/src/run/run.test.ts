import { describe, expect, it, onTestFinished, vi } from "vitest";
import { addFarTarget, addTarget, addToBody } from "../test/dom";
import { fakeFrames } from "../test/time";
import { createRun } from "./run";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import { actions, type RunEvent, type Running } from "./types";

const clickAt = (node: Element, x: number, y: number) =>
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, detail: 1, clientX: x, clientY: y }),
  );

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

/** Subscribes so the Run starts watching, and reports the latest snapshot. */
const watch = (run: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => unknown;
}) => {
  const stop = run.subscribe(() => {});
  onTestFinished(stop);
  return {
    stop,
    get snapshot() {
      return run.getSnapshot() as Running;
    },
  };
};

const skipFirstCall = (listener: () => void) => {
  let called = false;
  return () => {
    if (called) listener();
    called = true;
  };
};

describe("createRun", () => {
  it("watches the page only while someone is subscribed", () => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));

    expect(run.getSnapshot()).toMatchObject({ waymark: { status: "searching" } });
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

  it("calls a subscriber at once with the current Snapshot, then with each new one", () => {
    fakeFrames();
    const run = createRun(defineWalkthrough([{}, {}]));
    const listener = vi.fn();
    run.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());

    run.act("advance");
    expect(listener).toHaveBeenLastCalledWith(run.getSnapshot());
    expect(listener.mock.lastCall![0]).toMatchObject({ stepIndex: 1 });
  });

  it("calls a subscriber added from inside a listener before subscribe returns", () => {
    fakeFrames();
    const run = createRun(defineWalkthrough([{}, {}]));
    const inner = vi.fn();
    let calledBeforeReturn = false;
    run.subscribe(skipFirstCall(() => {
      run.subscribe(inner);
      calledBeforeReturn = inner.mock.calls.length === 1;
    }));

    run.act("advance");
    expect(calledBeforeReturn).toBe(true);
    expect(inner).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());
    expect(inner.mock.lastCall![0]).toMatchObject({ stepIndex: 1 });
  });

  it("does not notify on a look that changes nothing a renderer shows", () => {
    const { flush } = fakeFrames();
    addTarget("save");
    let ready = false;
    const run = createRun(defineWalkthrough([
      { waymark: "save", advance: { state: () => ready, delayMs: 50 } }, {},
    ]));
    const listener = vi.fn();
    const stop = run.subscribe(listener);
    listener.mockClear();

    flush(); // the waymark has not moved
    ready = true;
    flush(); // the delay starts
    expect(listener).not.toHaveBeenCalled();

    flush(50);
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it.each(["unsubscribe", "exit", "advance"])("restores authored ARIA attributes on %s", (cleanup) => {
    fakeFrames();
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
    fakeFrames();
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
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));
    const view = watch(run);
    run.act("collapse");
    const target = addTarget("save");

    flush();

    expect(target).toHaveAttribute("aria-expanded", "false");
    view.stop();
    expect(target).not.toHaveAttribute("aria-expanded");
  });

  it("searches for a waymark until it first appears, and reports it lost once it leaves", () => {
    const { flush, flushLost } = fakeFrames();
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }])));
    flush();
    expect(view.snapshot.waymark).toEqual({ status: "searching" });

    const target = addTarget("save");
    flush();
    expect(view.snapshot.waymark.status).toBe("found");

    target.remove();
    flushLost();
    expect(view.snapshot.waymark).toEqual({ status: "lost" });
    view.stop();
  });

  it("waits for a waymark after half a second of searching, with its gate shut and nothing reported", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]), {
        onEvent: (event) => events.push(event.type),
      }),
    );
    flush(499);
    expect(view.snapshot).toMatchObject({ waymark: { status: "searching" }, canAdvance: false });

    flush(1);
    expect(view.snapshot).toMatchObject({ waymark: { status: "waiting" }, canAdvance: false });
    expect(events).toEqual(["start"]);

    addTarget("save");
    flush();
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: false });
    view.stop();
  });

  it("calls a waymark missing after three seconds of searching, and lets the user past its gate", () => {
    const { flush } = fakeFrames();
    const view = watch(createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}])));
    flush(500);
    flush(2499);
    expect(view.snapshot).toMatchObject({ waymark: { status: "waiting" }, canAdvance: false });

    flush(1);
    expect(view.snapshot).toMatchObject({ waymark: { status: "missing" }, canAdvance: true });

    press("ArrowRight");
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("waits as long as its step's missingAfterMs before calling a waymark missing", () => {
    const { flush } = fakeFrames();
    const view = watch(createRun(defineWalkthrough([{ waymark: "save", missingAfterMs: 6000 }])));
    flush(5999);
    expect(view.snapshot.waymark.status).toBe("waiting");

    flush(1);
    expect(view.snapshot.waymark.status).toBe("missing");
    view.stop();
  });

  it("opens the gate once a waymark has been gone for 200ms, and shuts it again when it returns", () => {
    const { flush } = fakeFrames();
    const target = addTarget("save");
    const view = watch(createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}])));
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
    view.stop();
  });

  it("tells onEvent once when a waymark goes missing, and each time it is lost", () => {
    const { flush, flushLost } = fakeFrames();
    const events: string[] = [];
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save" }]), {
        onEvent: (event) => events.push(event.type),
      }),
    );
    flush(3000);
    flush();
    expect(events).toEqual(["start", "missing"]);

    const target = addTarget("save");
    flush();
    target.remove();
    flushLost();
    document.body.append(target);
    flush();
    target.remove();
    flushLost();
    expect(events).toEqual(["start", "missing", "lost", "lost"]);
    view.stop();
  });

  it("reports a waymark going missing before an advance in the same frame", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: { state: () => performance.now() >= 4000 } }, {}]), {
        onEvent: (event) => events.push(event.type),
      }),
    );
    flush(3000);
    expect(events).toEqual(["start", "missing", "advance"]);
    view.stop();
  });

  it("keeps checking a state condition while its waymark is missing", () => {
    const { flush } = fakeFrames();
    let ready = false;
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: { state: () => ready } }, {}])),
    );
    flush(3000);
    expect(view.snapshot.waymark.status).toBe("missing");

    ready = true;
    flush();
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("keeps a met condition's unlock when its waymark is lost and comes back", () => {
    const { flush, flushLost } = fakeFrames();
    addTarget("save");
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: { state: () => true, then: "unlock" } }, {}])),
    );
    flush();
    expect(view.snapshot.canAdvance).toBe(true);

    document.querySelector('[data-waymark="save"]')?.remove();
    flushLost();
    expect(view.snapshot.waymark.status).toBe("lost");

    addTarget("save");
    flush();
    expect(view.snapshot).toMatchObject({ waymark: { status: "found" }, canAdvance: true });
    view.stop();
  });

  it("keeps a waymark found, in its last place, while a re-render swaps its element", () => {
    const { flush } = fakeFrames();
    const events: string[] = [];
    const target = addTarget("save");
    const view = watch(
      createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]), {
        onEvent: (event) => events.push(event.type),
      }),
    );
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
    view.stop();
  });

  it("does not count time nobody was watching towards a waymark going missing", () => {
    const { flush } = fakeFrames();
    const run = createRun(defineWalkthrough([{ waymark: "save" }]));
    watch(run).stop();
    flush(5000);

    const view = watch(run);
    flush();
    expect(view.snapshot.waymark.status).toBe("searching");
    view.stop();
  });

  it("treats a waymark hidden with display: none as gone, not found at 0,0", () => {
    const { flushLost } = fakeFrames();
    const target = addTarget("save");
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }])));
    expect(view.snapshot.waymark.status).toBe("found");

    target.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    flushLost();
    expect(view.snapshot.waymark).toEqual({ status: "lost" });
    view.stop();
  });

  it.each(["moved outside root", "renamed"])("replaces a cached target that was %s", (change) => {
    const { flush, flushLost } = fakeFrames();
    const root = addToBody(document.createElement("section"));
    const target = addTarget("save");
    root.append(target);
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }]), { root }));

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
    view.stop();
  });

  it("reuses a valid cached target without searching the root again", () => {
    const { flush } = fakeFrames();
    const root = addToBody(document.createElement("section"));
    root.append(addTarget("save"));
    const query = vi.spyOn(root, "querySelector");
    const view = watch(createRun(defineWalkthrough([{ waymark: "save" }]), { root }));

    flush();
    flush();

    expect(query).toHaveBeenCalledTimes(1);
    expect(view.snapshot.waymark.status).toBe("found");
    view.stop();
  });

  it.each([["once", 1], ["always", 3], ["never", 0]] as const)(
    "scrolls to an off-screen waymark %s",
    (scroll, times) => {
      const { flush } = fakeFrames();
      const far = addFarTarget("far");
      const view = watch(createRun(defineWalkthrough([{ waymark: "far", scroll }])));

      flush();
      flush();

      expect(far.scroll).toHaveBeenCalledTimes(times);
      view.stop();
    },
  );

  it("scrolls to each step's off-screen waymark, not only the first step's", () => {
    const { flush } = fakeFrames();
    const first = addFarTarget("first");
    const second = addFarTarget("second");
    const run = createRun(defineWalkthrough([{ waymark: "first" }, { waymark: "second" }]));
    const view = watch(run);

    run.act("advance");
    flush();

    expect(first.scroll).toHaveBeenCalledOnce();
    expect(second.scroll).toHaveBeenCalledOnce();
    view.stop();
  });

  it("scrolls to a waymark found on the look that starts its step's delay", () => {
    const { flush } = fakeFrames();
    const view = watch(createRun(defineWalkthrough([
      { waymark: "far", advance: { state: (element) => element !== null, delayMs: 50 } }, {},
    ])));
    const far = addFarTarget("far");

    flush();

    expect(view.snapshot.stepIndex).toBe(0);
    expect(far.scroll).toHaveBeenCalledOnce();
    view.stop();
  });

  it("does not scroll to a waymark whose step it has just left", () => {
    const { flush } = fakeFrames();
    const view = watch(createRun(defineWalkthrough([
      { waymark: "far", advance: { state: (element) => element !== null } }, {},
    ])));
    const far = addFarTarget("far");

    flush();

    expect(view.snapshot.stepIndex).toBe(1);
    expect(far.scroll).not.toHaveBeenCalled();
    view.stop();
  });

  it("has no waymark to look for on a step without one", () => {
    fakeFrames();
    const view = watch(createRun(defineWalkthrough([{}])));

    expect(view.snapshot.waymark).toEqual({ status: "absent" });
    expect(view.snapshot.canAdvance).toBe(true);
  });

  it("asks for frames only on steps the next look could change", () => {
    const { frames, flush } = fakeFrames();
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
    fakeFrames();
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

  it("will not be moved past a shut gate, by command or by key", () => {
    fakeFrames();
    addTarget("save");
    const run = createRun(defineWalkthrough([{ waymark: "save", advance: "click" }, {}]));
    const view = watch(run);

    run.act("advance");
    press("ArrowRight");

    expect(view.snapshot).toMatchObject({ stepIndex: 0, canAdvance: false });
    view.stop();
  });

  it("does not take a click on the waymark for the event its step waits for", () => {
    fakeFrames();
    const target = addTarget("name");
    const view = watch(createRun(defineWalkthrough([
      { waymark: "name", advance: { event: "change" } }, {},
    ])));

    clickAt(target, 50, 40);
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });

    target.dispatchEvent(new Event("change"));
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("needs a click on each step that waits for one", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const publish = addTarget("publish", { x: 200, left: 200, right: 300 });
    const view = watch(createRun(defineWalkthrough([
      { waymark: "save", advance: "click" },
      { waymark: "publish", advance: "click" },
      {},
    ])));

    clickAt(save, 50, 40);
    flush();
    expect(view.snapshot.stepIndex).toBe(1);

    clickAt(publish, 250, 40);
    expect(view.snapshot.stepIndex).toBe(2);
    view.stop();
  });

  it("checks a step without a waymark without querying the DOM", () => {
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
    const check = vi.fn((element: Element | null) => element !== null);
    const run = createRun(defineWalkthrough([
      { waymark: "later", advance: { state: check } }, {},
    ]));
    const view = watch(run);
    const seen: unknown[] = [];
    const stop = run.subscribe(skipFirstCall(() => seen.push(run.getSnapshot())));
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
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
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
    const { flush } = fakeFrames();
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

  it("starts the delay again if the condition stops holding before it is due", () => {
    const { flush } = fakeFrames();
    let ready = true;
    const view = watch(createRun(defineWalkthrough([
      { advance: { state: () => ready, delayMs: 50 } }, {},
    ])));

    flush(); // holding
    ready = false;
    flush(20);
    ready = true;
    flush(20); // holding again, from here
    flush(40);
    expect(view.snapshot.stepIndex).toBe(0);

    flush(10);
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("times each step's delay from its own condition, not the step before's", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const view = watch(createRun(defineWalkthrough([
      { waymark: "save", advance: { click: true, delayMs: 50 } },
      { advance: { state: () => true, delayMs: 50 } },
      {},
    ])));

    clickAt(save, 50, 40);
    flush(50);
    expect(view.snapshot.stepIndex).toBe(1);

    flush(); // step 1's condition holds from here
    flush(49);
    expect(view.snapshot.stepIndex).toBe(1);
    flush(1);
    expect(view.snapshot.stepIndex).toBe(2);
    view.stop();
  });

  it("restarts a state check's delay after a spell with no subscribers", () => {
    const { flush } = fakeFrames();
    const run = createRun(defineWalkthrough([
      { advance: { state: () => true, delayMs: 50 } }, {},
    ]));
    let view = watch(run);
    flush(); // holding
    view.stop();

    flush(100); // no one watched it hold
    view = watch(run);
    expect(view.snapshot.stepIndex).toBe(0);
    flush(50);
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("keeps a click's delay through a spell with no subscribers", () => {
    const { flush } = fakeFrames();
    const save = addTarget("save");
    const run = createRun(defineWalkthrough([
      { waymark: "save", advance: { click: true, delayMs: 50 } }, {},
    ]));
    let view = watch(run);
    clickAt(save, 50, 40);
    view.stop();

    flush(100); // the click still happened
    view = watch(run);
    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("counts a click in the halo around a waymark as a click on it", () => {
    fakeFrames();
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
    fakeFrames();
    addTarget("panel");
    const dialog = addToBody(document.createElement("div"));
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
    fakeFrames();
    const target = addTarget("save");
    const button = document.createElement("button");
    if (kind === "marked") {
      button.dataset["waymarkUi"] = "";
      target.append(button);
    } else addToBody(button);
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
    fakeFrames();
    const target = addTarget("save", { x: 0, y: 0, top: 0, left: 0 });
    const away = addToBody(document.createElement("button"));
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
    fakeFrames();
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

  it.each(["Escape", "ArrowRight", "ArrowLeft", "Tab"])("leaves %s from other Waymark UI to that UI", (key) => {
    fakeFrames();
    const dialog = document.createElement("div");
    dialog.append(document.createElement("button"));
    const other = document.createElement("button");
    other.dataset["waymarkUi"] = "";
    addToBody(dialog);
    addToBody(other);
    const run = createRun(defineWalkthrough([{}, {}]), { ui: () => ({ dialog, beacon: null }) });
    const view = watch(run);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

    other.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(view.snapshot).toMatchObject({ stepIndex: 0, collapsed: false });
    view.stop();
  });

  it("takes keys from marked content inside its own dialog", () => {
    fakeFrames();
    const dialog = document.createElement("div");
    const marked = document.createElement("button");
    marked.dataset["waymarkUi"] = "";
    dialog.append(marked);
    addToBody(dialog);
    const run = createRun(defineWalkthrough([{}, {}]), { ui: () => ({ dialog, beacon: null }) });
    const view = watch(run);

    marked.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(view.snapshot.stepIndex).toBe(1);
    view.stop();
  });

  it("takes the arrow keys and Escape", () => {
    fakeFrames();
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
    fakeFrames();
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
    const { frames } = fakeFrames();
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

  it("ignores everything but reset once it has ended", () => {
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{}, {}]), {
      startAt: 1,
      onEvent: (event: RunEvent) => events.push(event.type),
    });
    run.act("exit");
    const ended = run.getSnapshot();

    for (const action of actions) if (action !== "reset") run.act(action);
    expect(run.getSnapshot()).toBe(ended);

    run.act("reset");
    expect(run.getSnapshot()).toMatchObject({ phase: "running", stepIndex: 0 });
    expect(events).toEqual(["exit", "reset"]);
  });

  it("has already found the waymark by the time it announces the start", () => {
    fakeFrames();
    addTarget("save");
    const seen: unknown[] = [];
    const run = createRun(defineWalkthrough([{ waymark: "save" }]), {
      onEvent: (event: RunEvent) => seen.push(event.snapshot),
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
    fakeFrames();
    const run = createRun(defineWalkthrough([{}, {}, {}]));
    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];
    const stepIndex = () => (run.getSnapshot() as Running).stepIndex;
    run.subscribe(skipFirstCall(() => {
      seenByFirst.push(stepIndex());
      if (stepIndex() === 1) run.act("advance");
    }));
    run.subscribe(skipFirstCall(() => seenBySecond.push(stepIndex())));

    run.act("advance");

    expect(seenByFirst).toEqual([1, 2]);
    expect(seenBySecond).toEqual([1, 2]);
  });

  it("ignores a condition met on a step the run has since left", () => {
    fakeFrames();
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
    const { frames } = fakeFrames();
    const events: string[] = [];
    const run = createRun(defineWalkthrough([{}]), {
      onEvent: (event: RunEvent) => events.push(event.type),
    });
    watch(run);
    const seen: string[] = [];
    const broken = run.subscribe(skipFirstCall(() => {
      throw new Error("renderer broke");
    }));
    run.subscribe(skipFirstCall(() => seen.push(run.getSnapshot().phase)));

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
    fakeFrames();
    const run = createRun(defineWalkthrough([{}]));
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

  it("announces start before anything a subscriber does on its first call", () => {
    const { frames } = fakeFrames();
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
    const { frames } = fakeFrames();
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
    const { frames, flush } = fakeFrames();
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
    const { frames, flush } = fakeFrames();
    const checkError = new Error("check failed");
    const subscriberError = new Error("subscriber failed");
    const check = vi.fn(() => false);
    const run = createRun(defineWalkthrough([
      { waymark: "later", advance: { state: check } }, {},
    ]));
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
    view.stop();
  });

  it("continues observing after a frame subscriber throws", () => {
    const { frames, flush, flushLost } = fakeFrames();
    const run = createRun(defineWalkthrough([{ waymark: "later" }]));
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

  it.each(["subscriber", "start handler"])("cleans up when the initial %s throws", (source) => {
    const { frames } = fakeFrames();
    const target = addTarget("save");
    const fail = () => { throw new Error("startup failed"); };
    const run = createRun(defineWalkthrough([{ waymark: "save" }]), {
      onEvent: (event) => { if (source === "start handler" && event.type === "start") fail(); },
    });

    const subscriber = source === "subscriber" ? vi.fn().mockImplementationOnce(fail) : () => {};
    expect(() => run.subscribe(subscriber)).toThrow("startup failed");
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
