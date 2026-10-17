import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ChecklistCheckbox,
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTask,
  ChecklistTaskTitle,
  ChecklistTrigger,
  defineChecklists,
  defineWalkthrough,
  type AnyReactTask,
  type ChecklistDefinition,
  type Run,
} from "./index";
import { addWaymarkRoot } from "./test/root";
import { fakeTimers, freezeFrames } from "./test/time";

/** A root inside a WaymarkRoot, with frames that never run: none of these tests need a walkthrough to measure. */
const mount = () => {
  freezeFrames();
  return addWaymarkRoot();
};

type AppContext = { verified: boolean };
const context: AppContext = { verified: false };

const setup = () =>
  defineChecklists({
    tasks: {
      "create-deck": {
        title: "Create your first deck",
        walkthrough: defineWalkthrough({ id: "create-deck", steps: [{ content: "Create a deck" }] }),
      },
      "read-tips": { title: "Read the tips" },
      "verify-email": {
        title: "Verify your email",
        toggleable: false,
        isComplete: (c: AppContext) => c.verified,
      },
    },
    checklists: { home: ["create-deck", "read-tips", "verify-email"] },
  }).checklists.home;

function Popover({
  checklist,
  portal,
}: {
  checklist: ChecklistDefinition<AnyReactTask>;
  portal?: boolean;
}) {
  return (
    <ChecklistRoot checklist={checklist}>
      {({ snapshot, start }) => (
        <>
          <ChecklistTrigger>Getting started</ChecklistTrigger>
          <ChecklistPanel aria-label="Getting started" {...(portal === undefined ? {} : { portal })}>
            <ol>
              {snapshot.tasks.map((row) => (
                <ChecklistTask key={row.task.id} row={row}>
                  <ChecklistCheckbox />
                  <ChecklistTaskTitle>{row.task.title}</ChecklistTaskTitle>
                  <button type="button" onClick={() => start(row.task.id)}>
                    Show me
                  </button>
                </ChecklistTask>
              ))}
            </ol>
          </ChecklistPanel>
        </>
      )}
    </ChecklistRoot>
  );
}

const trigger = () => document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Getting started"]');
const task = (title: string) =>
  Array.from(panel()!.querySelectorAll("li")).find((li) => li.textContent.includes(title))!;
const progress = (run: Run) => run.getSnapshot().progress["create-deck"];

const pointer = (type: "pointerenter" | "pointerleave", target: Element, pointerType: string) => {
  const event = new MouseEvent(type);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
};
/** Cancelable, as a real key press is, so a handler's preventDefault takes. */
const escape = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
const crossToPanel = () => {
  pointer("pointerleave", trigger(), "mouse");
  pointer("pointerenter", panel()!, "mouse");
};
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
/** A pointer's click: `element.click()` has the keyboard's detail of 0. */
const press = (element: Element) =>
  act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
    await Promise.resolve();
  });

