import { act, StrictMode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  defineChecklists,
  defineWalkthrough,
  everyProblem,
  localStorageAdapter,
  Walkthrough,
  WaymarkRoot,
  type BeaconRenderProps,
  type StoredRecord,
  type WalkthroughLabels,
  type WalkthroughProgress,
  type WalkthroughRenderProps,
  type WaymarkProblem,
} from "./index";
import { addHost, addTarget, localKey } from "./test/dom";
import { addWaymarkRoot } from "./test/root";
import { fakeFrames } from "./test/time";

const mount = () => ({ ...fakeFrames(), ...addWaymarkRoot() });

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

const buttonNamed = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (button) => button.textContent === label,
  );

const shade = () => document.querySelector("[data-waymark-shade]");

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

describe("Walkthrough", () => {
  it("does no work while inactive", async () => {
    const { render, frames } = mount();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Hidden" }] });
    await render(<Walkthrough active={false} walkthrough={walkthrough} />);

    expect(dialog()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it("asks for its walkthrough, which waits for the open one and doesn't come back once finished, and draws nothing itself", async () => {
    const { render } = mount();
    const first = defineWalkthrough({ id: "first", steps: [{ content: "First tour" }] });
    const hint = defineWalkthrough({ id: "hint", steps: [{ content: "A hint" }] });
    const page = () => (
      <div data-page>
        <Walkthrough walkthrough={hint} />
      </div>
    );
    const run = await render(null, { portal: false });
    await act(async () => run.start(first));

    await render(page(), { portal: false });
    expect(dialog()).toHaveTextContent("First tour");
    expect(document.querySelector("[data-page]")).toBeEmptyDOMElement();

    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toHaveTextContent("A hint");
    expect(document.querySelector("[data-page]")).toBeEmptyDOMElement();

    await act(async () => buttonNamed("Finish")!.click());
    await render(null, { portal: false });
    await render(page(), { portal: false });
    expect(dialog()).toBeNull();
  });

  it("withdraws its request when its page goes before its turn", async () => {
    const { render } = mount();
    const first = defineWalkthrough({ id: "first", steps: [{ content: "First tour" }] });
    const hint = defineWalkthrough({ id: "hint", steps: [{ content: "A hint" }] });
    const run = await render(null);
    await act(async () => run.start(first));
    await render(<Walkthrough walkthrough={hint} />);
    await render(null);

    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toBeNull();
  });

  it("keeps a page's walkthrough as the next page asks for it too: waiting, it still waits; open, it stays open", async () => {
    const { render } = mount();
    const events: string[] = [];
    const onEvent = (event: { type: string }) => events.push(event.type);
    const first = defineWalkthrough({ id: "first", steps: [{ content: "First tour" }] });
    const hint = defineWalkthrough({ id: "hint", steps: [{ content: "A hint" }] });
    // Keyed, so moving to the next page unmounts one Walkthrough as the other mounts.
    const page = (name: string) => (
      <section key={name}>
        <Walkthrough walkthrough={hint} />
      </section>
    );
    const run = await render(null, { onEvent });
    await act(async () => run.start(first));

    await render(page("filters"), { onEvent });
    await render(page("views"), { onEvent });
    expect(dialog()).toHaveTextContent("First tour");
    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toHaveTextContent("A hint");

    events.length = 0;
    await render(page("filters"), { onEvent });
    expect(dialog()).toHaveTextContent("A hint");
    expect(events).toEqual([]);
  });

  it("keeps a walkthrough open, and the page listened to, through Strict Mode's mount cycle", async () => {
    const { root } = mount();
    const events: string[] = [];
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Hello" }] });
    await act(async () =>
      root.render(
        <StrictMode>
          <WaymarkRoot onEvent={(event) => events.push(event.type)}>
            <Walkthrough walkthrough={walkthrough} />
          </WaymarkRoot>
        </StrictMode>,
      ),
    );

    expect(dialog()).toHaveTextContent("Hello");
    expect(events).toEqual(["start"]);

    await clickAway();
    expect(events).toEqual(["start", "collapse"]);
    expect(beacon()).toBeInTheDocument();
  });
});

describe("WaymarkRoot", () => {
  it("renders into the body, or in place with portal off", async () => {
    const { render, host } = mount();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Hello" }] });

    await render(<Walkthrough walkthrough={walkthrough} />);
    expect(dialog()!.parentElement).toBe(document.body);

    await render(<Walkthrough walkthrough={walkthrough} />, { portal: false });
    expect(host).toContainElement(dialog());
  });

  it("renders the default view and advances after a Waymark click", async () => {
    const { render } = mount();
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        { waymark: "save", advance: "click", content: "Save the document" },
        { content: "The document is saved" },
      ],
    });

    await render(<Walkthrough walkthrough={walkthrough} />);

    expect(dialog()).toHaveTextContent("Save the document");
    expect(target).toHaveAttribute("aria-haspopup", "dialog");

    await act(async () => {
      target.click();
      await Promise.resolve();
    });

    expect(dialog()).toHaveTextContent("The document is saved");
    expect(target).not.toHaveAttribute("aria-haspopup");
  });

  it("uses a replacement event callback without restarting the walkthrough", async () => {
    const { render } = mount();
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        { waymark: "save", advance: "click", content: "First step" },
        { content: "Second step" },
        { content: "Third step" },
      ],
    });
    const original = vi.fn();
    const replacement = vi.fn();

    await render(<Walkthrough walkthrough={walkthrough} />, { onEvent: original });
    await act(async () => target.click());
    expect(original).toHaveBeenCalled();
    original.mockClear();

    await render(<Walkthrough walkthrough={walkthrough} />, { onEvent: replacement });
    expect(dialog()).toHaveTextContent("Second step");

    await act(async () => buttonNamed("Next")!.click());
    expect(dialog()).toHaveTextContent("Third step");
    expect(replacement).toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
  });

  it("renders a closed Advance gate until its condition is met", async () => {
    const { render } = mount();
    const target = addTarget("name", "Name");
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        {
          waymark: "name",
          content: "Enter a name",
          advance: { event: "change", then: "unlock" },
        },
        { content: "Named" },
      ],
    });

    await render(<Walkthrough walkthrough={walkthrough} />);
    const next = document.querySelector("button[disabled]");
    expect(next).toHaveTextContent("Next");

    await act(async () => {
      target.dispatchEvent(new Event("change"));
      await Promise.resolve();
    });

    expect(document.querySelector("button[disabled]")).toBeNull();
  });

  it("reports a missing Waymark and a throwing onEvent to its problemHandlers", async () => {
    const { render, runFrames } = mount();
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const onProblem = vi.fn<(problem: WaymarkProblem) => void>();
    const analyticsDown = new Error("analytics down");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save the document" }] });

    await render(<Walkthrough walkthrough={walkthrough} />, {
      problemHandlers: everyProblem(onProblem),
      onEvent: () => {
        throw analyticsDown;
      },
    });
    clock += 3000;
    await runFrames();

    expect(onProblem.mock.calls).toEqual([
      [{ type: "callbackThrew", callback: "onEvent", error: analyticsDown }],
      [{ type: "waymarkMissing", walkthrough: "tour", step: walkthrough.steps[0], stepIndex: 0 }],
    ]);
  });

  it("reports to the problem handlers of its latest render", async () => {
    const { render, runFrames } = mount();
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const original = vi.fn();
    const replacement = vi.fn();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save the document" }] });

    await render(<Walkthrough walkthrough={walkthrough} />, { problemHandlers: { waymarkMissing: original } });
    await render(<Walkthrough walkthrough={walkthrough} />, { problemHandlers: { waymarkMissing: replacement } });
    clock += 3000;
    await runFrames();

    expect(replacement).toHaveBeenCalledOnce();
    expect(original).not.toHaveBeenCalled();
  });

  it("shows a step waiting for its Waymark without a note, then with one once missing, and lets the user past its gate", async () => {
    const { render, runFrames } = mount();
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        { waymark: "save", advance: "click", content: "Save the document" },
        { content: "The document is saved" },
      ],
    });

    await render(<Walkthrough walkthrough={walkthrough} />);
    expect(dialog()).toBeNull();
    expect(shade()).not.toBeNull();

    clock += 1000;
    await runFrames();
    expect(dialog()).toHaveTextContent("Save the document");
    expect(dialog()).not.toHaveTextContent("Can't find the part of the page");
    expect(buttonNamed("Next")).toBeDisabled();

    clock += 2000;
    await runFrames();
    expect(dialog()).toHaveTextContent("Can't find the part of the page");

    await act(async () => buttonNamed("Next")!.click());
    expect(dialog()).toHaveTextContent("The document is saved");
  });

  it("shows a note once a step's Waymark has been gone for 200ms", async () => {
    const { render, runFrames } = mount();
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const target = addTarget("save", "Save");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save the document" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);
    expect(dialog()).not.toHaveTextContent("Can't find the part of the page");

    target.remove();
    await runFrames();
    clock += 199;
    await runFrames();
    expect(dialog()).not.toHaveTextContent("Can't find the part of the page");

    clock += 1;
    await runFrames();
    expect(dialog()).toHaveTextContent("Can't find the part of the page");
  });

  it("shows nothing for a collapsed walkthrough still searching for its Waymark", async () => {
    const { render } = mount();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save the document" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);
    expect(shade()).not.toBeNull();

    await clickAway();
    expect(shade()).toBeNull();
    expect(beacon()).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("shows a collapsed walkthrough's beacon only once its Waymark is found or missing, not while waiting", async () => {
    const { render, runFrames } = mount();
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save the document" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);
    await clickAway();

    clock += 1000;
    await runFrames();
    expect(beacon()).toBeNull();

    clock += 2000;
    await runFrames();
    expect(beacon()).not.toBeNull();
  });

  it("turns an outside click into a resumable collapsed walkthrough", async () => {
    const { render } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "panel", content: "Use this panel" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);
    await clickAway();

    expect(beacon()).toBeInTheDocument();
    expect(dialog()).toBeNull();

    await act(async () => beacon()!.click());
    expect(dialog()).toHaveTextContent("Use this panel");
  });

  it("pins the beacon to its Waymark's top-right corner", async () => {
    const { render } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "panel", content: "Use this panel" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);
    await clickAway();

    expect(beaconAnchor()!.style).toMatchObject({ left: "120px", top: "20px" });
  });

  it("draws a custom beacon in place of the default, and resumes from it", async () => {
    const { render } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "panel", content: "Use this panel" }] });
    await render(<Walkthrough walkthrough={walkthrough} />, {
      renderBeacon: ({ currentStep, resume }) => (
        <button type="button" onClick={resume}>
          Back to: {currentStep.content}
        </button>
      ),
    });
    await clickAway();

    expect(beacon()).toBeNull();
    const custom = beaconAnchor()!.querySelector("button")!;
    expect(custom).toHaveTextContent("Back to: Use this panel");

    await act(async () => custom.click());
    expect(dialog()).toHaveTextContent("Use this panel");
  });

  it("doesn't take a click on a custom beacon over its Waymark for a click on the Waymark", async () => {
    const { render } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        { waymark: "panel", advance: "click", content: "Click the panel" },
        { content: "Done" },
      ],
    });
    await render(<Walkthrough walkthrough={walkthrough} />, { renderBeacon: () => <span>Paused</span> });
    await clickAway();

    await act(async () => {
      beaconAnchor()!.querySelector("span")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1, clientX: 60, clientY: 40 }),
      );
      await Promise.resolve();
    });
    expect(beaconAnchor()).toHaveTextContent("Paused");
    expect(dialog()).toBeNull();
  });

  it("tells a custom beacon whether it sits on a found Waymark", async () => {
    const { render } = mount();
    addTarget("panel", "Panel");
    const renderBeacon = vi.fn((_props: BeaconRenderProps) => null);
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [{ waymark: "panel", content: "On the panel" }, { content: "Anywhere" }],
    });
    await render(<Walkthrough walkthrough={walkthrough} />, { renderBeacon });
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
    const { render } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "panel", content: "Use this panel" }] });
    await render(<Walkthrough walkthrough={walkthrough} />);

    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close"]',
    )!;
    await act(async () => close.click());

    expect(dialog()).toBeNull();
    expect(beacon()).toBeNull();
  });

  it("supports one custom popover seam", async () => {
    const { render } = mount();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Payload" }] });
    await render(<Walkthrough walkthrough={walkthrough} />, {
      renderPopover: ({ currentStep, snapshot }) => (
        <button type="button">
          Custom {snapshot.stepIndex}: {currentStep.content}
        </button>
      ),
    });

    expect(dialog()).toHaveTextContent("Custom 0: Payload");
  });

  it("draws a walkthrough with its definition's own popover and beacon over the root's", async () => {
    const { render } = mount();
    const whatsNew = defineWalkthrough({
      id: "whatsNew",
      steps: [{ content: "Filters" }],
      renderPopover: ({ currentStep }) => <p>New: {currentStep.content}</p>,
      renderBeacon: () => <span>New beacon</span>,
    });
    const plain = defineWalkthrough({ id: "plain", steps: [{ content: "Plain" }] });
    const run = await render(<Walkthrough walkthrough={whatsNew} />, {
      renderPopover: ({ currentStep }) => <p>Root: {currentStep.content}</p>,
      renderBeacon: () => <span>Root beacon</span>,
    });
    expect(dialog()).toHaveTextContent("New: Filters");

    await act(async () => run.start(plain));
    expect(dialog()).toHaveTextContent("Root: Plain");

    await act(async () => run.act("exit"));
    expect(beaconAnchor()).toHaveTextContent("New beacon");
  });

  it("uses an app's labels, and the defaults for those it leaves out", async () => {
    const { render, runFrames } = mount();
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough({
      id: "tour",
      steps: [
        { content: "Welcome" },
        { waymark: "panel", content: "Use this panel" },
      ],
    });
    await render(<Walkthrough walkthrough={walkthrough} />, {
      labels: {
        next: "Weiter",
        close: "Schließen",
        resume: "Fortsetzen",
        stepOf: (step, count) => `Schritt ${step} von ${count}`,
      },
    });

    expect(dialog()).toHaveAttribute("aria-label", "Schritt 1 von 2");
    expect(dialog()).toHaveTextContent("Schritt 1 von 2");
    expect(dialog()!.querySelector('button[aria-label="Schließen"]')).not.toBeNull();

    await act(async () => buttonNamed("Weiter")!.click());
    await runFrames();
    expect(buttonNamed("Previous")).toBeDefined();
    expect(buttonNamed("Finish")).toBeDefined();

    await clickAway();
    expect(document.querySelector('button[aria-label="Fortsetzen"]')).toHaveAttribute("title", "Fortsetzen");
  });

  it("uses the default for a label passed as undefined", async () => {
    const { render } = mount();
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Welcome" }, { content: "Next up" }] });
    // @ts-expect-error: only exactOptionalPropertyTypes, which an app may not set, rejects this.
    const labels: Partial<WalkthroughLabels> = { next: undefined, stepOf: undefined };
    await render(<Walkthrough walkthrough={walkthrough} />, { labels });

    expect(dialog()).toHaveAttribute("aria-label", "Step 1 of 2");
    expect(buttonNamed("Next")).toBeDefined();
  });

  it("emits completion after the committed terminal state and cleans up", async () => {
    const { render, frames } = mount();
    const target = addTarget("finish", "Finish target");
    const phases: string[] = [];
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ waymark: "finish", content: "Last step" }] });
    await render(<Walkthrough walkthrough={walkthrough} />, {
      onEvent: (event) => {
        if (event.type === "advance" || event.type === "finish") {
          phases.push(`${event.type}:${event.snapshot.phase}`);
        }
      },
    });

    await act(async () => buttonNamed("Finish")!.click());

    expect(phases).toEqual(["advance:completed", "finish:completed"]);
    expect(dialog()).toBeNull();
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(frames.size).toBe(0);
  });
});

