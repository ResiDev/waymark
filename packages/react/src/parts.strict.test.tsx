import { act, StrictMode } from "react";
import { expect, it, vi } from "vitest";
import {
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTrigger,
  defineChecklists,
  defineWalkthrough,
  WaymarkRoot,
} from "./index";
import { addRoot } from "./test/dom";
import { fakeTimers } from "./test/time";

// In a file of its own: the lost close showed only when nothing had rendered before it.
it("closes when a task starts from inside the panel, under StrictMode and a WaymarkRoot", async () => {
  // Timers before the frame spy, as when the bug showed. Alone in its file, so the fake clock
  // the spy's restore leaves behind reaches no other test.
  fakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const { root } = addRoot();
  const { checklists } = defineChecklists({
    tasks: {
      tour: { title: "Take the tour", walkthrough: defineWalkthrough({ id: "tour", steps: [{ content: "Hello" }] }) },
    },
    checklists: { home: ["tour"] },
  });

  await act(async () =>
    root.render(
      <StrictMode>
        <WaymarkRoot>
          <ChecklistRoot checklist={checklists.home}>
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
        </WaymarkRoot>
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

  expect(document.querySelector('[role="dialog"][aria-label="Step 1 of 1"]')).toHaveTextContent("Hello");
  expect(panel()).toBeNull();
});
