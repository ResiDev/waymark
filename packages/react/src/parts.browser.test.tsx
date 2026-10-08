import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { ChecklistPanel, ChecklistRoot, ChecklistTrigger, createChecklists } from "./index";
import { onScreen, pastEdges, render, renderInScroller } from "./test/browser";

const owner = () =>
  createChecklists({
    context: {},
    tasks: { "read-tips": { title: "Read the tips" } },
    checklists: { home: ["read-tips"] },
  });

describe("ChecklistPanel", () => {
  it("sits against its trigger, and follows it when a container scrolls", async () => {
    const scroller = renderInScroller(
      <ChecklistRoot checklist={owner().checklists.home}>
        {() => (
          <>
            <ChecklistTrigger>Getting started</ChecklistTrigger>
            <ChecklistPanel aria-label="Getting started">Tips</ChecklistPanel>
          </>
        )}
      </ChecklistRoot>,
    );
    const trigger = page.getByRole("button", { name: "Getting started" });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Getting started" });
    await expect.element(panel).toHaveAttribute("data-side", "below");
    const gap = () => panel.element().getBoundingClientRect().top - trigger.element().getBoundingClientRect().bottom;
    expect(gap()).toBe(8);
    expect(panel.element().style.getPropertyValue("--waymark-available-height")).toBe(
      `${window.innerHeight - trigger.element().getBoundingClientRect().bottom - 8 - 8}px`,
    );

    const before = trigger.element().getBoundingClientRect().top;
    scroller.scrollTop = 50;
    await expect.poll(() => trigger.element().getBoundingClientRect().top).toBe(before - 50);
    await expect.poll(gap).toBe(8);
  });

  it("opens above its trigger when there is no room below, and stays on screen", async () => {
    render(
      <div style={{ position: "fixed", left: 20, bottom: 10 }}>
        <ChecklistRoot checklist={owner().checklists.home}>
          {() => (
            <>
              <ChecklistTrigger>Getting started</ChecklistTrigger>
              <ChecklistPanel aria-label="Getting started">Tips</ChecklistPanel>
            </>
          )}
        </ChecklistRoot>
      </div>,
    );
    const trigger = page.getByRole("button", { name: "Getting started" });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Getting started" });
    await expect.element(panel).toHaveAttribute("data-side", "above");
    const triggerTop = trigger.element().getBoundingClientRect().top;
    expect(triggerTop - panel.element().getBoundingClientRect().bottom).toBe(8);
    expect(panel.element().style.getPropertyValue("--waymark-available-height")).toBe(`${triggerTop - 8 - 8}px`);
    expect(pastEdges(panel.element())).toEqual(onScreen);
  });
});
