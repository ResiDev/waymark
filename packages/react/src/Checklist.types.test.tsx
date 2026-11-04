import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineChecklists as defineCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
} from "waymark-core";
import {
  Checklist,
  defineChecklists,
  defineWalkthrough,
  everyProblem,
  useChecklist,
  useRun,
  Walkthrough,
  WaymarkRoot,
} from "./index";
import type { ReactTask, WalkthroughStep, WaymarkProblem } from "./types";

type AppContext = { hasDeck: boolean; hasPhoto: boolean };

const deckSteps = defineWalkthrough({
  id: "deck",
  steps: [{ content: "Open decks", meta: { helpUrl: "/help" } }, { content: "Press new" }],
});
const photoSteps = defineWalkthrough({ id: "photo", steps: [{ content: "Pick a photo", waymark: "avatar" }] });
const addPhoto = { title: "Add a photo", walkthrough: photoSteps } satisfies ReactTask<AppContext>;

const onboarding = defineChecklists({
  tasks: {
    "create-deck": { title: "Create a deck", walkthrough: deckSteps, isComplete: (c: AppContext) => c.hasDeck },
    "add-photo": addPhoto,
    "say-hello": { title: "Say hello", description: "No guidance needed" },
  },
  checklists: { home: ["create-deck", "add-photo", "say-hello"], decks: ["create-deck"] },
});

describe("Walkthrough prop shapes", () => {
  it("takes a walkthrough, and leaves drawing it to WaymarkRoot", () => {
    const elements = {
      requested: <Walkthrough walkthrough={deckSteps} />,
      held: <Walkthrough walkthrough={deckSteps} active={false} />,
      // @ts-expect-error a checklist's tasks start their own walkthroughs
      checklists: <Walkthrough checklists={onboarding} />,
      // @ts-expect-error padding is WaymarkRoot's
      padding: <Walkthrough walkthrough={deckSteps} waymarkPadding={12} />,
      // @ts-expect-error events are WaymarkRoot's
      events: <Walkthrough walkthrough={deckSteps} onEvent={() => {}} />,
      // @ts-expect-error drawing is WaymarkRoot's, or the definition's
      popover: <Walkthrough walkthrough={deckSteps} renderPopover={() => null} />,
    };
    expect(Object.keys(elements)).toHaveLength(6);
  });

  it("gives a definition's own popover and beacon its exact steps, and the root's any React step", () => {
    const announcement = defineWalkthrough({
      id: "announcement",
      steps: [{ content: "Open decks", meta: { helpUrl: "/help" } }, { content: "Press new" }],
      renderPopover: ({ currentStep }) => {
        expectTypeOf(currentStep.content).toEqualTypeOf<"Open decks" | "Press new">();
        expectTypeOf(currentStep.meta).toEqualTypeOf<{ readonly helpUrl: "/help" } | undefined>();
        return currentStep.content;
      },
      renderBeacon: ({ currentStep }) => {
        expectTypeOf(currentStep.content).toEqualTypeOf<"Open decks" | "Press new">();
        return null;
      },
    });
    const root = (
      <WaymarkRoot
        renderPopover={({ currentStep }) => {
          expectTypeOf(currentStep).toEqualTypeOf<WalkthroughStep>();
          return currentStep.content;
        }}
      >
        <Walkthrough walkthrough={announcement} />
      </WaymarkRoot>
    );
    expect(root).toBeTruthy();
  });

  it("rejects walkthroughs whose steps have no React content", () => {
    const plain = defineCoreWalkthrough({ id: "save", steps: [{ waymark: "save" }] });
    // @ts-expect-error steps without content cannot be drawn
    const element = <Walkthrough walkthrough={plain} />;
    expect(element).toBeTruthy();

    // Never called: hooks need a component.
    const Starter = () => {
      const run = useRun();
      run.start(deckSteps);
      // @ts-expect-error steps without content cannot be drawn
      run.start(plain);
      return null;
    };
    expectTypeOf(Starter).toBeFunction();
  });
});

describe("React definition functions", () => {
  it("rejects a field that neither core, React nor meta names", () => {
    // @ts-expect-error misspelled content
    defineWalkthrough({ id: "a", steps: [{ contnet: "Open decks", content: "Open decks" }] });
    // @ts-expect-error application data belongs in meta
    defineWalkthrough({ id: "b", steps: [{ content: "Open decks", helpUrl: "/help" }] });
    // @ts-expect-error misspelled delayMs
    defineWalkthrough({ id: "c", steps: [{ content: "Open decks", waymark: "decks", advance: { click: true, delay: 500 } }] });

    const misspelled = {
      title: "Add a photo",
      // @ts-expect-error misspelled description
      descripton: "Pick one you like",
    } satisfies ReactTask<AppContext>;
    expectTypeOf(misspelled).toBeObject();

    const define = () =>
      defineChecklists({
        tasks: {
          // @ts-expect-error a React task needs a title
          untitled: { walkthrough: deckSteps },
          // @ts-expect-error application data belongs in meta
          stray: { title: "Stray", icon: "deck" },
          fine: { title: "Fine", meta: { icon: "deck" } },
        },
        checklists: { home: ["untitled", "stray", "fine"] },
      });
    expectTypeOf(define).toBeFunction();
  });
});

