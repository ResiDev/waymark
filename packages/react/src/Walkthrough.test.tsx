import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineWalkthrough, Walkthrough } from "./index";

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

describe("Walkthrough", () => {
  it("does no work while inactive", async () => {
    const walkthrough = defineWalkthrough([{ content: "Hidden" }]);
    await act(async () => {
      root.render(<Walkthrough active={false} walkthrough={walkthrough} />);
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(frames.size).toBe(0);
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

    const next = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Next (2 of 3)",
    )!;
    await act(async () => next.click());
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
        advance: {
          when: { event: "change" },
          then: "unlock",
        },
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

  it("turns an outside click into a resumable Collapsed run", async () => {
    addTarget("panel", "Panel");
    const walkthrough = defineWalkthrough([
      { waymark: "panel", content: "Use this panel" },
    ]);
    await act(async () => root.render(<Walkthrough walkthrough={walkthrough} />));

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 }),
      );
      await Promise.resolve();
    });

    const beacon = document.querySelector(
      'button[aria-label="Resume walkthrough"]',
    ) as HTMLButtonElement;
    expect(beacon).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => beacon.click());
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      "Use this panel",
    );
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

    const finish = document.querySelector('[role="dialog"] button:last-child');
    await act(async () => (finish as HTMLButtonElement).click());

    expect(phases).toEqual(["advance:completed", "finish:completed"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(target).not.toHaveAttribute("aria-haspopup");
    expect(frames.size).toBe(0);
  });
});
