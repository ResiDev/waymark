// @vitest-environment node
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createRun, defineChecklists, defineWalkthrough } from "../index";
import type { RunOptions, StorageAdapter, StoredRecord } from "../index";

/** A server has no window, document or localStorage. Node has a localStorage of its own, so it goes too. */
const onAServer = () => {
  vi.stubGlobal("localStorage", undefined);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  expect([typeof window, typeof document, typeof localStorage]).toEqual(["undefined", "undefined", "undefined"]);
};

/** An adapter that says whether it was used. */
const watchedStorage = () =>
  ({
    load: vi.fn(() => null),
    save: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }) satisfies StorageAdapter;

const tour = defineWalkthrough({ id: "tour", steps: [{ waymark: "save" }, { waymark: "share" }] });

const onboarding = defineChecklists({
  tasks: {
    tour: { walkthrough: tour },
    hello: {},
    met: { isComplete: (context: { met: boolean }) => context.met },
  },
});

const initial: StoredRecord = { version: 1, walkthroughs: {}, tasks: { hello: "skipped" } };

/** Everything a server render, or server code, might do with a Run it made. */
const useEverything = (options: RunOptions) => {
  const storage = watchedStorage();
  const run = createRun({ storage, ...options });
  const main = run.checklist(onboarding.checklists.main);
  const heard = vi.fn();
  const listened = vi.fn();
  run.subscribe(heard);
  main.subscribe(listened);
  run.getServerSnapshot();
  main.getServerSnapshot();

  run.start(tour);
  run.act("advance");
  main.markDone("hello");
  main.start("tour");
  run.setContext({ met: true });
  return { storage, run, main, heard, listened };
};

describe("a Run on a server", () => {
  it.each<[string, RunOptions]>([
    ["without context", {}],
    ["with context", { context: { met: false } }],
  ])("holds every command while storage, never read, is loading, and touches neither storage nor the page, %s", (_, options) => {
    onAServer();
    const { storage, run, main, heard, listened } = useEverything(options);

    expect(run.getSnapshot()).toEqual({ storageStatus: "loading", progress: {}, open: null, beacons: [] });
    expect(main.getSnapshot()).toMatchObject({ storageStatus: "loading", finishedCount: 0 });
    expect(heard).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());
    expect(listened).toHaveBeenCalledExactlyOnceWith(main.getSnapshot());
    expect(storage.load).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.subscribe).not.toHaveBeenCalled();
  });

  it.each<[string, RunOptions]>([
    ["without context", { initial }],
    ["with context", { initial, context: { met: false } }],
  ])("runs every command on the record given it without the page, loading or hearing storage, %s", (_, options) => {
    onAServer();
    const { storage, run, main } = useEverything(options);

    expect(run.getSnapshot().open).toMatchObject({ task: "tour", snapshot: { stepIndex: 1 } });
    expect(main.getSnapshot()).toMatchObject({
      storageStatus: "ready",
      tasks: [{ status: "todo" }, { status: "done" }, { status: "done" }],
    });
    expect(storage.load).not.toHaveBeenCalled();
    expect(storage.subscribe).not.toHaveBeenCalled();
  });
});
