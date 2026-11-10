// Each rule Tasks.tla found broken, reproduced on the real Run, and now fixed.
import { describe, expect, it, vi } from "vitest";
import { defineChecklists } from "../../src/checklists/checklists";
import type { AnyTask, Checklist } from "../../src/checklists/types";
import { createRun } from "../../src/run/run";
import type { WaymarkEvent } from "../../src/run/types";
import type { SavePartialAdapter } from "../../src/storage/adapter";
import { applyChanges } from "../../src/storage/records";
import type { StoredRecord } from "../../src/storage/records";
import { connected } from "../../src/test/run";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";

const tips = defineWalkthrough({ id: "tips", steps: [{}] });
const other = defineWalkthrough({ id: "other", steps: [{}] });

const onboarding = defineChecklists({
  tasks: {
    "read-tips": { walkthrough: tips },
    invite: { isComplete: (context: { invited: boolean }) => context.invited },
  },
  checklists: { home: ["read-tips", "invite"], tipsOnly: ["read-tips"] },
});

const elsewhere = defineChecklists({ tasks: { hello: {} } });

/** One record that several tabs share: each tab's save is heard by every other tab, at once. */
function sharedStorage() {
  let stored: unknown = null;
  const listeners = new Set<(record: StoredRecord | null) => void>();
  const tab = () => {
    let mine: ((record: StoredRecord | null) => void) | undefined;
    return {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it loads.
      load: () => stored as StoredRecord | null,
      savePartial: (changes) => {
        stored = applyChanges(stored, changes);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what applyChanges returned.
        for (const listener of listeners) if (listener !== mine) listener(stored as StoredRecord | null);
      },
      subscribe: (listener: (record: StoredRecord | null) => void) => {
        mine = listener;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies SavePartialAdapter;
  };
  return { tab, stored: () => stored };
}

const mounted = <TTask extends AnyTask>(checklist: Checklist<TTask>) => {
  checklist.subscribe(() => {});
  return checklist;
};

const statusOf = <TTask extends AnyTask>(checklist: Checklist<TTask>, id: string) =>
  checklist.getSnapshot().tasks.find((row) => row.task.id === id)?.status;

const said = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.map(([event]) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- onEvent gets WaymarkEvents.
    const e = event as WaymarkEvent;
    return "task" in e ? `${e.type}:${e.task.id}` : "checklist" in e ? `${e.type}:${e.checklist}` : e.type;
  });

describe("a task ticked on hearing another tab", () => {
  // Tasks.tla SavedMatchesMemory
  it("is saved", () => {
    const storage = sharedStorage();
    const tabA = connected({ storage: storage.tab() });
    const tabB = connected({ storage: storage.tab() });
    const home = mounted(tabB.checklist(onboarding.checklists.home));

    // Tab A shows no checklist. Tab B hears tips start, and sets it aside.
    tabA.start(tips);
    expect(tabB.getSnapshot().progress["tips"]).toMatchObject({ status: "running", collapsed: true });
    tabA.act("advance");
    expect(storage.stored()).toMatchObject({ walkthroughs: { tips: { status: "finished" } } });
    expect(statusOf(home, "read-tips")).toBe("done");

    expect(storage.stored()).toMatchObject({ tasks: { "read-tips": "done" } });
  });

  // Tasks.tla DoneLeavesOnlyByHand
  it("stays done when another tab saves something else, and after a reload", () => {
    const storage = sharedStorage();
    const tabA = connected({ storage: storage.tab() });
    const tabB = connected({ storage: storage.tab() });
    const home = mounted(tabB.checklist(onboarding.checklists.home));
    tabA.start(tips);
    tabA.act("advance");
    expect(statusOf(home, "read-tips")).toBe("done");

    tabA.start(other);
    const reloaded = mounted(connected({ storage: storage.tab() }).checklist(onboarding.checklists.home));
    expect([statusOf(home, "read-tips"), statusOf(reloaded, "read-tips")]).toEqual(["done", "done"]);
  });
});

// Tasks.tla DoneOnFinish, and thread 7's decision.
it("ticks a task whose walkthrough finished before its checklist mounted, and announces it", () => {
  const onEvent = vi.fn();
  const run = createRun({ onEvent });
  run.start(tips);
  run.act("advance");
  expect(run.getSnapshot().progress["tips"]).toMatchObject({ status: "finished" });

  const tipsOnly = mounted(run.checklist(onboarding.checklists.tipsOnly));
  expect(statusOf(tipsOnly, "read-tips")).toBe("done");
  expect(said(onEvent)).toEqual(expect.arrayContaining(["taskComplete:read-tips", "checklistComplete:tipsOnly"]));
});

// Tasks.tla ConditionTicks: GLOSSARY.md "Reopened task".
it("ticks a task unticked while its condition was false, once the condition comes true", () => {
  const run = createRun({ context: { invited: false } });
  const home = mounted(run.checklist(onboarding.checklists.home));
  home.markDone("invite");
  home.markTodo("invite");
  expect(statusOf(home, "invite")).toBe("todo");

  run.setContext({ invited: true });
  expect(statusOf(home, "invite")).toBe("done");
});

// Tasks.tla SkippedBecomesDone: GLOSSARY.md "Skipped task".
it("leaves a skipped task as it was when an unrelated checklist mounts", () => {
  const run = createRun({ context: { invited: true } });
  const home = mounted(run.checklist(onboarding.checklists.home));
  expect(statusOf(home, "invite")).toBe("done");
  home.markTodo("invite");
  home.skip("invite");
  const afterSkip = statusOf(home, "invite");

  mounted(run.checklist(elsewhere.checklists.main));
  expect(statusOf(home, "invite")).toBe(afterSkip);
});

// Tasks.tla TodoLeavesOnlyByCause: what a mount that ticks finished walkthroughs must not undo.
it("keeps a task the user unticked todo when its checklist mounts again after a reload", () => {
  const storage = sharedStorage();
  const first = connected({ storage: storage.tab() });
  first.start(tips);
  first.act("advance");
  const tipsOnly = mounted(first.checklist(onboarding.checklists.tipsOnly));
  expect(statusOf(tipsOnly, "read-tips")).toBe("done");
  tipsOnly.markTodo("read-tips");

  const home = mounted(connected({ storage: storage.tab() }).checklist(onboarding.checklists.home));
  expect(statusOf(home, "read-tips")).toBe("todo");
});

// Thread 7: an untick lasts until the walkthrough runs again.
it("ticks a task unticked and then run again, when its checklist mounts after a reload", () => {
  const storage = sharedStorage();
  const first = connected({ storage: storage.tab() });
  first.start(tips);
  first.act("advance");
  mounted(first.checklist(onboarding.checklists.tipsOnly)).markTodo("read-tips");
  first.start(tips);

  const onEvent = vi.fn();
  const reloaded = connected({ storage: storage.tab(), onEvent });
  reloaded.start(tips);
  reloaded.act("advance");
  const tipsOnly = mounted(reloaded.checklist(onboarding.checklists.tipsOnly));
  expect(statusOf(tipsOnly, "read-tips")).toBe("done");
  expect(said(onEvent)).toEqual(expect.arrayContaining(["taskComplete:read-tips"]));
});