describe("WaymarkRoot with storage", () => {
  const walkthrough = defineWalkthrough({
    id: "tour",
    steps: [{ content: "First step" }, { content: "Second step" }, { content: "Third step" }],
  });
  const view = () => <Walkthrough walkthrough={walkthrough} />;
  /** A record holding only this walkthrough's progress, as an earlier visit left it. */
  const record = (progress: Omit<WalkthroughProgress, "stepCount" | "changedAt">) =>
    JSON.stringify({
      version: 4,
      walkthroughs: { tour: { ...progress, stepCount: 3, changedAt: Date.now() } },
      tasks: {},
    } satisfies StoredRecord);
  // The Run saves the user's record in localStorage, under a key that goes when the test does.
  const mountTour = () => {
    localKey("tour");
    return mount();
  };

  it("reads storage once as it mounts, and picks up its place on the next mount", async () => {
    const { root, render } = mountTour();
    const storage = localStorageAdapter("tour");
    const load = vi.spyOn(storage, "load");
    await render(view(), { storage });
    await act(async () => buttonNamed("Next")!.click());
    expect(dialog()).toHaveTextContent("Second step");

    await render(view(), { storage });
    expect(load).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    const { render: remount } = addWaymarkRoot();
    await remount(view(), { storage });
    expect(load).toHaveBeenCalledTimes(2);
    expect(dialog()).toHaveTextContent("Second step");
  });

  it("shows a finished walkthrough again, the next time a page asks for it, once it is reset", async () => {
    const { render } = mountTour();
    localStorage.setItem("tour", record({ status: "finished", step: 2, collapsed: false }));
    const run = await render(view(), { storage: "tour" });
    expect(dialog()).toBeNull();

    await act(async () => run.reset(walkthrough));
    await render(null, { storage: "tour" });
    await render(view(), { storage: "tour" });
    expect(dialog()).toHaveTextContent("First step");
  });

  it.each([true, false])(
    "hydrates a server render, which has no document, then shows the stored step (portal %s)",
    async (portal) => {
      fakeFrames();
      localStorage.setItem(localKey("tour"), record({ status: "running", step: 1, collapsed: false }));
      const app = () => (
        <WaymarkRoot storage="tour" portal={portal}>
          {view()}
        </WaymarkRoot>
      );
      vi.stubGlobal("document", undefined);
      let server: string;
      try {
        server = renderToString(app());
      } finally {
        vi.unstubAllGlobals();
      }

      const page = addHost();
      let hydrated: Root | undefined;
      onTestFinished(() => act(async () => hydrated?.unmount()));
      page.innerHTML = server;
      const onRecoverableError = vi.fn();
      const error = vi.spyOn(console, "error");
      await act(async () => {
        hydrated = hydrateRoot(page, app(), { onRecoverableError });
      });

      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(dialog()).toHaveTextContent("Second step");
    },
  );

  it("shows nothing for a walkthrough storage says was finished", async () => {
    const { render } = mountTour();
    localStorage.setItem("tour", record({ status: "finished", step: 2, collapsed: false }));
    await render(view(), { storage: "tour" });
    expect(dialog()).toBeNull();
    expect(shade()).toBeNull();
  });
});

