import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTrigger,
  createChecklists,
  defineWalkthrough,
  Walkthrough,
} from "./index";

// In a file of its own: the lost close showed only when nothing had rendered before it.
it("closes when a task starts from inside the panel, under StrictMode and a renderer", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const owner = createChecklists({
    tasks: { tour: { title: "Take the tour", walkthrough: defineWalkthrough([{ content: "Hello" }]) } },
    checklists: { home: ["tour"] },
  });

  await act(async () =>
    root.render(
      <StrictMode>
        <Walkthrough checklists={owner} />
        <ChecklistRoot checklist={owner.checklists.home}>
          {({ start }) => (
            <>
              <ChecklistTrigger>Getting started</ChecklistTrigger>
              <ChecklistPanel aria-label="Getting started">
                <button type="button" onClick={() => start("tour")}>
                  Show me
                </button>
              </ChecklistPanel>
            </>
          )}
        </ChecklistRoot>
      </StrictMode>,
    ),
  );
  const panel = () => document.querySelector('[aria-label="Getting started"][role="dialog"]');
  const pointer = (type: string, target: Element) => {
    const event = new MouseEvent(type);
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    target.dispatchEvent(event);
  };
  const trigger = document.querySelector("button[aria-expanded]")!;

  await act(async () => pointer("pointerenter", trigger));
  await act(async () => vi.advanceTimersByTime(200));
  await act(async () => pointer("pointerleave", trigger));
  await act(async () => pointer("pointerenter", panel()!));
  await act(async () => vi.advanceTimersByTime(600));
  await act(async () => {
    panel()!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await Promise.resolve();
  });
  await act(async () => vi.advanceTimersByTime(1000));

  expect(owner.getSnapshot().active?.task.id).toBe("tour");
  expect(panel()).toBeNull();

  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
