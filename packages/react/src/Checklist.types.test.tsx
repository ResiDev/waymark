import { describe, expect, expectTypeOf, it } from "vitest";
import { defineWalkthrough as defineCoreWalkthrough } from "waymark";
import { Checklist, createChecklists, defineTask, defineWalkthrough, useChecklist, Walkthrough } from "./index";
import type { WalkthroughStep } from "./types";

/**
 * The adapter's inference claims, checked by `tsc`. Nothing here runs a
 * component; the elements are built and discarded.
 */

const initialContext = { hasDeck: false, hasPhoto: false };
type AppContext = typeof initialContext;

const deckSteps = defineWalkthrough([{ content: "Open decks", helpUrl: "/help" }, { content: "Press new" }]);
const photoSteps = defineWalkthrough([{ content: "Pick a photo", waymark: "avatar" }]);

const owner = createChecklists({
  context: initialContext,
  tasks: {
    "create-deck": { title: "Create a deck", walkthrough: deckSteps, isComplete: (c) => c.hasDeck },
    "add-photo": defineTask<AppContext>()({ title: "Add a photo", walkthrough: photoSteps }),
    "say-hello": { title: "Say hello", description: "No guidance needed" },
  },
  checklists: { home: ["create-deck", "add-photo", "say-hello"], decks: ["create-deck"] },
});

describe("Walkthrough prop shapes", () => {
  it("accepts either a walkthrough or an owner, never both", () => {
    const elements = {
      owned: <Walkthrough walkthrough={deckSteps} />,
      driven: <Walkthrough checklists={owner} />,
      // @ts-expect-error one shape at a time
      both: <Walkthrough walkthrough={deckSteps} checklists={owner} />,
      // @ts-expect-error padding is an owner option in the checklists shape
      padding: <Walkthrough checklists={owner} waymarkPadding={12} />,
      // @ts-expect-error Run events are an owner option in the checklists shape
      events: <Walkthrough checklists={owner} onEvent={() => {}} />,
      // @ts-expect-error active has no meaning for owner-driven guidance
      active: <Walkthrough checklists={owner} active={false} />,
    };
    expect(Object.keys(elements)).toHaveLength(6);
  });

  it("infers the step union from the owner for custom popovers", () => {
    const element = (
      <Walkthrough
        checklists={owner}
        renderPopover={({ currentStep }) => {
          expectTypeOf(currentStep.content).toEqualTypeOf<"Open decks" | "Press new" | "Pick a photo">();
          // Only some steps carry helpUrl or a waymark; narrow first.
          expectTypeOf(currentStep).not.toHaveProperty("helpUrl");
          expectTypeOf(currentStep).not.toHaveProperty("waymark");
          if ("helpUrl" in currentStep) expectTypeOf(currentStep.helpUrl).toEqualTypeOf<"/help">();
          return currentStep.content;
        }}
      />
    );
    expect(element).toBeTruthy();
  });

  it("rejects owners whose walkthroughs have no React content", () => {
    const plain = createChecklists({
      context: {},
      tasks: { save: { walkthrough: defineCoreWalkthrough([{ waymark: "save" }]) } },
      checklists: { all: ["save"] },
    });
    // @ts-expect-error steps without content cannot be drawn
    const element = <Walkthrough checklists={plain} />;
    expect(element).toBeTruthy();
  });
});

describe("Checklist and useChecklist", () => {
  it("types views over their selected React tasks", () => {
    const plain = createChecklists({ context: {}, tasks: { a: {} }, checklists: { all: ["a"] } });
    const elements = {
      decks: <Checklist checklist={owner.checklists.decks} />,
      home: (
        <Checklist
        checklist={owner.checklists.home}
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

    // Never called: hooks need a component. The types are what matter here.
    const Headless = () => {
      const { start } = useChecklist(owner.checklists.decks);
      expectTypeOf(start).parameter(0).toEqualTypeOf<"create-deck">();
      return null;
    };
    expectTypeOf(Headless).toBeFunction();
  });

  it("types defineTask from the app context and requires a title", () => {
    const task = defineTask<AppContext>()({
      title: "Add a photo",
      action: { label: "Choose", onSelect: () => {} },
      isComplete: (c) => {
        expectTypeOf(c).toEqualTypeOf<AppContext>();
        return c.hasPhoto;
      },
    });
    expectTypeOf(task.title).toEqualTypeOf<"Add a photo">();
    // @ts-expect-error a React task has a title
    defineTask<AppContext>()({ walkthrough: deckSteps });
    // @ts-expect-error steps need content
    defineTask<AppContext>()({ title: "x", walkthrough: defineCoreWalkthrough([{ waymark: "save" }]) });
    expectTypeOf<WalkthroughStep["content"]>().not.toBeNever();
  });
});
