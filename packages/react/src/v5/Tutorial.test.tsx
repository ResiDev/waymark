import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineTutorial, Tutorial } from "./index";

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

const addTarget = (waymark: string, label: string): HTMLButtonElement => {
  const target = document.createElement("button");
  target.dataset.waymark = waymark;
  target.textContent = label;
  target.getBoundingClientRect = () => targetRect;
  document.body.insertBefore(target, host);
  return target;
};

describe("Tutorial", () => {
  it("does no work while inactive", async () => {
    const tutorial = defineTutorial([{ content: "Hidden" }]);
    await act(async () => {
      root.render(<Tutorial active={false} tutorial={tutorial} />);
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(frames.size).toBe(0);
  });

  it("renders the default view and advances after a Waymark click", async () => {
    const target = addTarget("save", "Save");
    const tutorial = defineTutorial([
      { waymark: "save", advance: "click", content: "Save the document" },
      { content: "The document is saved" },
    ]);

    await act(async () => {
      root.render(<Tutorial tutorial={tutorial} />);
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

  it("renders a closed Advance gate until its condition is met", async () => {
    const target = addTarget("name", "Name");
    const tutorial = defineTutorial([
      {
        waymark: "name",
        content: "Enter a name",
        advance: {
          when: { event: "change" },
          then: "unlock",
        },
      },
      { content: "Named" },
    ]);

    await act(async () => root.render(<Tutorial tutorial={tutorial} />));
    const next = document.querySelector("button[disabled]");
    expect(next).toHaveTextContent("Next");

    await act(async () => {
      target.dispatchEvent(new Event("change"));
      await Promise.resolve();
    });

    expect(document.querySelector("button[disabled]")).toBeNull();
  });

  it("turns an outside click into a resumable Collapsed run", async () => {
    addTarget("panel", "Panel");
    const tutorial = defineTutorial([
      { waymark: "panel", content: "Use this panel" },
    ]);
    await act(async () => root.render(<Tutorial tutorial={tutorial} />));

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 }),
      );
      await Promise.resolve();
    });

    const beacon = document.querySelector(
      'button[aria-label="Resume tutorial"]',
    ) as HTMLButtonElement;
    expect(beacon).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => beacon.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "Use this panel",
    );
  });

  it("supports one custom popover seam", async () => {
    const tutorial = defineTutorial([{ content: "Payload" }]);
    await act(async () => {
      root.render(
        <Tutorial
          tutorial={tutorial}
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

  it("emits completion after the committed terminal state and cleans up", async () => {
    const target = addTarget("finish", "Finish target");
    const phases: string[] = [];
    const tutorial = defineTutorial([
      { waymark: "finish", content: "Last step" },
    ]);
    await act(async () => {
      root.render(
        <Tutorial
          tutorial={tutorial}
          onEvent={(event) => {
            if (event.type === "advance" || event.type === "finish") {
              phases.push(`${event.type}:${event.snapshot.phase}`);
            }
          }}
        />,
      );
    });

    const finish = document.querySelector('[role="dialog"] button:last-child');
    await act(async () => (finish as HTMLButtonElement).click());

    expect(phases).toEqual(["advance:completed", "finish:completed"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(frames.size).toBe(0);
  });
});