describe("WaymarkRoot with checklists", () => {
  const setup = () =>
    defineChecklists({
      tasks: {
        "create-deck": {
          title: "Create a deck",
          walkthrough: defineWalkthrough({
            id: "create-deck",
            steps: [{ content: "Open the decks page" }, { content: "Press new deck" }],
          }),
        },
        "read-tips": {
          title: "Read the tips",
          walkthrough: defineWalkthrough({ id: "read-tips", steps: [{ content: "Here are the tips" }] }),
        },
        "say-hello": { title: "Say hello" },
      },
      checklists: { home: ["create-deck", "read-tips", "say-hello"], decks: ["create-deck"] },
    });

  it("draws the walkthrough a task's Start opens, and finishes the task with it", async () => {
    const { render, frames } = mount();
    const run = await render(null);
    const home = run.checklist(setup().checklists.home);
    expect(dialog()).toBeNull();

    await act(async () => home.start("read-tips"));
    expect(dialog()).toHaveTextContent("Here are the tips");

    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toBeNull();
    expect(home.getSnapshot().open).toBeNull();
    expect(home.getSnapshot().tasks[1]!.status).toBe("done");
    expect(frames.size).toBe(0);
  });

  it("attaches its popover, so a click on it is not a click away", async () => {
    const { render } = mount();
    const run = await render(null);
    await act(async () => run.checklist(setup().checklists.home).start("read-tips"));

    await act(async () => {
      dialog()!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
      await Promise.resolve();
    });
    expect(dialog()).toHaveTextContent("Here are the tips");

    await clickAway();
    expect(dialog()).toBeNull();
    expect(beacon()).toBeInTheDocument();
  });

  it("draws a task's walkthrough with a custom popover, which can end it", async () => {
    const { render } = mount();
    const run = await render(null, {
      renderPopover: ({ currentStep, exit }) => (
        <button type="button" onClick={exit}>
          {currentStep.content}
        </button>
      ),
    });
    const home = run.checklist(setup().checklists.home);
    await act(async () => home.start("create-deck"));
    expect(dialog()).toHaveTextContent("Open the decks page");

    await act(async () => dialog()!.querySelector("button")!.click());
    expect(home.getSnapshot().open).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("draws a custom beacon for a task's walkthrough, and exits from it", async () => {
    const { render } = mount();
    const run = await render(null, {
      renderBeacon: ({ currentStep, exit }) => (
        <button type="button" onClick={exit}>
          Stop: {currentStep.content}
        </button>
      ),
    });
    await act(async () => run.checklist(setup().checklists.home).start("create-deck"));
    await clickAway();

    const custom = beaconAnchor()!.querySelector("button")!;
    expect(custom).toHaveTextContent("Stop: Open the decks page");
    await act(async () => custom.click());
    expect(run.getSnapshot().progress["create-deck"]).toMatchObject({ status: "exited" });
    expect(beaconAnchor()).toBeNull();
  });

  it("offers to skip the task being guided, in every checklist", async () => {
    const { render } = mount();
    const run = await render(null);
    const { checklists } = setup();
    await act(async () => run.checklist(checklists.home).start("create-deck"));
    await act(async () => buttonNamed("Skip task")!.click());
    expect(dialog()).toBeNull();
    expect(run.checklist(checklists.decks).getSnapshot().tasks[0]!.status).toBe("skipped");
    expect(run.checklist(checklists.home).getSnapshot().tasks[0]!.status).toBe("skipped");
  });

  it("passes an app's labels to the guided task's popover", async () => {
    const { render } = mount();
    const run = await render(null, { labels: { skipTask: "Aufgabe überspringen" } });
    await act(async () => run.checklist(setup().checklists.home).start("create-deck"));
    expect(buttonNamed("Aufgabe überspringen")).toBeDefined();
  });

  it("hands a custom popover the labels, the app's over the defaults", async () => {
    const { render } = mount();
    const renderPopover = vi.fn((_props: WalkthroughRenderProps) => null);
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Alone" }] });
    await render(<Walkthrough walkthrough={walkthrough} />, { labels: { next: "Weiter" }, renderPopover });
    const { labels } = renderPopover.mock.lastCall![0];
    expect([labels.next, labels.finish]).toEqual(["Weiter", "Finish"]);
  });

  it("offers no task skip to a walkthrough no task guides", async () => {
    const { render } = mount();
    const renderPopover = vi.fn((_props: WalkthroughRenderProps) => null);
    const walkthrough = defineWalkthrough({ id: "tour", steps: [{ content: "Alone" }] });
    await render(<Walkthrough walkthrough={walkthrough} />, { renderPopover });
    expect(renderPopover).toHaveBeenCalled();
    expect(renderPopover.mock.calls.every(([props]) => !("skipTask" in props))).toBe(true);
  });

  it("draws the task started over another, then the other's beacon once it ends", async () => {
    const { render } = mount();
    const run = await render(null);
    const home = run.checklist(setup().checklists.home);
    await act(async () => home.start("create-deck"));
    expect(dialog()).toHaveTextContent("Open the decks page");

    await act(async () => home.start("read-tips"));
    expect(dialog()).toHaveTextContent("Here are the tips");
    expect(beacon()).toBeNull();

    await act(async () => buttonNamed("Finish")!.click());
    expect(dialog()).toBeNull();
    await act(async () => beacon()!.click());
    expect(dialog()).toHaveTextContent("Open the decks page");
  });
});
