import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { defineWalkthrough, Walkthrough } from "./index";
import { addWaymark, centre, onScreen, pastEdges, render, resize, settle } from "./test/browser";

const dialog = async () => {
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await settle();
  return page.getByRole("dialog").element();
};

const collapse = async () => {
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await settle();
};

const beacon = () => page.getByRole("button", { name: "Resume walkthrough", exact: true });

describe("popover", () => {
  it("stays on screen when the viewport narrows under it", async () => {
    addWaymark({ left: "20px", top: "20px" });
    const walkthrough = defineWalkthrough([
      { waymark: "target", scroll: "never", preferredPlacement: "right", content: "This instruction should stay beside the page element." },
    ]);
    render(<Walkthrough walkthrough={walkthrough} waymarkPadding={0} />);
    expect(pastEdges(await dialog())).toEqual(onScreen);

    await resize(320, 600);
    await settle();
    expect(pastEdges(await dialog())).toEqual(onScreen);
  });

  it("stays on screen when its own content grows", async () => {
    addWaymark({ left: "400px", top: "450px" });
    const walkthrough = defineWalkthrough([{ waymark: "target", scroll: "never", content: "Unused: the popover is custom." }]);
    render(
      <Walkthrough walkthrough={walkthrough} waymarkPadding={0} renderPopover={({ advance }) => <GrowingContent advance={advance} />} />,
    );
    expect(pastEdges(await dialog())).toEqual(onScreen);

    await page.getByRole("button", { name: "Expand content" }).click();
    await settle();
    expect(pastEdges(await dialog())).toEqual(onScreen);
    expect(pastEdges(page.getByRole("button", { name: "Finish walkthrough" }).element())).toEqual(onScreen);

    await page.getByRole("button", { name: "Finish walkthrough" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays centred without a Waymark as the viewport resizes", async () => {
    const walkthrough = defineWalkthrough([{ content: "General guidance should follow the viewport." }]);
    render(<Walkthrough walkthrough={walkthrough} />);
    expect(centre(await dialog())).toEqual({ x: 450, y: 300 });

    await resize(320, 480);
    await settle();
    expect(centre(await dialog())).toEqual({ x: 160, y: 240 });
  });

  it("stays on its Waymark, and so does the beacon, when an ancestor of the Walkthrough is transformed", async () => {
    const waymark = addWaymark({ left: "20px", top: "20px" });
    const walkthrough = defineWalkthrough([{ waymark: "target", scroll: "never", preferredPlacement: "below", content: "Below the page element." }]);
    const host = render(<Walkthrough walkthrough={walkthrough} waymarkPadding={0} />);
    const before = (await dialog()).getBoundingClientRect();
    expect(before.top - waymark.getBoundingClientRect().bottom).toBe(8);

    host.style.transform = "translate(100px, 100px)";
    await settle();
    const target = waymark.getBoundingClientRect();
    const after = (await dialog()).getBoundingClientRect();
    expect(after.top - target.bottom).toBe(8);
    expect(after.left).toBe(before.left);
    const shade = document.querySelector("[data-waymark-shade]")!.getBoundingClientRect();
    expect({ top: shade.top, left: shade.left }).toEqual({ top: target.top, left: target.left });

    await collapse();
    expect(centre(beacon().element())).toEqual({ x: target.right, y: target.top });
  });
});

describe("beacon", () => {
  it("follows the bottom centre of the screen as the viewport resizes", async () => {
    const walkthrough = defineWalkthrough([{ content: "General guidance" }]);
    render(<Walkthrough walkthrough={walkthrough} />);
    await dialog();
    await collapse();
    expect(centre(beacon().element())).toEqual({ x: 450, y: 568 });

    await resize(320, 480);
    await settle();
    expect(pastEdges(beacon().element())).toEqual(onScreen);
    expect(centre(beacon().element())).toEqual({ x: 160, y: 448 });

    await beacon().click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
  });

  it("keeps the default beacon, its pulse included, on screen for a Waymark in the screen's corner", async () => {
    addWaymark({ right: "0px", top: "0px" });
    const walkthrough = defineWalkthrough([{ waymark: "target", scroll: "never", content: "Help lives here" }]);
    render(<Walkthrough walkthrough={walkthrough} />);
    await dialog();
    await collapse();

    // The button is as wide as the pulse at full scale, so it fitting means the pulse fits.
    expect(pastEdges(beacon().element())).toEqual(onScreen);
  });

  it("keeps a custom beacon wider than the default whole on screen", async () => {
    addWaymark({ right: "0px", top: "0px" });
    const walkthrough = defineWalkthrough([{ waymark: "target", scroll: "never", content: "Help lives here" }]);
    render(
      <Walkthrough
        walkthrough={walkthrough}
        renderBeacon={({ resume }) => (
          <button type="button" onClick={resume} style={{ padding: "8px 24px" }}>
            Carry on with help
          </button>
        )}
      />,
    );
    await dialog();
    await collapse();

    expect(pastEdges(page.getByRole("button", { name: "Carry on with help" }).element())).toEqual(onScreen);
  });
});

function GrowingContent({ advance }: { advance: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ width: 300, height: expanded ? 300 : 40, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <button type="button" onClick={() => setExpanded(true)}>Expand content</button>
      {expanded && <p>The child grew without changing the walkthrough or its waymark.</p>}
      {expanded && <button type="button" onClick={advance}>Finish walkthrough</button>}
    </div>
  );
}
