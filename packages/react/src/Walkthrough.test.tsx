import { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChecklists,
  defineWalkthrough,
  localStorageAdapter,
  Walkthrough,
  type BeaconRenderProps,
  type WalkthroughLabels,
  type WalkthroughRenderProps,
} from "./index";

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

const targetRect = {
  x: 20,
  y: 20,
  top: 20,
  left: 20,
  right: 120,
  bottom: 60,
  width: 100,
  height: 40,
  toJSON: () => ({}),
} as DOMRect;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  frames = new Map();
  nextFrameId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

const buttonNamed = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (button) => button.textContent === label,
  );

const shade = () => document.querySelector("[data-waymark-shade]");

const runFrames = async () => {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(performance.now());
    await Promise.resolve();
  });
};

const beacon = () =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Resume walkthrough"]');

const beaconAnchor = () => document.querySelector<HTMLElement>("[data-waymark-beacon]");

const clickAway = async () => {
  await act(async () => {
    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 }),
    );
    await Promise.resolve();
  });
};

const addTarget = (waymark: string, label: string): HTMLButtonElement => {
  const target = document.createElement("button");
  target.dataset.waymark = waymark;
  target.textContent = label;
  target.getBoundingClientRect = () => targetRect;
  document.body.insertBefore(target, host);
  return target;
};

