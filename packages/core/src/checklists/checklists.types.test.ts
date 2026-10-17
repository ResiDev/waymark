import { describe, expectTypeOf, it } from "vitest";
import { defineChecklists } from "./checklists";
import type { ChecklistsEvent, Task } from "./types";
import { createRun } from "../run/run";
import type { RunOptions, Running } from "../run/types";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Walkthrough } from "../walkthrough/types";
import { everyProblem } from "../problems";
import type { ProblemHandlers, WaymarkProblem } from "../problems";

const initialContext = { hasDeck: false, hasPhoto: false };
type AppContext = typeof initialContext;

const deckSteps = defineWalkthrough({ id: "deck", steps: [{ waymark: "new-deck", meta: { helpUrl: "/help/decks" } }] });
const photoSteps = defineWalkthrough({ id: "photo", steps: [{ waymark: "avatar" }] });

const external = {
  walkthrough: photoSteps,
  isComplete: (c) => c.hasPhoto,
} satisfies Task<AppContext>;

describe("defineChecklists types", () => {
  it("types each condition from its own context, and each checklist's commands from its tasks", () => {
    const onboarding = defineChecklists({
      tasks: {
        "create-deck": {
          walkthrough: deckSteps,
          isComplete: (context: AppContext) => {
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
    const run = createRun();
    const home = run.checklist(onboarding.checklists.home);
    const decks = run.checklist(onboarding.checklists.decks);

    expectTypeOf(home.start).parameter(0).toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
    expectTypeOf(decks.start).parameter(0).toEqualTypeOf<"create-deck">();
    const mistakes = () => {
      // @ts-expect-error not in decks
      decks.start("add-photo");
    };
    expectTypeOf(mistakes).toBeFunction();

    type HomeRow = ReturnType<typeof home.getSnapshot>["tasks"][number];
    expectTypeOf<HomeRow["task"]["id"]>().toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
    expectTypeOf(decks.getSnapshot().open).toEqualTypeOf<
      Readonly<(typeof onboarding.checklists.decks.tasks)[number]> | null
    >();

    for (const row of home.getSnapshot().tasks) {
      if (row.task.id === "create-deck") expectTypeOf(row.task.walkthrough).toEqualTypeOf<typeof deckSteps>();
      if (row.task.id === "say-hello") expectTypeOf(row.task).not.toHaveProperty("walkthrough");
    }
  });

  it("rejects a condition that does not say what context it reads, which the Run cannot know", () => {
    const create = () =>
      defineChecklists({
        // @ts-expect-error the context is unknown until the condition types it
        tasks: { deck: { isComplete: (c) => c.hasDeck } }, // oxlint-disable-line typescript/no-unsafe-return, typescript/no-unsafe-member-access -- a deliberate type error, so its value has no type.
      });
    expectTypeOf(create).toBeFunction();
  });

  it("takes a task's steps inline, typed and checked as defineWalkthrough's are", () => {
    const defined = defineChecklists({
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
          isComplete: (c: AppContext) => c.hasDeck,
        },
        photo: { walkthrough: photoSteps },
      },
      checklists: { home: ["deck", "photo"] },
    });
    expectTypeOf<(typeof defined.checklists.home.tasks)[number]["id"]>().toEqualTypeOf<"deck" | "photo">();

    const mistakes = () => {
      defineChecklists({
        // @ts-expect-error misspelled advance
        tasks: { deck: { walkthrough: [{ advnace: "click" }] } },
      });
      defineChecklists({
        tasks: {
          // @ts-expect-error misspelled delayMs
          deck: { walkthrough: [{ advance: { click: true, delay: 500 } }] },
        },
      });
      defineChecklists({
        // @ts-expect-error a waymark is a name
        tasks: { deck: { walkthrough: [{ waymark: 5 }] } },
      });
    };
    expectTypeOf(mistakes).toBeFunction();
  });

  it("names one checklist, main, of every task when it names none", () => {
    const defined = defineChecklists({ tasks: { tour: { walkthrough: deckSteps }, hello: {} } });
    expectTypeOf<keyof typeof defined.checklists>().toEqualTypeOf<"main">();
    expectTypeOf(createRun().checklist(defined.checklists.main).start).parameter(0).toEqualTypeOf<"tour" | "hello">();
  });

  it("rejects a selection naming an unknown task", () => {
    const create = () =>
      defineChecklists({
        tasks: { "create-deck": { walkthrough: deckSteps } },
        // @ts-expect-error not a key of tasks
        checklists: { broken: ["missing-task"] },
      });
    expectTypeOf(create).toBeFunction();
  });

  it("types a task written with satisfies from the supplied context and keeps meta", () => {
    const task = {
      meta: { title: "Add a photo" },
      isComplete: (c) => {
        expectTypeOf(c).toEqualTypeOf<AppContext>();
        return c.hasPhoto;
      },
    } satisfies Task<AppContext>;
    // `meta` is `unknown` to core, so its literals widen unless written `as const`.
    expectTypeOf(task.meta.title).toEqualTypeOf<string>();
    const literal = { meta: { title: "Add a photo" } } as const satisfies Task<AppContext>;
    expectTypeOf(literal.meta.title).toEqualTypeOf<"Add a photo">();

    const wrongContext = {
      // @ts-expect-error the condition must accept the app context
      isComplete: (c: { other: string }) => c.other === "",
    } satisfies Task<AppContext>;
    expectTypeOf(wrongContext).toBeObject();
  });

  it("rejects a field that neither core nor meta names", () => {
    // @ts-expect-error misspelled advance
    defineWalkthrough({ id: "a", steps: [{ waymark: "new-deck", advnace: "click" }] });
    // @ts-expect-error application data belongs in meta
    defineWalkthrough({ id: "a", steps: [{ waymark: "new-deck", helpUrl: "/help/decks" }] });

    const misspelled = {
      // @ts-expect-error misspelled isComplete
      iscomplete: (c: AppContext) => c.hasDeck,
    } satisfies Task<AppContext>;
    expectTypeOf(misspelled).toBeObject();

    const create = () =>
      defineChecklists({
        tasks: {
          // @ts-expect-error application data belongs in meta
          deck: { walkthrough: deckSteps, title: "Create a deck" },
          hello: { meta: { title: "Say hello" } },
        },
      });
    expectTypeOf(create).toBeFunction();
  });

  it("rejects a field that no form of advance names", () => {
    const valid = defineWalkthrough({
      id: "valid",
      steps: [
        { advance: "click" },
        { advance: { event: "input" } },
        { advance: { event: ["input", "change"] } },
        { advance: { state: (waymark) => waymark !== null } },
        { advance: { click: true } },
        { advance: { click: true, then: "unlock", delayMs: 500 } },
        { advance: { event: "input", delayMs: 500 } },
      ],
    });
    expectTypeOf(valid).toHaveProperty("steps");

    const mistakes = () => {
      // @ts-expect-error misspelled delayMs
      defineWalkthrough({ id: "a", steps: [{ advance: { click: true, delay: 500 } }] });
      defineWalkthrough({
        id: "a",
        // @ts-expect-error misspelled delayMs, alongside a valid then
        steps: [{ advance: { click: true, then: "unlock", delayMS: 500 } }],
      });
      defineWalkthrough({
        id: "a",
        // @ts-expect-error misspelled state, beside an event
        steps: [{ advance: { event: "input", stat: () => true } }],
      });
      // @ts-expect-error a condition is an event or a state, not both
      defineWalkthrough({ id: "a", steps: [{ advance: { event: "input", state: () => true } }] });
      // @ts-expect-error a condition is a click or an event, not both
      defineWalkthrough({ id: "a", steps: [{ advance: { click: true, event: "input" } }] });
      // @ts-expect-error options with no condition
      defineWalkthrough({ id: "a", steps: [{ advance: { then: "unlock" } }] });
    };
    expectTypeOf(mistakes).toBeFunction();
  });
});

describe("defineWalkthrough types", () => {
  it("takes one object with an id, and keeps its steps exact", () => {
    const tour = defineWalkthrough({ id: "tour", steps: [{ waymark: "a", meta: { id: 1 } }], dismiss: "exit" });
    expectTypeOf(tour).toEqualTypeOf<Walkthrough<{ readonly waymark: "a"; readonly meta: { readonly id: 1 } }>>();

    const mistakes = () => {
      // @ts-expect-error a walkthrough needs an id, its key in the stored record
      defineWalkthrough({ steps: [{}] });
      // @ts-expect-error not a way to dismiss a walkthrough
      defineWalkthrough({ id: "a", steps: [{}], dismiss: "hide" });
      // @ts-expect-error storage belongs to the Run
      defineWalkthrough({ id: "a", steps: [{}], storage: "a" });
      // @ts-expect-error problem handlers belong to the Run
      defineWalkthrough({ id: "a", steps: [{}], problemHandlers: {} });
    };
    expectTypeOf(mistakes).toBeFunction();
  });
});

describe("Run types", () => {
  it("types the events of every walkthrough and checklist in one handler", () => {
    const onEvent = (event: Parameters<NonNullable<RunOptions["onEvent"]>>[0]) => {
      if (event.type === "interrupt") expectTypeOf(event.interruptedBy).toEqualTypeOf<string>();
      if (event.type === "taskStopped") expectTypeOf(event.reason).toEqualTypeOf<"finished" | "skipped" | "stopped">();
      if (event.type === "checklistComplete") expectTypeOf(event.checklist).toEqualTypeOf<string>();
      if (event.type === "advance") expectTypeOf(event.walkthrough).toEqualTypeOf<string>();
      if ("task" in event) expectTypeOf(event).toEqualTypeOf<Exclude<ChecklistsEvent, { type: "checklistComplete" }>>();
    };
    expectTypeOf(onEvent).toExtend<NonNullable<RunOptions["onEvent"]>>();
  });

  it("types each handler's problem from its key and the Run's walkthroughs", () => {
    type Tour = Walkthrough<{ readonly waymark: "a"; readonly meta: { readonly id: 1 } }>;
    const run = createRun<Tour>({
      problemHandlers: {
        waymarkMissing: (problem) => {
          expectTypeOf(problem.step.meta).toEqualTypeOf<{ readonly id: 1 }>();
          expectTypeOf(problem.walkthrough).toEqualTypeOf<string>();
        },
        recordDropped: (problem) => {
          expectTypeOf(problem.reason).toEqualTypeOf<"expired" | "stepsChanged">();
        },
      },
    });
    expectTypeOf(run.getSnapshot().open?.snapshot).toEqualTypeOf<Running<Tour["steps"][number]> | undefined>();
    const mistakes = () => {
      // @ts-expect-error a Run of these walkthroughs takes no other
      run.start(deckSteps);
      // @ts-expect-error not a type of problem
      createRun({ problemHandlers: { storageFaild: () => {} } });
    };
    expectTypeOf(mistakes).toBeFunction();

    createRun({
      problemHandlers: everyProblem((problem) => {
        expectTypeOf(problem).toEqualTypeOf<WaymarkProblem>();
      }),
    });
  });

  it("gives a handler no this, as each is called on its own", () => {
    expectTypeOf<NonNullable<ProblemHandlers["storageFailed"]>>().thisParameter.toBeVoid();
    createRun({
      problemHandlers: {
        storageFailed() {
          // @ts-expect-error a handler is called on its own, so it has no this
          void this.recordUnreadable;
        },
      },
    });
  });
});
