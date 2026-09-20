import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Checklist, createChecklists, defineWalkthrough, useChecklist } from "./index";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

const guide = defineWalkthrough([{ content: "Create a deck" }]);

const setup = () => {
  const openPicker = vi.fn();
  const owner = createChecklists({
    context: { hasDeck: false, hasPhoto: false },
    tasks: {
      "create-deck": {
        title: "Create your first deck",
        description: "Decks group the cards you want to study.",
        walkthrough: guide,
        isComplete: (c) => c.hasDeck,
      },
      "add-photo": {
        title: "Add a profile photo",
        action: { label: "Choose photo", onSelect: openPicker },
        isComplete: (c) => c.hasPhoto,
      },
      "read-tips": { title: "Read the tips", walkthrough: guide },
      "understand-sharing": {
        title: "Understand sharing",
        description: "Your decks stay private until you share them.",
      },
      "say-hello": { title: "Say hello", action: { label: "Wave", onSelect: openPicker } },
    },
    checklists: {
      home: ["create-deck", "add-photo", "read-tips", "understand-sharing", "say-hello"],
    },
  });
  return { owner, openPicker };
};

const rows = () => Array.from(host.querySelectorAll("li"));
const row = (title: string) => rows().find((li) => li.textContent?.includes(title))!;
const buttons = (li: HTMLElement) =>
  Array.from(li.querySelectorAll("button")).map((button) => button.textContent);
const click = (li: HTMLElement, label: string) =>
  act(async () => {
    Array.from(li.querySelectorAll("button"))
      .find((button) => button.textContent === label)!
      .click();
  });

describe("Checklist", () => {
  it("shows titles, descriptions, statuses, and the finished count", async () => {
    const { owner } = setup();
    await act(async () => root.render(<Checklist checklist={owner.checklists.home} />));

    expect(host.querySelector('[role="group"]')).toHaveTextContent("0 of 5 done");
    expect(rows()).toHaveLength(5);
    expect(row("Create your first deck")).toHaveTextContent("Decks group the cards");
    expect(row("Create your first deck")).toHaveTextContent("To do");

    await act(async () => owner.update({ hasDeck: true, hasPhoto: false }));
    expect(row("Create your first deck")).toHaveTextContent("Done");
    expect(host.querySelector('[role="group"]')).toHaveTextContent("1 of 5 done");
  });

  it("shows one primary button according to the task's configuration", async () => {
    const { owner, openPicker } = setup();
    await act(async () => root.render(<Checklist checklist={owner.checklists.home} />));

    // Walkthrough only: start, then replay once done. Never manual completion.
    expect(buttons(row("Read the tips"))).toEqual(["Show me", "Skip"]);
    // Action wins over the walkthrough button; a condition means no manual completion.
    expect(buttons(row("Add a profile photo"))).toEqual(["Choose photo", "Skip"]);
    // Neither: manual completion acknowledges the information.
    expect(buttons(row("Understand sharing"))).toEqual(["Mark as done", "Skip"]);
    // Action without walkthrough or condition still offers manual completion.
    expect(buttons(row("Say hello"))).toEqual(["Wave", "Mark as done", "Skip"]);

    await click(row("Add a profile photo"), "Choose photo");
    expect(openPicker).toHaveBeenCalledOnce();
    expect(owner.getSnapshot().active).toBeNull();
    expect(row("Add a profile photo")).toHaveTextContent("To do");

    await act(async () => owner.markDone("read-tips"));
    expect(buttons(row("Read the tips"))).toEqual(["Show me again"]);
  });

  it("starts, skips, and marks done through the view's commands", async () => {
    const { owner } = setup();
    await act(async () => root.render(<Checklist checklist={owner.checklists.home} />));

    await click(row("Read the tips"), "Show me");
    expect(owner.getSnapshot().active?.task.id).toBe("read-tips");
    expect(row("Read the tips")).toHaveAttribute("aria-current", "step");
    expect(row("Read the tips").querySelector("button")).toBeDisabled();
    // Views never draw guidance.
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await click(row("Understand sharing"), "Mark as done");
    expect(row("Understand sharing")).toHaveTextContent("Done");

    await click(row("Say hello"), "Skip");
    expect(row("Say hello")).toHaveTextContent("Skipped");
    expect(buttons(row("Say hello"))).toEqual(["Wave"]);
    expect(host.querySelector('[role="group"]')).toHaveTextContent("2 of 5 done");
  });

  it("takes labels, styles, and a row renderer", async () => {
    const { owner } = setup();
    await act(async () =>
      root.render(
        <Checklist
          checklist={owner.checklists.home}
          style={{ background: "black" }}
          rowStyle={{ padding: 0 }}
          labels={{ start: "Guide me", skip: "Later" }}
          renderRow={({ task, status, start }) =>
            task.id === "read-tips" ? (
              <button type="button" onClick={() => start(task.id)}>
                Custom {task.id} {status}
              </button>
            ) : (
              task.title
            )
          }
        />,
      ),
    );

    const panel = host.querySelector<HTMLElement>('[role="group"]')!;
    expect(panel.style.background).toBe("black");
    expect(rows()[0]!.style.padding).toBe("0px");
    expect(buttons(row("Custom read-tips"))).toEqual(["Custom read-tips todo"]);
    expect(row("Understand sharing").querySelector("button")).toBeNull();

    await click(row("Custom read-tips"), "Custom read-tips todo");
    expect(owner.getSnapshot().active?.task.id).toBe("read-tips");
  });

  it("uses default labels only for the rows it renders itself", async () => {
    const { owner } = setup();
    await act(async () =>
      root.render(
        <Checklist checklist={owner.checklists.home} labels={{ start: "Guide me", skip: "Later" }} />,
      ),
    );
    expect(buttons(row("Read the tips"))).toEqual(["Guide me", "Later"]);
  });
});

describe("useChecklist", () => {
  it("gives custom UI the same snapshot and commands", async () => {
    const { owner } = setup();
    const seen: number[] = [];
    function Panel() {
      const { snapshot, markDone } = useChecklist(owner.checklists.home);
      seen.push(snapshot.finishedCount);
      return (
        <button type="button" onClick={() => markDone("say-hello")}>
          {snapshot.finishedCount} finished
        </button>
      );
    }
    await act(async () => root.render(<Panel />));
    expect(host).toHaveTextContent("0 finished");

    await act(async () => host.querySelector("button")!.click());
    expect(host).toHaveTextContent("1 finished");

    // A change that alters nothing visible does not re-render: the snapshot identity is unchanged.
    seen.length = 0;
    await act(async () => owner.update({ hasDeck: false, hasPhoto: false }));
    expect(seen).toEqual([]);
  });
});