describe("Walkthrough", () => {
  it("does no work while inactive", async () => {
    const walkthrough = defineWalkthrough([{ content: "Hidden" }]);
    await act(async () => {
      root.render(<Walkthrough active={false} walkthrough={walkthrough} />);
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(frames.size).toBe(0);
  });

  it("renders into the body, or in place with portal off", async () => {
    const walkthrough = defineWalkthrough([{ content: "Hello" }]);
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    expect(dialog()!.parentElement).toBe(document.body);

    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} portal={false} />));
    expect(host).toContainElement(dialog());
  });

  it("renders the default view and advances after a Waymark click", async () => {
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough([
      { waymark: "save", advance: "click", content: "Save the document" },
      { content: "The document is saved" },
    ]);

    await act(async () => {
      root.render(<Walkthrough walkthrough={walkthrough} />);
    });

    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "Save the document",
    );
    expect(target).toHaveAttribute("aria-haspopup", "dialog");

    await act(async () => {
      target.click();
      await Promise.resolve();
    });

    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "The document is saved",
    );
    expect(target).not.toHaveAttribute("aria-haspopup");
  });

  it("uses a replacement event callback without restarting the run", async () => {
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough([
      { waymark: "save", advance: "click", content: "First step" },
      { content: "Second step" },
      { content: "Third step" },
    ]);
    const original = vi.fn();
    const replacement = vi.fn();

    await act(async () => {
      root.render(<Walkthrough walkthrough={walkthrough} onEvent={original} />);
    });
    await act(async () => target.click());
    expect(original).toHaveBeenCalled();
    original.mockClear();

    await act(async () => {
      root.render(<Walkthrough walkthrough={walkthrough} onEvent={replacement} />);
    });
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("Second step");

    await act(async () => buttonNamed("Next")!.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("Third step");
    expect(replacement).toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
  });

  it("renders a closed Advance gate until its condition is met", async () => {
    const target = addTarget("name", "Name");
    const walkthrough = defineWalkthrough([
      {
        waymark: "name",
        content: "Enter a name",
        advance: { event: "change", then: "unlock" },
      },
      { content: "Named" },
    ]);

    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    const next = document.querySelector("button[disabled]");
    expect(next).toHaveTextContent("Next");

    await act(async () => {
      target.dispatchEvent(new Event("change"));
      await Promise.resolve();
    });

    expect(document.querySelector("button[disabled]")).toBeNull();
  });

  it("shows a step waiting for its Waymark without a note, then with one once missing, and lets the user past its gate", async () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const walkthrough = defineWalkthrough([
      { waymark: "save", advance: "click", content: "Save the document" },
      { content: "The document is saved" },
    ]);

    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(shade()).not.toBeNull();

    clock += 1000;
    await runFrames();
    const dialog = () => document.querySelector('[role="dialog"]');
    expect(dialog()).toHaveTextContent("Save the document");
    expect(dialog()).not.toHaveTextContent("Can't find the part of the page");
    expect(buttonNamed("Next")).toBeDisabled();

    clock += 2000;
    await runFrames();
    expect(dialog()).toHaveTextContent("Can't find the part of the page");

    await act(async () => buttonNamed("Next")!.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("The document is saved");
  });

  it("shows a note once a step's Waymark has been gone for 200ms", async () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough([{ waymark: "save", content: "Save the document" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent("Can't find the part of the page");

    target.remove();
    await runFrames();
    clock += 199;
    await runFrames();
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent("Can't find the part of the page");

    clock += 1;
    await runFrames();
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("Can't find the part of the page");
  });

  it("shows nothing for a Collapsed run still searching for its Waymark", async () => {
    const walkthrough = defineWalkthrough([{ waymark: "save", content: "Save the document" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    expect(shade()).not.toBeNull();

    await clickAway();
    expect(shade()).toBeNull();
    expect(beacon()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows a Collapsed run's beacon only once its Waymark is found or missing, not while waiting", async () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const walkthrough = defineWalkthrough([{ waymark: "save", content: "Save the document" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    await clickAway();

    clock += 1000;
    await runFrames();
    expect(beacon()).toBeNull();

    clock += 2000;
    await runFrames();
    expect(beacon()).not.toBeNull();
  });

  it("turns an outside click into a resumable Collapsed run", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([
      { waymark: "panel", content: "Use this panel" },
    ]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    await clickAway();

    expect(beacon()).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => beacon()!.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "Use this panel",
    );
  });

  it("pins the beacon to its Waymark's top-right corner", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([{ waymark: "panel", content: "Use this panel" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    await clickAway();

    expect(beaconAnchor()!.style).toMatchObject({ left: "120px", top: "20px" });
  });

  it("keeps the beacon on screen for a Waymark in the screen's corner", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    const target = addTarget("help", "Help");
    target.getBoundingClientRect = () => new DOMRect(window.innerWidth - 60, 0, 60, 40);
    const walkthrough = defineWalkthrough([{ waymark: "help", content: "Help lives here" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));
    await clickAway();

    expect(parseFloat(beaconAnchor()!.style.left)).toBeLessThan(window.innerWidth - 10);
    expect(parseFloat(beaconAnchor()!.style.top)).toBeGreaterThan(10);
  });

  it("keeps a custom beacon wider than the default whole on screen", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
    const target = addTarget("help", "Help");
    target.getBoundingClientRect = () => new DOMRect(window.innerWidth - 60, 0, 60, 40);
    const walkthrough = defineWalkthrough([{ waymark: "help", content: "Help lives here" }]);
    await act(async () =>
      root.render(
        <Walkthrough walkthrough={walkthrough} renderBeacon={({ resume }) => <button type="button" onClick={resume}>Carry on with help</button>} />,
      ),
    );
    await clickAway();

    expect(beaconAnchor()!.style).toMatchObject({ left: `${window.innerWidth - 60}px`, top: "20px" });
  });

  it("draws a custom beacon in place of the default, and resumes from it", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([{ waymark: "panel", content: "Use this panel" }]);
    await act(async () =>
      root.render(
        <Walkthrough
          walkthrough={walkthrough}
          renderBeacon={({ currentStep, resume }) => (
            <button type="button" onClick={resume}>
              Back to: {currentStep.content}
            </button>
          )}
        />,
      ),
    );
    await clickAway();

    expect(beacon()).toBeNull();
    const custom = beaconAnchor()!.querySelector("button")!;
    expect(custom).toHaveTextContent("Back to: Use this panel");

    await act(async () => custom.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("Use this panel");
  });

  it("doesn't take a click on a custom beacon over its Waymark for a click on the Waymark", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([
      { waymark: "panel", advance: "click", content: "Click the panel" },
      { content: "Done" },
    ]);
    await act(async () =>
      root.render(<Walkthrough walkthrough={walkthrough} renderBeacon={() => <span>Paused</span>} />),
    );
    await clickAway();

    await act(async () => {
      beaconAnchor()!.querySelector("span")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1, clientX: 60, clientY: 40 }),
      );
      await Promise.resolve();
    });
    expect(beaconAnchor()).toHaveTextContent("Paused");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("tells a custom beacon whether it sits on a found Waymark", async () => {
    addTarget("panel", "Panel");
    const renderBeacon = vi.fn((_props: BeaconRenderProps) => null);
    const walkthrough = defineWalkthrough([{ waymark: "panel", content: "On the panel" }, { content: "Anywhere" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} renderBeacon={renderBeacon} />));
    await clickAway();
    expect(renderBeacon.mock.lastCall![0].waymarkFound).toBe(true);

    await act(async () => renderBeacon.mock.lastCall![0].resume());
    await act(async () => buttonNamed("Next")!.click());
    await clickAway();
    expect(renderBeacon.mock.lastCall![0]).toMatchObject({
      waymarkFound: false,
      currentStep: { content: "Anywhere" },
      labels: { resume: "Resume walkthrough" },
    });
  });

  it("ends the walkthrough from the close button", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([{ waymark: "panel", content: "Use this panel" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));

    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close"]',
    )!;
    await act(async () => close.click());

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(beacon()).toBeNull();
  });

  it("supports one custom popover seam", async () => {
    const walkthrough = defineWalkthrough([{ content: "Payload" }]);
    await act(async () => {
      root.render(
        <Walkthrough
          walkthrough={walkthrough}
          renderPopover={({ currentStep, snapshot }) => (
            <button type="button">
              Custom {snapshot.stepIndex}: {currentStep.content}
            </button>
          )}
        />,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "Custom 0: Payload",
    );
  });

  it("uses an app's labels, and the defaults for those it leaves out", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([
      { content: "Welcome" },
      { waymark: "panel", content: "Use this panel" },
    ]);
    await act(async () =>
      root.render(
        <Walkthrough
          walkthrough={walkthrough}
          labels={{
            next: "Weiter",
            close: "Schließen",
            resume: "Fortsetzen",
            stepOf: (step, count) => `Schritt ${step} von ${count}`,
          }}
        />,
      ),
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toHaveAttribute("aria-label", "Schritt 1 von 2");
    expect(dialog).toHaveTextContent("Schritt 1 von 2");
    expect(dialog!.querySelector('button[aria-label="Schließen"]')).not.toBeNull();

    await act(async () => buttonNamed("Weiter")!.click());
    await runFrames();
    expect(buttonNamed("Previous")).toBeDefined();
    expect(buttonNamed("Finish")).toBeDefined();

    await clickAway();
    expect(document.querySelector('button[aria-label="Fortsetzen"]')).toHaveAttribute("title", "Fortsetzen");
  });

  it("uses the default for a label passed as undefined", async () => {
    const walkthrough = defineWalkthrough([{ content: "Welcome" }, { content: "Next up" }]);
    // @ts-expect-error: only exactOptionalPropertyTypes, which an app may not set, rejects this.
    const labels: Partial<WalkthroughLabels> = { next: undefined, stepOf: undefined };
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} labels={labels} />));

    expect(document.querySelector('[role="dialog"]')).toHaveAttribute("aria-label", "Step 1 of 2");
    expect(buttonNamed("Next")).toBeDefined();
  });

  it("emits completion after the committed terminal state and cleans up", async () => {
    const target = addTarget("finish", "Finish target");
    const phases: string[] = [];
    const walkthrough = defineWalkthrough([
      { waymark: "finish", content: "Last step" },
    ]);
    await act(async () => {
      root.render(
        <Walkthrough
          walkthrough={walkthrough}
          onEvent={(event) => {
            if (event.type === "advance" || event.type === "finish") {
              phases.push(`${event.type}:${event.snapshot.phase}`);
            }
          }}
        />,
      );
    });

    await act(async () => buttonNamed("Finish")!.click());

    expect(phases).toEqual(["advance:completed", "finish:completed"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(frames.size).toBe(0);
  });
});

describe("Walkthrough with storage", () => {
  afterEach(() => localStorage.clear());

  const tour = localStorageAdapter("tour");
  const walkthrough = defineWalkthrough(
    [{ content: "First step" }, { content: "Second step" }, { content: "Third step" }],
    { storage: tour },
  );
  const view = () => <Walkthrough walkthrough={walkthrough} />;
  const dialog = () => document.querySelector('[role="dialog"]');

  it("reads storage once as it mounts, and picks up its place on the next mount", async () => {
    const load = vi.spyOn(tour, "load");
    await act(async () => root.render(view()));
    await act(async () => buttonNamed("Next")!.click());
    expect(dialog()).toHaveTextContent("Second step");

    await act(async () => root.render(view()));
    expect(load).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(view()));
    expect(load).toHaveBeenCalledTimes(2);
    expect(dialog()).toHaveTextContent("Second step");
  });

  it("shows a finished walkthrough again once it is reset", async () => {
    localStorage.setItem("tour", JSON.stringify({ version: 1, phase: "completed" }));
    await act(async () => root.render(view()));
    expect(dialog()).toBeNull();

    await act(async () => walkthrough.reset());
    expect(dialog()).toHaveTextContent("First step");
  });

  it.each([true, false])(
    "hydrates a server render, which has no document, then shows the stored step (portal %s)",
    async (portal) => {
      localStorage.setItem(
        "tour",
        JSON.stringify({ version: 1, phase: "running", step: 1, stepCount: 3, collapsed: false, savedAt: Date.now() }),
      );
      const app = () => (
        <Walkthrough walkthrough={walkthrough} portal={portal} />
      );
      vi.stubGlobal("document", undefined);
      let server: string;
      try {
        server = renderToString(app());
      } finally {
        vi.unstubAllGlobals();
      }

      const page = document.createElement("div");
      document.body.append(page);
      page.innerHTML = server;
      const onRecoverableError = vi.fn();
      const error = vi.spyOn(console, "error");
      let hydrated: Root | undefined;
      await act(async () => {
        hydrated = hydrateRoot(page, app(), { onRecoverableError });
      });

      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(dialog()).toHaveTextContent("Second step");
      await act(async () => hydrated?.unmount());
    },
  );

  it("shows nothing for a walkthrough storage says was finished", async () => {
    localStorage.setItem("tour", JSON.stringify({ version: 1, phase: "completed" }));
    await act(async () => root.render(view()));
    expect(dialog()).toBeNull();
    expect(shade()).toBeNull();
  });
});

describe("Walkthrough with checklists", () => {
  const setup = (onEvent?: (event: { type: string }) => void) =>
    createChecklists({
      context: { hasDeck: false },
      tasks: {
        "create-deck": {
          title: "Create a deck",
          walkthrough: defineWalkthrough([
            { content: "Open the decks page", meta: { helpUrl: "/help" } },
            { content: "Press new deck" },
          ]),
          isComplete: (c) => c.hasDeck,
        },
        "read-tips": {
          title: "Read the tips",
          walkthrough: defineWalkthrough([{ content: "Here are the tips" }]),
        },
        "say-hello": { title: "Say hello" },
      },
      checklists: { home: ["create-deck", "read-tips", "say-hello"], decks: ["create-deck"] },
      ...(onEvent ? { onEvent } : {}),
    });

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it("draws the Run the owner started and finishes it into completion", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    expect(dialog()).toBeNull();

    await act(async () => owner.start("read-tips"));
    expect(dialog()).toHaveTextContent("Here are the tips");

    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toBeNull();
    expect(owner.getSnapshot().active).toBeNull();
    expect(owner.checklists.home.getSnapshot().tasks[1]!.status).toBe("done");
    expect(frames.size).toBe(0);
  });

  it("binds its elements so a click on the popover is not a click away", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("read-tips"));

    await act(async () => {
      dialog()!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
      await Promise.resolve();
    });
    expect(dialog()).toHaveTextContent("Here are the tips");

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 }));
      await Promise.resolve();
    });
    expect(dialog()).toBeNull();
    expect(beacon()).toBeInTheDocument();
  });

  it("renders a custom popover with the owner's step union", async () => {
    const owner = setup();
    await act(async () =>
      root.render(
        <Walkthrough
          checklists={owner}
          renderPopover={({ currentStep, exit }) => (
            <button type="button" onClick={exit}>
              {currentStep.content}
              {currentStep.meta ? ` (${currentStep.meta.helpUrl})` : ""}
            </button>
          )}
        />,
      ),
    );
    await act(async () => owner.start("create-deck"));
    expect(dialog()).toHaveTextContent("Open the decks page (/help)");

    await act(async () => (dialog()!.querySelector("button") as HTMLButtonElement).click());
    expect(owner.getSnapshot().active).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("draws a custom beacon with the owner's step union, and exits from it", async () => {
    const owner = setup();
    await act(async () =>
      root.render(
        <Walkthrough
          checklists={owner}
          renderBeacon={({ currentStep, exit }) => (
            <button type="button" onClick={exit}>
              Stop: {currentStep.meta ? currentStep.meta.helpUrl : "no help"}
            </button>
          )}
        />,
      ),
    );
    await act(async () => owner.start("create-deck"));
    await clickAway();

    const custom = beaconAnchor()!.querySelector("button")!;
    expect(custom).toHaveTextContent("Stop: /help");
    await act(async () => custom.click());
    expect(owner.getSnapshot().active).toBeNull();
    expect(beaconAnchor()).toBeNull();
  });

  it("offers to skip the task being guided, in every view", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("create-deck"));
    await act(async () => buttonNamed("Skip task")!.click());
    expect(dialog()).toBeNull();
    expect(owner.checklists.decks.getSnapshot().tasks[0]!.status).toBe("skipped");
    expect(owner.checklists.home.getSnapshot().tasks[0]!.status).toBe("skipped");
  });

  it("passes an app's labels to the guided task's popover", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} labels={{ skipTask: "Aufgabe überspringen" }} />));
    await act(async () => owner.start("create-deck"));
    expect(buttonNamed("Aufgabe überspringen")).toBeDefined();
  });

  it("hands a custom popover the labels, the app's over the defaults", async () => {
    const renderPopover = vi.fn((_props: WalkthroughRenderProps) => null);
    const walkthrough = defineWalkthrough([{ content: "Alone" }]);
    await act(async () =>
      root.render(<Walkthrough walkthrough={walkthrough} labels={{ next: "Weiter" }} renderPopover={renderPopover} />),
    );
    const { labels } = renderPopover.mock.lastCall![0];
    expect([labels.next, labels.finish]).toEqual(["Weiter", "Finish"]);
  });

  it("offers no task skip to a walkthrough it owns", async () => {
    const renderPopover = vi.fn((_props: WalkthroughRenderProps) => null);
    const walkthrough = defineWalkthrough([{ content: "Alone" }]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} renderPopover={renderPopover} />));
    expect(renderPopover).toHaveBeenCalled();
    expect(renderPopover.mock.calls.every(([props]) => !("skipTask" in props))).toBe(true);
  });

  it("follows the owner when guidance is stopped or replaced", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("create-deck"));
    expect(dialog()).toHaveTextContent("Open the decks page");

    await act(async () => owner.start("read-tips"));
    expect(dialog()).toHaveTextContent("Here are the tips");

    await act(async () => owner.stop());
    expect(dialog()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it("keeps a prestarted Run through Strict Mode's mount cycle", async () => {
    const events: string[] = [];
    const owner = setup((event) => events.push(event.type));
    owner.start("read-tips");
    events.length = 0;

    await act(async () => {
      root.render(
        <StrictMode>
          <Walkthrough checklists={owner} />
        </StrictMode>,
      );
    });

    expect(dialog()).toHaveTextContent("Here are the tips");
    expect(owner.getSnapshot().active?.task.id).toBe("read-tips");
    expect(events).toEqual([]);
  });

  it("stops its Run on actual unmount, retaining progress", async () => {
    const events: string[] = [];
    const owner = setup((event) => events.push(event.type));
    owner.markDone("say-hello");
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("read-tips"));
    const { run } = owner.getSnapshot().active!;
    events.length = 0;

    await act(async () => root.render(<div />));

    expect(owner.getSnapshot().active).toBeNull();
    expect(run.getSnapshot().phase).toBe("exited");
    expect(events).toEqual(["taskStopped"]);
    expect(owner.checklists.home.getSnapshot().tasks[2]!.status).toBe("done");
    expect(frames.size).toBe(0);
  });

  it("does not stop a Run that replaced the one it was drawing", async () => {
    const owner = setup();
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("read-tips"));

    // The renderer is removed, and before its pending stop runs the app starts something else.
    act(() => root.render(<div />));
    owner.start("create-deck");
    await act(async () => {});

    expect(owner.getSnapshot().active?.task.id).toBe("create-deck");
  });

  it("hands guidance over to a renderer that mounts as it unmounts", async () => {
    const owner = setup();
    const other = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<Walkthrough checklists={owner} />));
    await act(async () => owner.start("read-tips"));

    await act(async () => {
      root.render(<div />);
      other.render(<Walkthrough checklists={owner} />);
    });

    expect(owner.getSnapshot().active?.task.id).toBe("read-tips");
    expect(dialog()).toHaveTextContent("Here are the tips");

    await act(async () => other.unmount());
    expect(owner.getSnapshot().active).toBeNull();
  });
});
