import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChecklistCheckbox,
  ChecklistPanel,
  ChecklistRoot,
  ChecklistTask,
  ChecklistTaskTitle,
  ChecklistTrigger,
  createChecklists,
  defineWalkthrough,
  Walkthrough,
  type AnyReactTask,
  type CoreChecklist,
} from "./index";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // The Walkthrough measures on frames; none of these tests need one to run.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

const guide = defineWalkthrough([{ content: "Create a deck" }]);

const setup = () =>
  createChecklists({
    context: { verified: false },
    tasks: {
      "create-deck": { title: "Create your first deck", walkthrough: guide },
      "read-tips": { title: "Read the tips" },
      "verify-email": {
        title: "Verify your email",
        toggleable: false,
        isComplete: (c) => c.verified,
      },
    },
    checklists: { home: ["create-deck", "read-tips", "verify-email"] },
  });

function Popover<TTask extends AnyReactTask>({
  checklist,
  portal,
}: {
  checklist: CoreChecklist<TTask>;
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
const running = (owner: ReturnType<typeof setup>) => owner.getSnapshot().active?.run.getSnapshot();

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
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
    expect(host).toContainElement(trigger());
    expect(panel()).toBeNull();

    await press(trigger());
    expect(panel()!.parentElement).toBe(document.body);

    await act(async () => root.render(<Popover checklist={owner.checklists.home} portal={false} />));
    expect(panel()!.parentElement).toBe(host);
  });

  it("place the panel against the trigger, and follow it when a container scrolls", async () => {
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
    let rect = { top: 100, bottom: 130, left: 200, right: 260, width: 60, height: 30, x: 200, y: 100 };
    vi.spyOn(trigger(), "getBoundingClientRect").mockImplementation(() => rect as DOMRect);

    await press(trigger());
    expect(panel()).toHaveAttribute("data-side", "below");
    expect(panel()!.style.top).toBe("138px");
    expect(panel()!.style.getPropertyValue("--waymark-available-height")).toBe(`${768 - 130 - 8 - 8}px`);

    rect = { ...rect, top: 50, bottom: 80, y: 50 };
    await act(async () => host.dispatchEvent(new Event("scroll")));
    expect(panel()!.style.top).toBe("88px");
  });

  it("open under a resting mouse, and stay open as it crosses from trigger to panel", async () => {
    vi.useFakeTimers();
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));

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
    vi.useFakeTimers();
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));

    await act(async () => pointer("pointerenter", trigger(), "touch"));
    await wait(1000);
    expect(panel()).toBeNull();
  });

  it("stay open after a press on the trigger until a press lands outside, or Escape", async () => {
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
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
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));

    await act(async () => trigger().click());
    expect(document.activeElement).toBe(panel());

    await act(async () =>
      panel()!.dispatchEvent(escape()),
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("close when one of its tasks starts, and mark the trigger while it runs", async () => {
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
    await press(trigger());

    await act(async () => owner.start("create-deck"));
    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute("data-running");

    await press(trigger());
    expect(task("Create your first deck")).toHaveAttribute("data-active");
    expect(task("Create your first deck")).toHaveAttribute("aria-current", "step");
  });

  it("stay closed when a task starts just after the pointer reached the panel", async () => {
    vi.useFakeTimers();
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
    await act(async () => pointer("pointerenter", trigger(), "mouse"));
    await wait(150);
    await act(async () => crossToPanel());

    await act(async () => owner.start("create-deck"));
    await wait(1000);
    expect(panel()).toBeNull();
  });

  it("closes again when a task replaces an already running task", async () => {
    const owner = createChecklists({
      tasks: {
        first: { title: "First task", walkthrough: guide },
        second: { title: "Second task", walkthrough: guide },
      },
    });
    await act(async () => root.render(<Popover checklist={owner.checklists.main} />));
    await press(trigger());
    await act(async () => owner.start("first"));
    expect(panel()).toBeNull();

    await press(trigger());
    await press(task("Second task").querySelector("button:last-child")!);
    expect(owner.getSnapshot().active?.task.id).toBe("second");
    expect(panel()).toBeNull();
  });

  it("do not count a click on them as a click away from a running walkthrough", async () => {
    const owner = setup();
    await act(async () =>
      root.render(
        <>
          <Walkthrough checklists={owner} />
          <Popover checklist={owner.checklists.home} />
        </>,
      ),
    );
    await act(async () => owner.start("create-deck"));

    await press(trigger());
    await press(task("Read the tips"));
    expect(running(owner)).toMatchObject({ collapsed: false });
  });

  it("keep Escape in the panel from also collapsing a running walkthrough", async () => {
    const owner = setup();
    await act(async () =>
      root.render(
        <>
          <Walkthrough checklists={owner} />
          <Popover checklist={owner.checklists.home} />
        </>,
      ),
    );
    await act(async () => owner.start("create-deck"));
    await press(trigger());

    await act(async () =>
      panel()!.dispatchEvent(escape()),
    );
    expect(panel()).toBeNull();
    expect(running(owner)).toMatchObject({ collapsed: false });

    await act(async () =>
      document.body.dispatchEvent(escape()),
    );
    expect(running(owner)).toMatchObject({ collapsed: true });
  });
});

describe("Checklist task parts", () => {
  it("name each checkbox by its task and mark every part with the task's status", async () => {
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
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
    const owner = setup();
    await act(async () => root.render(<Popover checklist={owner.checklists.home} />));
    await press(trigger());
    const verify = task("Verify your email");
    expect(verify.querySelector('[role="checkbox"]')).toBeNull();
    expect(verify).toHaveTextContent("To do");

    await act(async () => owner.update({ verified: true }));
    expect(task("Verify your email").querySelector('[aria-hidden="true"]')).toHaveAttribute(
      "data-status",
      "done",
    );
  });
});