describe("defineChecklists", () => {
  it("needs no context when no task has a condition", () => {
    const plain = defineChecklists({
      tasks: { hello: { title: "Say hello", description: "No condition" } },
      checklists: { home: ["hello"] },
    });
    expect(<Checklist checklist={plain.checklists.home} />).toBeTruthy();
  });

  it("gives one checklist, main, when it names none", () => {
    const single = defineChecklists({
      tasks: { tour: { title: "Take the tour", walkthrough: [{ content: "Hello" }] } },
    });
    expect(<Checklist checklist={single.checklists.main} />).toBeTruthy();
  });
});

describe("inline steps", () => {
  it("holds steps written on a task to React's step", () => {
    const inline = defineChecklists({
      tasks: {
        "create-deck": {
          title: "Create a deck",
          walkthrough: [
            { waymark: "new-deck", content: "Press New deck", advance: "click" },
            // Shares no field with core's Step, and must not be lost for it.
            { content: "Decks group your cards" },
          ],
        },
      },
      checklists: { home: ["create-deck"] },
    });
    expect(<Checklist checklist={inline.checklists.home} />).toBeTruthy();

    const mistakes = () => {
      defineChecklists({
        // @ts-expect-error steps need content
        tasks: { deck: { title: "Deck", walkthrough: [{ waymark: "new-deck" }] } },
        checklists: { home: ["deck"] },
      });
      defineChecklists({
        // @ts-expect-error misspelled content
        tasks: { deck: { title: "Deck", walkthrough: [{ contnet: "Press", content: "Press" }] } },
        checklists: { home: ["deck"] },
      });
    };
    expectTypeOf(mistakes).toBeFunction();
  });
});

describe("problem handlers", () => {
  it("gives an untyped everyProblem handler React's problems, and takes one typed with a walkthrough's own steps", () => {
    const describeProblem = (problem: WaymarkProblem) => problem.type;
    const untyped = (
      <WaymarkRoot
        problemHandlers={everyProblem((problem) => {
          expectTypeOf(problem).toEqualTypeOf<WaymarkProblem>();
          describeProblem(problem);
        })}
      />
    );
    const pressProblem = (problem: WaymarkProblem<{ readonly content: "Press" }>) => problem.type;
    const typed = <WaymarkRoot problemHandlers={everyProblem(pressProblem)} />;
    expect([untyped, typed]).toHaveLength(2);
  });
});

describe("Checklist and useChecklist", () => {
  it("types checklists over their selected React tasks", () => {
    const plain = defineCoreChecklists({ tasks: { a: {} }, checklists: { all: ["a"] } });
    const elements = {
      decks: <Checklist checklist={onboarding.checklists.decks} />,
      home: (
        <Checklist
          checklist={onboarding.checklists.home}
          renderRow={({ task, start }) => {
            expectTypeOf(task.id).toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
            expectTypeOf(start).parameter(0).toEqualTypeOf<"create-deck" | "add-photo" | "say-hello">();
            if (task.id === "say-hello") expectTypeOf(task.description).toEqualTypeOf<"No guidance needed">();
            return task.title;
          }}
        />
      ),
      // @ts-expect-error a React checklist needs titled tasks
      plain: <Checklist checklist={plain.checklists.all} />,
    };
    expect(Object.keys(elements)).toHaveLength(3);

    // Never called: hooks need a component.
    const Headless = () => {
      const { start } = useChecklist(onboarding.checklists.decks);
      expectTypeOf(start).parameter(0).toEqualTypeOf<"create-deck">();
      return null;
    };
    expectTypeOf(Headless).toBeFunction();
  });

  it("types a task written with satisfies from the app context and requires a title", () => {
    const task = {
      title: "Add a photo",
      action: { label: "Choose", onSelect: () => {} },
      isComplete: (c) => {
        expectTypeOf(c).toEqualTypeOf<AppContext>();
        return c.hasPhoto;
      },
    } satisfies ReactTask<AppContext>;
    expectTypeOf(task.title).toEqualTypeOf<string>();
    // @ts-expect-error a React task has a title
    const untitled = { walkthrough: deckSteps } satisfies ReactTask<AppContext>;
    const plain = {
      title: "x",
      // @ts-expect-error steps need content
      walkthrough: defineCoreWalkthrough({ id: "save", steps: [{ waymark: "save" }] }),
    } satisfies ReactTask<AppContext>;
    expectTypeOf([untitled, plain]).toBeArray();
    expectTypeOf<WalkthroughStep["content"]>().not.toBeNever();
  });
});
