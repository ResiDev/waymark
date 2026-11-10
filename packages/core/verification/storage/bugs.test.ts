// What the storage model found, reproduced on the real code. Each `it.fails` is a bug: it flips once the bug is fixed.
// The traces they follow are TLC's, from the Broken*.cfg models beside this file.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { defineChecklists } from "../../src/checklists/checklists";
import { createRun } from "../../src/run/run";
import type { Run } from "../../src/run/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";
import { backend } from "./backend";
import type { Backend, Options } from "./backend";

const hint = defineWalkthrough({ id: "hint", steps: [{}] });
const checklist = defineChecklists({ tasks: { t: {} } }).checklists.main;

const open = (run: Run) => run.getSnapshot().open?.walkthrough.id;
const hintOf = (run: Run) => run.getSnapshot().progress["hint"]?.status;
const taskOf = (run: Run) => run.checklist(checklist).getSnapshot().tasks[0]?.status;
type Shape = { walkthroughs?: Record<string, { status: string }>; tasks?: Record<string, string> } | null;
const storedHint = (net: Backend) => (net.stored() as Shape)?.walkthroughs?.["hint"]?.status;
const storedTask = (net: Backend) => (net.stored() as Shape)?.tasks?.["t"];

/** Time as the Runs read it, for changedAt. */
const at = (ms: number) => vi.setSystemTime(ms);

/** A Run on the shared store, connected until the test ends. */
const tabOn = (net: Backend) => {
  const run = createRun({ storage: net.tab() });
  onTestFinished(run.connect());
  return run;
};

/** Two tabs on one store, both loaded and listening. */
function twoTabs(options: Options) {
  const net = backend(null, options);
  const a = tabOn(net);
  const b = tabOn(net);
  if (options.async) {
    for (const index of [0, 1]) {
      net.readLoad(index);
      net.deliverLoad(index);
    }
  }
  return { net, a, b };
}

/** Every save each tab has in flight lands, in the order sent. */
const landAll = (net: Backend) => {
  for (const index of [0, 1]) while (net.side(index).saves.length > 0) net.land(index);
};

/** Like a server that pushes every write to every tab: savePartial on a transaction, records heard in order. */
const remote: Options = { kind: "partial", async: true, tellsOwnWrites: true, hearCurrent: false };

describe("a heard record without a walkthrough this tab just finished (NoReshowHere)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Tab A shows the one-step hint and the user closes it with "Got it": two saves in flight, running then finished.
  // Tab B, which never ran the hint, ticks a task, and its save lands first. A hears B's record, which has no hint.
  const race = () => {
    at(1_000);
    const tabs = twoTabs(remote);
    const { net, a, b } = tabs;
    a.start(hint);
    at(2_000);
    a.act("advance");
    expect(hintOf(a)).toBe("finished");
    b.checklist(checklist).toggle("t");
    net.land(1);
    net.hear(0);
    return tabs;
  };

  it("a finished hint stays finished after another tab saves", () => {
    const { a } = race();
    a.requestStart(hint);
    expect(open(a)).toBeUndefined();
  });

  it("a finished hint stays stored as finished after another tab saves", () => {
    const { net, a } = race();
    at(3_000);
    a.requestStart(hint);
    landAll(net);
    expect(storedHint(net)).toBe("finished");
  });

  it("keeps the finish on hearing a record without it, which has no reset of it either", () => {
    const { net, a } = race();
    expect(hintOf(a)).toBe("finished");
    landAll(net);
    expect(storedHint(net)).toBe("finished");
  });

  // One tab is enough: the echo of its own earlier save, from before it ran the hint, has no hint in it.
  it("a finished hint stays finished when the tab hears its own earlier save", () => {
    at(1_000);
    const net = backend(null, remote);
    const a = tabOn(net);
    net.readLoad(0);
    net.deliverLoad(0);
    a.checklist(checklist).toggle("t");
    a.start(hint);
    at(2_000);
    a.act("advance");
    net.land(0);
    net.hear(0);
    a.requestStart(hint);
    expect(open(a)).toBeUndefined();
  });
});

