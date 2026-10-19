// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  Checklist,
  defineChecklists,
  defineWalkthrough,
  Walkthrough,
  WaymarkRoot,
  type StorageAdapter,
  type StoredRecord,
  type WaymarkRootProps,
} from "./index";

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

const tour = defineWalkthrough({ id: "tour", steps: [{ waymark: "save", content: "Save your work" }] });

const { checklists } = defineChecklists({
  tasks: {
    hello: { title: "Say hello", walkthrough: tour },
    invite: { title: "Invite a friend", isComplete: (context: { invited: boolean }) => context.invited },
  },
});

const initial: StoredRecord = { version: 1, walkthroughs: {}, tasks: { hello: "done" } };

describe("WaymarkRoot on a server", () => {
  it.each<[string, Omit<WaymarkRootProps, "children" | "storage">, string]>([
    ["", {}, "0<!-- --> of <!-- -->2<!-- --> done"],
    [", given a record and context", { initial, context: { invited: false } }, "1<!-- --> of <!-- -->2<!-- --> done"],
  ])("renders a Checklist and a Walkthrough without touching storage or the page%s", (_, props, done) => {
    onAServer();
    const error = vi.spyOn(console, "error");
    const storage = watchedStorage();
    const html = renderToString(
      <WaymarkRoot storage={storage} {...props}>
        <Walkthrough walkthrough={tour} />
        <Checklist checklist={checklists.main} />
      </WaymarkRoot>,
    );

    expect(html).toContain(done);
    expect(html).toContain("Say hello");
    expect(html).not.toContain("Save your work");
    expect(error).not.toHaveBeenCalled();
    expect(storage.load).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.subscribe).not.toHaveBeenCalled();
  });

  it("renders with a localStorage key, which it never reads", () => {
    onAServer();
    const error = vi.spyOn(console, "error");
    const html = renderToString(
      <WaymarkRoot storage="setup">
        <Walkthrough walkthrough={tour} />
        <Checklist checklist={checklists.main} />
      </WaymarkRoot>,
    );

    expect(html).toContain("0<!-- --> of <!-- -->2<!-- --> done");
    expect(error).not.toHaveBeenCalled();
  });
});
