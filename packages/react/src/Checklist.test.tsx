import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  Checklist,
  defineChecklists,
  defineWalkthrough,
  useChecklist,
  WaymarkRoot,
  type ChecklistLabels,
  type StoredRecord,
} from "./index";
import { addHost, localKey } from "./test/dom";
import { addWaymarkRoot } from "./test/root";
import { freezeFrames } from "./test/time";

type AppContext = { hasDeck: boolean; hasPhoto: boolean };
const context: AppContext = { hasDeck: false, hasPhoto: false };

const setup = () => {
  const openPicker = vi.fn();
  const onboarding = defineChecklists({
    tasks: {
      "create-deck": {
        title: "Create your first deck",
        description: "Decks group the cards you want to study.",
        walkthrough: defineWalkthrough({ id: "create-deck", steps: [{ content: "Create a deck" }] }),
        isComplete: (c: AppContext) => c.hasDeck,
      },
      "add-photo": {
        title: "Add a profile photo",
        action: { label: "Choose photo", onSelect: openPicker },
        isComplete: (c: AppContext) => c.hasPhoto,
      },
      "read-tips": {
        title: "Read the tips",
        walkthrough: defineWalkthrough({ id: "read-tips", steps: [{ content: "Here are the tips" }] }),
      },
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
  return { home: onboarding.checklists.home, openPicker };
};

/** A root inside a WaymarkRoot, with frames that never run: none of these tests need a walkthrough to measure. */
const mount = () => {
  freezeFrames();
  return addWaymarkRoot();
};

const rows = () => Array.from(document.querySelectorAll("li"));
const row = (title: string) => rows().find((li) => li.textContent.includes(title))!;
const BUTTON = "button:not([role=checkbox])";
const buttons = (li: HTMLElement) =>
  Array.from(li.querySelectorAll(BUTTON)).map((button) => button.textContent);
const box = (li: HTMLElement) => li.querySelector<HTMLButtonElement>('[role="checkbox"]');
const tick = (li: HTMLElement) => act(async () => box(li)!.click());
const click = (li: HTMLElement, label: string) =>
  act(async () => {
    Array.from(li.querySelectorAll<HTMLButtonElement>(BUTTON))
      .find((button) => button.textContent === label)!
      .click();
  });

describe("Checklist", () => {
  it("shows titles, descriptions, statuses, and the finished count, checked again as the root's context changes", async () => {
    const { render, host } = mount();
    const { home } = setup();
    await render(<Checklist checklist={home} />, { context });

    expect(host.querySelector('[role="group"]')).toHaveTextContent("0 of 5 done");
    expect(rows()).toHaveLength(5);
    expect(row("Create your first deck")).toHaveTextContent("Decks group the cards");
    expect(row("Create your first deck")).toHaveTextContent("To do");

    await render(<Checklist checklist={home} />, { context: { hasDeck: true, hasPhoto: false } });
    expect(row("Create your first deck")).toHaveTextContent("Done");
    expect(host.querySelector('[role="group"]')).toHaveTextContent("1 of 5 done");
  });

  it("shows one primary button according to the task's configuration", async () => {
    const { render } = mount();
    const { home, openPicker } = setup();
    const run = await render(<Checklist checklist={home} />, { context });

    expect(buttons(row("Read the tips"))).toEqual(["Show me", "Skip"]);
    // Action wins over the walkthrough button.
    expect(buttons(row("Add a profile photo"))).toEqual(["Choose photo", "Skip"]);
    // Neither: the box is the only way to complete it.
    expect(buttons(row("Understand sharing"))).toEqual(["Skip"]);
    expect(buttons(row("Say hello"))).toEqual(["Wave", "Skip"]);

    await click(row("Add a profile photo"), "Choose photo");
    expect(openPicker).toHaveBeenCalledOnce();
    expect(run.getSnapshot().open).toBeNull();
    expect(row("Add a profile photo")).toHaveTextContent("To do");

    await act(async () => run.checklist(home).markDone("read-tips"));
    expect(buttons(row("Read the tips"))).toEqual(["Show me again"]);
  });

  it("starts, skips, and ticks through the checklist's commands", async () => {
    const { render, host } = mount();
    const { home } = setup();
    const run = await render(<Checklist checklist={home} />, { context });

    await click(row("Read the tips"), "Show me");
    expect(run.checklist(home).getSnapshot().open?.id).toBe("read-tips");
    expect(row("Read the tips")).toHaveAttribute("aria-current", "step");
    expect(row("Read the tips").querySelector(BUTTON)).toBeDisabled();
    // The checklist draws no walkthrough; the root does.
    expect(host.querySelector('[role="group"] [role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent("Here are the tips");

    await tick(row("Understand sharing"));
    expect(row("Understand sharing")).toHaveTextContent("Done");

    await click(row("Say hello"), "Skip");
    expect(row("Say hello")).toHaveTextContent("Skipped");
    expect(buttons(row("Say hello"))).toEqual(["Wave"]);
    expect(host.querySelector('[role="group"]')).toHaveTextContent("2 of 5 done");
  });

  it("toggles a task with its box, unless the task opts out", async () => {
    const { render } = mount();
    const { checklists } = defineChecklists({
      tasks: {
        hello: { title: "Say hello" },
        verify: { title: "Verify your email", toggleable: false },
      },
    });
    await render(<Checklist checklist={checklists.main} />);
    const hello = box(row("Say hello"))!;
    expect(hello).toHaveAccessibleName("Say hello");
    expect(hello).toHaveAttribute("aria-checked", "false");

    await tick(row("Say hello"));
    expect(hello).toHaveAttribute("aria-checked", "true");
    expect(row("Say hello")).toHaveTextContent("Done");

    await tick(row("Say hello"));
    expect(row("Say hello")).toHaveTextContent("To do");

    await click(row("Say hello"), "Skip");
    expect(hello).toHaveAccessibleDescription("Skipped");
    await tick(row("Say hello"));
    expect(row("Say hello")).toHaveTextContent("To do");

    expect(box(row("Verify your email"))).toBeNull();
  });

  it("takes labels, styles, and a row renderer", async () => {
    const { render, host } = mount();
    const { home } = setup();
    const run = await render(
      <Checklist
        checklist={home}
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
      { context },
    );

    const panel = host.querySelector<HTMLElement>('[role="group"]')!;
    expect(panel.style.background).toBe("black");
    expect(rows()[0]!.style.padding).toBe("0px");
    expect(buttons(row("Custom read-tips"))).toEqual(["Custom read-tips todo"]);
    expect(row("Understand sharing").querySelector("button")).toBeNull();

    await click(row("Custom read-tips"), "Custom read-tips todo");
    expect(run.checklist(home).getSnapshot().open?.id).toBe("read-tips");
  });

  it("tells a row renderer whether its task's walkthrough is open or set aside part way", async () => {
    const { render } = mount();
    const { home } = setup();
    const run = await render(
      <Checklist
        checklist={home}
        renderRow={({ task, open, inProgress }) => `${task.id}${open ? " open" : ""}${inProgress ? " in progress" : ""}`}
      />,
      { context },
    );
    const list = run.checklist(home);

    await act(async () => list.start("create-deck"));
    expect(row("create-deck").textContent).toBe("create-deck open");

    await act(async () => list.start("read-tips"));
    expect(row("create-deck").textContent).toBe("create-deck in progress");
    expect(row("read-tips").textContent).toBe("read-tips open");
  });

  it("uses default labels only for the rows it renders itself", async () => {
    const { render } = mount();
    const { home } = setup();
    await render(<Checklist checklist={home} labels={{ start: "Guide me", skip: "Later" }} />, { context });
    expect(buttons(row("Read the tips"))).toEqual(["Guide me", "Later"]);
  });

  it("uses the default for a label passed as undefined", async () => {
    const { render } = mount();
    const { home } = setup();
    // ReactNode includes undefined, so even exactOptionalPropertyTypes allows this.
    const labels: Partial<ChecklistLabels> = { start: undefined, skip: "Later" };
    await render(<Checklist checklist={home} labels={labels} />, { context });
    expect(buttons(row("Read the tips"))).toEqual(["Show me", "Later"]);
  });
});

describe("useChecklist", () => {
  it("gives custom UI the same snapshot and commands", async () => {
    const { render, host } = mount();
    const { home } = setup();
    const seen: number[] = [];
    function Panel() {
      const { snapshot, markDone } = useChecklist(home);
      seen.push(snapshot.finishedCount);
      return (
        <button type="button" onClick={() => markDone("say-hello")}>
          {snapshot.finishedCount} finished
        </button>
      );
    }
    const run = await render(<Panel />, { context });
    expect(host).toHaveTextContent("0 finished");

    await act(async () => host.querySelector("button")!.click());
    expect(host).toHaveTextContent("1 finished");

    // Alters nothing visible, so the snapshot keeps its identity and nothing re-renders.
    seen.length = 0;
    await act(async () => run.setContext({ hasDeck: false, hasPhoto: false }));
    expect(seen).toEqual([]);
  });
});

describe("Checklist with storage", () => {
  /** The record an earlier visit left in storage, cleared when the test finishes. */
  const save = (tasks: StoredRecord["tasks"]) => {
    localStorage.setItem(localKey("setup"), JSON.stringify({ version: 1, walkthroughs: {}, tasks } satisfies StoredRecord));
  };

  const { checklists } = defineChecklists({
    tasks: { hello: { title: "Say hello" }, invite: { title: "Invite a friend" } },
  });
  const app = () => (
    <WaymarkRoot storage="setup">
      <Checklist checklist={checklists.main} />
    </WaymarkRoot>
  );

  it("hydrates a server render, which could not read storage, then shows what storage holds", async () => {
    save({ hello: "done" });
    const server = renderToString(app());
    expect(server).toContain("0<!-- --> of <!-- -->2<!-- --> done");
    expect(server).toContain('aria-busy="true"');

    const host = addHost();
    host.innerHTML = server;
    const onRecoverableError = vi.fn();
    let hydrated: Root | undefined;
    await act(async () => {
      hydrated = hydrateRoot(host, app(), { onRecoverableError });
    });
    onTestFinished(() => act(async () => hydrated?.unmount()));

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(host).toHaveTextContent("1 of 2 done");
    expect(host.querySelector('[role="group"]')).toHaveAttribute("aria-busy", "false");
  });
});