// Thread 3: a reset is stored with its time, so whichever is newer, a walkthrough's entry or its reset, wins.
describe("a reset in one tab, as other tabs and storage take it", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const hearAll = (net: Backend) => {
    for (const index of [0, 1]) while (net.side(index).toHear.length > 0) net.hear(index);
  };

  it("reaches another open tab: the hint can show there again", () => {
    at(1_000);
    const { net, a, b } = twoTabs(remote);
    a.start(hint);
    a.act("advance");
    landAll(net);
    hearAll(net);
    expect(hintOf(b)).toBe("finished");

    at(2_000);
    b.reset(hint);
    landAll(net);
    hearAll(net);
    expect(hintOf(a)).toBeUndefined();
    a.requestStart(hint);
    expect(open(a)).toBe("hint");
  });

  it("stays when an older save of the walkthrough lands after it", () => {
    at(1_000);
    const { net, a, b } = twoTabs(remote);
    a.start(hint);
    landAll(net);
    hearAll(net);
    at(2_000);
    a.act("advance");
    at(3_000);
    b.reset(hint);
    net.land(1);
    net.land(0);
    expect(storedHint(net)).toBeUndefined();
    hearAll(net);
    landAll(net);
    expect([hintOf(a), hintOf(b), storedHint(net)]).toEqual([undefined, undefined, undefined]);
  });

  it("gives way to the walkthrough started again after it", () => {
    at(1_000);
    const { net, a, b } = twoTabs(remote);
    a.start(hint);
    a.act("advance");
    landAll(net);
    hearAll(net);
    at(2_000);
    b.reset(hint);
    landAll(net);
    at(3_000);
    a.start(hint);
    landAll(net);
    hearAll(net);
    landAll(net);
    expect([hintOf(a), hintOf(b), storedHint(net)]).toEqual(["running", "running", "running"]);
  });

  // A tab's own writes in one millisecond: each wins over the one before it, in storage and in the other tab.
  it("loses to a start in the same millisecond, as a replay button does", () => {
    at(1_000);
    const { net, a, b } = twoTabs(remote);
    a.start(hint);
    a.act("advance");
    landAll(net);
    hearAll(net);
    a.reset(hint);
    a.start(hint);
    landAll(net);
    hearAll(net);
    expect([hintOf(a), hintOf(b), storedHint(net)]).toEqual(["running", "running", "running"]);
  });

  it("wins over a finish in the same millisecond", () => {
    at(1_000);
    const { net, a, b } = twoTabs(remote);
    a.start(hint);
    a.act("advance");
    a.reset(hint);
    landAll(net);
    hearAll(net);
    expect([hintOf(a), hintOf(b), storedHint(net)]).toEqual([undefined, undefined, undefined]);
  });
});

describe("the store keeps the newest change, whichever save lands last (MostRecentStored, QuietTabsAgree)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Both tabs show the hint on page load. The user closes it in B. A's save of the start, older, lands last.
  const race = () => {
    at(1_000);
    const tabs = twoTabs(remote);
    const { net, a, b } = tabs;
    a.requestStart(hint);
    b.requestStart(hint);
    at(2_000);
    b.act("advance");
    net.land(1);
    net.land(1);
    net.land(0);
    for (const index of [0, 1]) while (net.side(index).toHear.length > 0) net.hear(index);
    return tabs;
  };

  it("a hint finished in one tab stays finished on reload, when the other tab's older save lands last", () => {
    const { net } = race();
    const reloaded = tabOn(net);
    net.readLoad(2);
    net.deliverLoad(2);
    reloaded.requestStart(hint);
    expect(open(reloaded)).toBeUndefined();
  });

  it("a tab shows a hint finished as storage holds it, after every save landed and was heard", () => {
    const { net, b } = race();
    expect(hintOf(b)).toBe(storedHint(net));
  });

  // savePartial calls are not queued, so two from one tab can reach a server out of order.
  it("a finished hint stays finished on reload, when its tab's two saves reach the server out of order", () => {
    at(1_000);
    const net = backend(null, remote);
    const a = tabOn(net);
    net.readLoad(0);
    net.deliverLoad(0);
    a.start(hint);
    at(2_000);
    a.act("advance");
    net.land(0, 1);
    net.land(0, 0);
    expect(storedHint(net)).toBe("finished");
  });
});

describe("a tab that loads while another tab saves (HearsEveryWrite)", () => {
  // B finishes the hint while A's load is on its way: the server read the record before B's save. A listens
  // from connect, so it is told of B's save, and takes in what it heard meanwhile once the load arrives.
  const race = () => {
    const net = backend(null, remote);
    const b = tabOn(net);
    net.readLoad(0);
    net.deliverLoad(0);
    const a = tabOn(net);
    net.readLoad(1);
    b.start(hint);
    b.act("advance");
    landAll(net);
    return { net, a, b };
  };

  it("a tab that opened while another tab saved is told of that save", () => {
    const { net } = race();
    net.deliverLoad(1);
    const told = net.side(1);
    expect(told.toHear.length > 0 || told.notified).toBe(true);
  });

  it("a hint finished in another tab stays finished in a tab that opened as it was saved, heard while it loaded", () => {
    const { net, a } = race();
    while (net.side(1).toHear.length > 0) net.hear(1);
    expect(hintOf(a)).toBeUndefined();
    net.deliverLoad(1);
    expect(hintOf(a)).toBe("finished");
    a.requestStart(hint);
    expect(open(a)).toBeUndefined();
  });
});