describe("ChecklistTrigger and ChecklistPanel", () => {
  it("keep the trigger where it was put and open the panel in the body", async () => {
    const { render, host } = mount();
    const home = setup();
    await render(<Popover checklist={home} />, { context });
    expect(host).toContainElement(trigger());
    expect(panel()).toBeNull();

    await press(trigger());
    expect(panel()!.parentElement).toBe(document.body);

    await render(<Popover checklist={home} portal={false} />, { context });
    expect(panel()!.parentElement).toBe(host);
  });

  it("open under a resting mouse, and stay open as it crosses from trigger to panel", async () => {
    const { render } = mount();
    fakeTimers();
    const home = setup();
    await render(<Popover checklist={home} />, { context });

    await act(async () => pointer("pointerenter", trigger(), "mouse"));
    await wait(100);
    await act(async () => pointer("pointerleave", trigger(), "mouse"));
    await wait(1000);
    expect(panel()).toBeNull();

    await act(async () => pointer("pointerenter", trigger(), "mouse"));
    await wait(149);
    expect(panel()).toBeNull();
    await wait(1);
    expect(panel()).not.toBeNull();

    await act(async () => crossToPanel());
    await wait(1000);
    expect(panel()).not.toBeNull();

    await act(async () => pointer("pointerleave", panel()!, "mouse"));
    await wait(299);
    expect(panel()).not.toBeNull();
    await wait(1);
    expect(panel()).toBeNull();
  });

  it("stay shut under a touch, which has no hover to end", async () => {
    const { render } = mount();
    fakeTimers();
    const home = setup();
    await render(<Popover checklist={home} />, { context });

    await act(async () => pointer("pointerenter", trigger(), "touch"));
    await wait(1000);
    expect(panel()).toBeNull();
  });

  it("stay open after a press on the trigger until a press lands outside, or Escape", async () => {
    const { render } = mount();
    const home = setup();
    await render(<Popover checklist={home} />, { context });
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await press(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", panel()!.id);

    await act(async () => task("Read the tips").dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(panel()).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(panel()).toBeNull();

    await press(trigger());
    await act(async () =>
      trigger().dispatchEvent(escape()),
    );
    expect(panel()).toBeNull();
  });

  it("move focus into a panel the keyboard opened, and back to the trigger on Escape", async () => {
    const { render } = mount();
    const home = setup();
    await render(<Popover checklist={home} />, { context });

    await act(async () => trigger().click());
    expect(document.activeElement).toBe(panel());

    await act(async () =>
      panel()!.dispatchEvent(escape()),
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("close when one of its tasks starts, and mark the trigger while it runs", async () => {
    const { render } = mount();
    const home = setup();
    const run = await render(<Popover checklist={home} />, { context });
    await press(trigger());

    await act(async () => run.checklist(home).start("create-deck"));
    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute("data-running");

    await press(trigger());
    expect(task("Create your first deck")).toHaveAttribute("data-open");
    expect(task("Create your first deck")).toHaveAttribute("aria-current", "step");
  });

  it("stay closed when a task starts just after the pointer reached the panel", async () => {
    const { render } = mount();
    fakeTimers();
    const home = setup();
    const run = await render(<Popover checklist={home} />, { context });
    await act(async () => pointer("pointerenter", trigger(), "mouse"));
    await wait(150);
    await act(async () => crossToPanel());

    await act(async () => run.checklist(home).start("create-deck"));
    await wait(1000);
    expect(panel()).toBeNull();
  });

  it("closes again when a task replaces an already running task", async () => {
    const { render } = mount();
    const { checklists } = defineChecklists({
      tasks: {
        first: { title: "First task", walkthrough: defineWalkthrough({ id: "first", steps: [{ content: "First" }] }) },
        second: { title: "Second task", walkthrough: defineWalkthrough({ id: "second", steps: [{ content: "Second" }] }) },
      },
    });
    const run = await render(<Popover checklist={checklists.main} />);
    await press(trigger());
    await act(async () => run.checklist(checklists.main).start("first"));
    expect(panel()).toBeNull();

    await press(trigger());
    await press(task("Second task").querySelector("button:last-child")!);
    expect(run.checklist(checklists.main).getSnapshot().open?.id).toBe("second");
    expect(panel()).toBeNull();
  });

  it("do not count a click on them as a click away from a running walkthrough", async () => {
    const { render } = mount();
    const home = setup();
    const run = await render(<Popover checklist={home} />, { context });
    await act(async () => run.checklist(home).start("create-deck"));

    await press(trigger());
    await press(task("Read the tips"));
    expect(progress(run)).toMatchObject({ status: "running", collapsed: false });
  });

  it("keep Escape in the panel from also collapsing a running walkthrough", async () => {
    const { render } = mount();
    const home = setup();
    const run = await render(<Popover checklist={home} />, { context });
    await act(async () => run.checklist(home).start("create-deck"));
    await press(trigger());

    await act(async () =>
      panel()!.dispatchEvent(escape()),
    );
    expect(panel()).toBeNull();
    expect(progress(run)).toMatchObject({ status: "running", collapsed: false });

    await act(async () =>
      document.body.dispatchEvent(escape()),
    );
    expect(progress(run)).toMatchObject({ status: "running", collapsed: true });
  });
});

describe("Checklist task parts", () => {
  it("mark every part of a task whose walkthrough is open, or set aside part way", async () => {
    const { render } = mount();
    const home = setup();
    const run = await render(<Popover checklist={home} />, { context });
    await act(async () => run.checklist(home).start("create-deck"));
    await press(trigger());
    const parts = () => [task("Create your first deck"), task("Create your first deck").querySelector('[role="checkbox"]')];
    for (const part of parts()) {
      expect(part).toHaveAttribute("data-open");
      expect(part).not.toHaveAttribute("data-in-progress");
    }

    await act(async () => run.act("collapse"));
    for (const part of parts()) {
      expect(part).not.toHaveAttribute("data-open");
      expect(part).toHaveAttribute("data-in-progress");
    }
  });

  it("name each checkbox by its task and mark every part with the task's status", async () => {
    const { render } = mount();
    const home = setup();
    await render(<Popover checklist={home} />, { context });
    await press(trigger());
    const box = task("Read the tips").querySelector('[role="checkbox"]')!;
    expect(box).toHaveAccessibleName("Read the tips");
    expect(box).toHaveAccessibleDescription("To do");
    expect(box).toHaveAttribute("aria-checked", "false");

    await press(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toHaveAccessibleDescription("Done");
    for (const part of [task("Read the tips"), box, task("Read the tips").querySelector("div")!]) {
      expect(part).toHaveAttribute("data-status", "done");
    }
  });

  it("give a task that is not toggleable a mark instead of a checkbox", async () => {
    const { render } = mount();
    const home = setup();
    await render(<Popover checklist={home} />, { context });
    await press(trigger());
    const verify = task("Verify your email");
    expect(verify.querySelector('[role="checkbox"]')).toBeNull();
    expect(verify).toHaveTextContent("To do");

    await render(<Popover checklist={home} />, { context: { verified: true } });
    expect(task("Verify your email").querySelector('[aria-hidden="true"]')).toHaveAttribute(
      "data-status",
      "done",
    );
  });
});
