import { createChecklists } from "./checklists";
import { defineWalkthrough } from "./walkthrough";

const owner = createChecklists({
  context: { isDeck: false },
  tasks: {
    "create-deck": {
      meta: { title: "Create a deck" },
      walkthrough: defineWalkthrough([
        {
          waymark: "createdeck",
          advance: "click",
          meta: { text: "Press new deck" },
        },
      ]),
      isComplete: (c) => c.isDeck,
    },
    "some-other-task": {
      walkthrough: defineWalkthrough([
        { advance: { event: [], state: () => true } },
      ]),
    },
  },
  checklists: {
    home: ["create-deck"],
    all: ["create-deck", "some-other-task"],
  },

  onChange: (stored) => console.log("save", stored.done, stored.skipped),
  onEvent: (event) => {
    switch (event.type) {
      case "taskStarted":
        console.log("started", event.task.id);
        return;
      case "taskComplete":
        console.log("complete", event.task.id);
        return;
      case "taskStopped":
        console.log("stopped", event.task.id, event.reason);
        return;
      case "taskSkipped":
        console.log("skipped", event.task.id, "in", event.checklist);
        return;
      case "checklistComplete":
        console.log(
          "checklist complete",
          event.checklist,
          event.snapshot.finishedCount,
        );
        return;
      default:
        // Fails to compile if a new event type is added and not handled above.
        event satisfies never;
    }
  },
});

const { home, all } = owner.checklists;

all.skip("some-other-task");
owner.update({ isDeck: true });

console.log(home.getSnapshot().complete, all.getSnapshot().tasks);