describe("two tabs on a save adapter that answers later (SaveKeepsOthersEntries, NeverOverwriteUnreadable)", () => {
  // A save adapter over IndexedDB or HTTP: each save loads, then stores the whole record, and another tab's save can land between.
  const asyncWhole: Options = { kind: "whole", async: true, tellsOwnWrites: false, hearCurrent: true };

  it.fails("a tick in one tab is lost when another tab saves at the same time", () => {
    const { net, a, b } = twoTabs(asyncWhole);
    a.checklist(checklist).toggle("t");
    b.start(hint);
    net.answerLoad(0);
    net.answerLoad(1);
    net.land(0);
    net.land(1);
    expect(storedTask(net)).toBe("done");
  });

  it.fails("a save writes over a record a newer Waymark wrote meanwhile", () => {
    const { net, a } = twoTabs(asyncWhole);
    a.checklist(checklist).toggle("t");
    net.answerLoad(0);
    const newer = { version: 2 };
    net.put(newer);
    net.land(0);
    expect(net.stored()).toBe(newer);
  });
});

describe("what thread 10 accepted", () => {
  it("shows a tick as todo while it waits to be saved, once it hears another tab's record, and stores it", () => {
    const { net, a, b } = twoTabs(remote);
    a.checklist(checklist).toggle("t");
    b.start(hint);
    net.land(1);
    net.hear(0);
    expect(taskOf(a)).toBe("todo");
    net.land(0);
    expect(storedTask(net)).toBe("done");
    net.hear(0);
    expect(taskOf(a)).toBe("done");
  });
});

describe("a save that failed, and a replace over what another tab could not save (QuietTabsAgree)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const hearAll = (net: Backend, tabs: readonly number[]) => {
    for (const index of tabs) while (net.side(index).toHear.length > 0) net.hear(index);
  };

  // Thread 12.
  it("a finish whose save failed reaches storage with the next save", () => {
    at(1_000);
    const net = backend(null, remote);
    const a = tabOn(net);
    net.readLoad(0);
    net.deliverLoad(0);
    a.start(hint);
    net.land(0);
    at(2_000);
    a.act("advance");
    net.failSave(0);
    const list = a.checklist(checklist);
    list.subscribe(() => {});
    list.markDone("t");
    net.land(0);
    expect([storedHint(net), storedTask(net)]).toEqual(["finished", "done"]);
  });

  // Thread 12: a task's status has no time, so the failed tick must not come back over the untick.
  it("does not send a failed entry again once a later save sent it anew", () => {
    const net = backend(null, remote);
    const a = tabOn(net);
    net.readLoad(0);
    net.deliverLoad(0);
    const list = a.checklist(checklist);
    list.subscribe(() => {});
    list.markDone("t");
    list.markTodo("t");
    net.failSave(0, 0);
    net.land(0, 0);
    a.start(hint);
    net.land(0);
    expect([storedTask(net), storedHint(net)]).toEqual(["reopened", "running"]);
  });

  // Thread 13.
  it("a hint finished while the record was unreadable stays finished after another tab replaces the record", () => {
    at(1_000);
    const net = backend(null, remote);
    let replaceInA: ((record: null) => void) | undefined;
    const a = createRun({ storage: net.tab(), problemHandlers: { recordUnreadable: ({ replace }) => (replaceInA = replace) } });
    onTestFinished(a.connect());
    const b = createRun({ storage: net.tab(), problemHandlers: { recordUnreadable: () => {} } });
    onTestFinished(b.connect());
    for (const index of [0, 1]) {
      net.readLoad(index);
      net.deliverLoad(index);
    }
    a.start(hint);
    net.land(0);
    hearAll(net, [0, 1]);
    net.put({ version: 99 });
    hearAll(net, [0, 1]);

    at(2_000);
    b.start(hint);
    b.act("advance");
    while (net.side(1).saves.length > 0) net.land(1);
    expect(hintOf(b)).toBe("finished");

    replaceInA?.(null);
    net.land(0);
    expect(storedHint(net)).toBe("running");
    hearAll(net, [0, 1]);
    while (net.side(1).saves.length > 0) net.land(1);
    expect(storedHint(net)).toBe("finished");
  });
});
