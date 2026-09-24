import { describe, expectTypeOf, it } from "vitest";
import { createChecklists, defineTask } from "./checklists";
import type { ChecklistsEvent, StepOf, Stored } from "./checklists";
import { defineWalkthrough } from "./walkthrough";
import type { Run } from "./types";

/**
 * The inference claims of the design, checked by `tsc` on this file. The
 * runtime assertions are no-ops; `@ts-expect-error` lines fail typecheck if
 * the mistake they mark stops being one.
 */

const initialContext = { hasDeck: false, hasPhoto: false };
type AppContext = typeof initialContext;

const deckSteps = defineWalkthrough([{ waymark: "new-deck", meta: { helpUrl: "/help/decks" } }]);
const photoSteps = defineWalkthrough([{ waymark: "avatar" }]);

const external = defineTask<AppContext>()({
  walkthrough: photoSteps,
  isComplete: (c) => c.hasPhoto,
});

describe("createChecklists types", () => {
  it("infers context from initial values and types inline conditions from it", () => {
    const owner = createChecklists({
      context: initialContext,
      tasks: {
        "create-deck": {
          walkthrough: deckSteps,
          isComplete: (context) => {
            expectTypeOf(context).toEqualTypeOf<{ hasDeck: boolean; hasPhoto: boolean }>();
            return context.hasDeck;
          },
        },
        "add-photo": external,
        "say-hello": {},
      },
      checklists: {
        home: ["add-photo", "create-deck", "say-hello"],
        decks: ["create-deck"],
      },
    });

    expectTypeOf(owner.update).parameter(0).toEqualTypeOf<{ hasDeck: boolean; hasPhoto: boolean }>();
    // @ts-expect-error the full context shape is required
    owner.update({ hasDeck: true });

    expectTypeOf(owner.start).parameter(0).toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
    expectTypeOf(owner.checklists.decks.start).parameter(0).toEqualTypeOf<"create-deck">();
    // @ts-expect-error not in decks
    owner.checklists.decks.start("add-photo");

    type HomeRow = ReturnType<typeof owner.checklists.home.getSnapshot>["tasks"][number];
    expectTypeOf<HomeRow["task"]["id"]>().toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
    type DeckActive = NonNullable<ReturnType<typeof owner.checklists.decks.getSnapshot>["active"]>;
    expectTypeOf<DeckActive["run"]>().toEqualTypeOf<Run<{ readonly waymark: "new-deck"; readonly meta: { readonly helpUrl: "/help/decks" } }>>();
    type OwnerActive = NonNullable<ReturnType<typeof owner.getSnapshot>["active"]>;
    expectTypeOf<OwnerActive["checklists"]>().toEqualTypeOf<readonly ("home" | "decks")[]>();

    // The checklists a Run counts for, and a skip from it applies to, must select the task.
    owner.start("create-deck", "decks");
    owner.start("create-deck", ["home", "decks"]);
    owner.start("add-photo", "home");
    // For an id that may be any task, only checklists selecting all of them.
    const anyTask = "create-deck" as "create-deck" | "add-photo";
    owner.start(anyTask, "home");
    // Any Task's Run, from the owner's snapshot or a view's.
    const ownerActive = owner.getSnapshot().active;
    if (ownerActive) owner.skipActive(ownerActive.run);
    const deckActive = owner.checklists.decks.getSnapshot().active;
    if (deckActive) owner.skipActive(deckActive.run);
    // Checked, never called: each would throw.
    const mistakes = () => {
      // @ts-expect-error decks does not select add-photo
      owner.start("add-photo", "decks");
      // @ts-expect-error decks does not select add-photo
      owner.start("add-photo", ["home", "decks"]);
      // @ts-expect-error not a checklist
      owner.start("create-deck", "nope");
      // @ts-expect-error decks does not select every task the id may be
      owner.start(anyTask, "decks");
      // @ts-expect-error the renderer names the Run it drew
      owner.skipActive();
    };
    expectTypeOf(mistakes).toBeFunction();

    const home = owner.checklists.home.getSnapshot();
    for (const row of home.tasks) {
      if (row.task.id === "create-deck") {
        // The row keeps the relationship between id and definition.
        expectTypeOf(row.task.walkthrough).toEqualTypeOf<typeof deckSteps>();
      }
      if (row.task.id === "say-hello") {
        expectTypeOf(row.task).not.toHaveProperty("walkthrough");
      }
    }
  });

  it("takes a task's steps inline, typed and checked as defineWalkthrough's are", () => {
    const owner = createChecklists({
      context: initialContext,
      tasks: {
        deck: {
          walkthrough: [
            { waymark: "new-deck", advance: "click" },
            {
              advance: {
                state: (waymark) => {
                  expectTypeOf(waymark).toEqualTypeOf<Element | null>();
                  return waymark !== null;
                },
              },
            },
          ],
          isComplete: (c) => c.hasDeck,
        },
        photo: { walkthrough: photoSteps },
      },
      checklists: { home: ["deck", "photo"] },
    });

    type DeckActive = NonNullable<ReturnType<typeof owner.checklists.home.getSnapshot>["active"]>;
    type DeckStep = DeckActive["run"] extends Run<infer TStep> ? TStep : never;
    expectTypeOf<Extract<DeckStep, { readonly waymark: "new-deck" }>>().toEqualTypeOf<{
      readonly waymark: "new-deck";
      readonly advance: "click";
    }>();
    expectTypeOf<Extract<DeckStep, { readonly waymark: "avatar" }>>().toEqualTypeOf<{ readonly waymark: "avatar" }>();

    const mistakes = () => {
      createChecklists({
        context: initialContext,
        // @ts-expect-error misspelled advance
        tasks: { deck: { walkthrough: [{ advnace: "click" }] } },
        checklists: { home: ["deck"] },
      });
      createChecklists({
        context: initialContext,
        // @ts-expect-error misspelled delayMs
        tasks: { deck: { walkthrough: [{ advance: { when: "click", delay: 500 } }] } },
        checklists: { home: ["deck"] },
      });
      createChecklists({
        context: initialContext,
        // @ts-expect-error a waymark is a name
        tasks: { deck: { walkthrough: [{ waymark: 5 }] } },
        checklists: { home: ["deck"] },
      });
    };
    expectTypeOf(mistakes).toBeFunction();
  });

  it("needs no context when no task has a condition", () => {
    const owner = createChecklists({
      tasks: { tour: { walkthrough: deckSteps }, hello: {} },
      checklists: { home: ["tour", "hello"] },
    });
    expectTypeOf(owner.update).parameter(0).toEqualTypeOf<{}>();

    const create = () =>
      createChecklists({
        // @ts-expect-error without a context, a condition has no fields to read
        tasks: { deck: { isComplete: (c) => c.hasDeck } },
        checklists: { home: ["deck"] },
      });
    expectTypeOf(create).toBeFunction();
  });

  it("rejects a selection naming an unknown task", () => {
    const create = () =>
      createChecklists({
        context: initialContext,
        tasks: { "create-deck": { walkthrough: deckSteps } },
        // @ts-expect-error not a key of tasks
        checklists: { broken: ["missing-task"] },
      });
    expectTypeOf(create).toBeFunction();
  });

  it("recovers the step union across tasks, without steps from tasks that have none", () => {
    const tasks = {
      deck: { walkthrough: deckSteps },
      photo: external,
      // A step with only application data is still a step.
      note: { walkthrough: defineWalkthrough([{ meta: { text: "Read this" } }]) },
      hello: {},
    } as const;
    expectTypeOf<StepOf<(typeof tasks)[keyof typeof tasks]>>().toEqualTypeOf<
      | { readonly waymark: "new-deck"; readonly meta: { readonly helpUrl: "/help/decks" } }
      | { readonly waymark: "avatar" }
      | { readonly meta: { readonly text: "Read this" } }
    >();
    expectTypeOf<StepOf<(typeof tasks)["hello"]>>().toEqualTypeOf<never>();
  });

  it("types events over all tasks and checklist names", () => {
    createChecklists({
      context: initialContext,
      tasks: { deck: { walkthrough: deckSteps }, hello: {} },
      checklists: { home: ["deck", "hello"], decks: ["deck"] },
      onEvent: (event) => {
        expectTypeOf(event.type).toEqualTypeOf<
          "taskStarted" | "taskComplete" | "taskStopped" | "taskSkipped" | "checklistComplete"
        >();
        if (event.type === "taskSkipped") {
          expectTypeOf(event.checklist).toEqualTypeOf<"home" | "decks">();
          expectTypeOf(event.task.id).toEqualTypeOf<"deck" | "hello">();
        }
        if (event.type === "taskStopped") {
          expectTypeOf(event.reason).toEqualTypeOf<"finished" | "skipped" | "stopped">();
        }
        // Each event narrows to its own literal.
        if (event.type === "taskStarted") {
          expectTypeOf(event.type).toEqualTypeOf<"taskStarted">();
        }
        if (event.type === "taskComplete") {
          expectTypeOf(event.type).toEqualTypeOf<"taskComplete">();
        }
      },
      run: {
        onEvent: (event) => {
          expectTypeOf(event.step).toEqualTypeOf<{ readonly waymark: "new-deck"; readonly meta: { readonly helpUrl: "/help/decks" } }>();
        },
        // @ts-expect-error core owns startAt
        startAt: 0,
      },
    });
  });

  it("types defineTask conditions from the supplied context and keeps meta", () => {
    const task = defineTask<AppContext>()({
      meta: { title: "Add a photo" },
      isComplete: (c) => {
        expectTypeOf(c).toEqualTypeOf<AppContext>();
        return c.hasPhoto;
      },
    });
    expectTypeOf(task.meta.title).toEqualTypeOf<"Add a photo">();

    defineTask<AppContext>()({
      // @ts-expect-error the condition must accept the app context
      isComplete: (c: { other: string }) => c.other === "",
    });
  });

  it("rejects a field that neither core nor meta names", () => {
    // @ts-expect-error misspelled advance
    defineWalkthrough([{ waymark: "new-deck", advnace: "click" }]);
    // @ts-expect-error application data belongs in meta
    defineWalkthrough([{ waymark: "new-deck", helpUrl: "/help/decks" }]);

    defineTask<AppContext>()({
      // @ts-expect-error misspelled isComplete
      iscomplete: (c: AppContext) => c.hasDeck,
    });

    const create = () =>
      createChecklists({
        context: initialContext,
        tasks: {
          // @ts-expect-error application data belongs in meta
          deck: { walkthrough: deckSteps, title: "Create a deck" },
          hello: { meta: { title: "Say hello" } },
        },
        checklists: { home: ["deck", "hello"] },
      });
    expectTypeOf(create).toBeFunction();
  });

  it("rejects a field that no form of advance names", () => {
    const valid = defineWalkthrough([
      { advance: "click" },
      { advance: { event: "input" } },
      { advance: { event: ["input", "change"] } },
      { advance: { state: (waymark) => waymark !== null } },
      { advance: { when: "click", then: "unlock", delayMs: 500 } },
      { advance: { when: { event: "input" }, delayMs: 500 } },
    ]);
    expectTypeOf(valid).toHaveProperty("steps");

    // @ts-expect-error misspelled delayMs
    defineWalkthrough([{ advance: { when: "click", delay: 500 } }]);
    // @ts-expect-error misspelled delayMs, alongside a valid then
    defineWalkthrough([{ advance: { when: "click", then: "unlock", delayMS: 500 } }]);
    // @ts-expect-error misspelled state, inside when
    defineWalkthrough([{ advance: { when: { event: "input", stat: () => true } } }]);
    // @ts-expect-error a condition is an event or a state, not both
    defineWalkthrough([{ advance: { event: "input", state: () => true } }]);
    // @ts-expect-error a typo in a later step
    defineWalkthrough([{ advance: "click" }, { advance: { when: "click", delay: 500 } }]);
  });

  it("accepts a stored record and an event handler typed over the owner", () => {
    const stored: Stored = { done: ["x"], skipped: { home: ["y"] } };
    const owner = createChecklists({
      context: {},
      tasks: { a: {} },
      checklists: { all: ["a"] },
      stored,
    });
    type Event = ChecklistsEvent<{ a: {} }, { all: readonly ["a"] }>;
    const handler = (event: Event) => event.type;
    owner.load(stored);
    expectTypeOf(handler).toBeFunction();
  });
});
