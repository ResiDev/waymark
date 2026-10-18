// Sketch: packages/core/src/run/run.ts (~270 lines implemented)
// The imperative shell. It holds the one mutable model and everything that
// talks to the outside: the queue, listeners, storage, the app's callbacks,
// the page (page.ts). It turns each public call into a Command, hands it to
// `commit`, and runs the effects that come back, in the order they come.

import type { Moment } from "../checklists/tasks";
import type { AnyTask, Checklist, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import { inDevelopment } from "../dev";
import { problemReporter, recordUnreadable, storageFailed } from "../problems";
import { createQueue } from "../queue";
import { adapterOf, loadFrom, saveTo } from "../storage/adapter";
import { parseRecord, storedRecord } from "../storage/records";
import type { Parsed, Read, StoredChanges } from "../storage/records";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import { addView, commit, initial, join as joined, take as taken, withdraw } from "./core";
import type { Command, Effect, Model, TaskCommand, Verdicts } from "./model";
import { createPage } from "./page";
import { conditionsDue, selectChecklist, taskWalkthrough } from "./select";
import type { Run, RunOptions, RunSnapshot } from "./types";

type Handle = Readonly<{
  checklist: Checklist<AnyTask>;
  listeners: Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>;
}>;

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
export function createRun(options: RunOptions = {}): Run {
  // Read as late as possible, so a Run can be made on a server, where there is no document.
  const root = () => options.root ?? document;
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  /** The one mutable thing. Only `change` and the edits replace it, never in place. */
  let model: Model = initial(adapter !== undefined && options.initial === undefined ? "loading" : "ready");
  /** What checklists' conditions read. Only the shell holds it: only the shell calls them. */
  let context = options.context;
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  /** One `Checklist` per definition, and who listens to it. Its snapshot lives in the model. */
  const handles = new Map<ChecklistDefinition<AnyTask>, Handle>();

  /**
   * One change. `make` runs in the queue, so it sees every change before it,
   * and it is where the app's code runs, conditions asked and the page
   * measured, before the core, which nothing can re-enter.
   */
  const change = (make: () => Command) =>
    queue.run(() => {
      const command = make();
      const done = commit(model, command, { now: Date.now(), attached: page.attached() });
      // Every snapshot is in before any effect runs.
      model = done.model;
      for (const effect of done.effects) perform(effect);
    });

  const page = createPage({ root, model: () => model, change, fail: queue.fail });

  const perform = (effect: Effect): void => {
    switch (effect.kind) {
      case "scroll":
        effect.to.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      case "watch":
        page.watch(effect.wanted);
        return;
      case "look":
        page.look([effect.start]);
        return;
      case "notify":
        queue.notify(listeners, effect.snapshot);
        return;
      case "notifyChecklist": {
        const handle = handles.get(effect.definition);
        if (handle !== undefined) queue.notify(handle.listeners, effect.snapshot);
        return;
      }
      case "save":
        save(effect.changes, effect.record);
        return;
      case "report": {
        const { problem } = effect;
        queue.invoke(() => report(problem));
        return;
      }
      case "announce": {
        const { onEvent } = options;
        const { event } = effect;
        if (onEvent !== undefined) queue.callApp("onEvent", () => onEvent(event));
        return;
      }
    }
  };

  /** Storage gets only what changed, so a save never writes over what this Run doesn't know. */
  const save = (changes: StoredChanges, record: Moment) => {
    if (adapter !== undefined) queue.invoke(() => saveTo(adapter, changes, (error) => report(storageFailed(error))));
    const { onChange } = options;
    if (onChange === undefined) return;
    const stored = storedRecord(record.progress, record.statuses);
    queue.callApp("onChange", () => onChange(stored));
  };

  /** While the record loads, a command waits, so it acts on the user's progress rather than none. */
  const later = (command: () => void) => {
    if (model.state.storageStatus === "loading") held.push(command);
    else command();
  };

  /** The Run's definition for this id; another under an id already taken is a mistake. */
  const take = (walkthrough: Walkthrough): Walkthrough => {
    const result = taken(model, walkthrough);
    if (result.clash && inDevelopment()) {
      throw new Error(
        `Walkthrough "${walkthrough.id}" was handed to the Run by two different definitions. Define each walkthrough once, outside render, and give each its own id.`,
      );
    }
    model = result.model;
    return result.walkthrough;
  };

  /**
   * Each due condition's answer, asked in task order. Every one is asked
   * before anything is recorded, so one that throws is reported and nothing
   * changes.
   */
  const verdicts = (): Verdicts => {
    if (context === undefined) return undefined;
    const met = new Map<string, boolean>();
    for (const { id, isComplete } of conditionsDue(model.state)) {
      try {
        met.set(id, Boolean(isComplete(context)));
      } catch (error) {
        queue.fail("isComplete", error);
        return undefined;
      }
    }
    return met;
  };

  /** A checklist's Tasks, their walkthroughs and the checklists beside it reach the Run the first time one is used. */
  const join = (group: ChecklistGroup) => {
    if (model.state.known.groups.has(group)) return;
    const walkthroughs = group.tasks.flatMap((task) => (task.walkthrough === undefined ? [] : [take(task.walkthrough)]));
    model = joined(model, group);
    // Silent: a checklist reaching the Run must not announce what the user did before.
    if (model.state.storageStatus !== "loading") {
      change(() => ({ kind: "arrive", walkthroughs, verdicts: verdicts() }));
    }
  };

  const checklistOf = (definition: ChecklistDefinition<AnyTask>): Checklist<AnyTask> => {
    const known = handles.get(definition);
    if (known !== undefined) return known.checklist;
    model = addView(model, definition);
    const { name, group } = definition;
    const handleListeners = new Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>();
    const snapshot = () => {
      const shown = model.shown.checklists.get(definition);
      if (shown === undefined) throw new Error("A checklist's view left the Run.");
      return shown;
    };
    const serverSnapshot = selectChecklist(server.state, definition, undefined);
    const command = (kind: TaskCommand) => (id: string) => {
      join(group);
      later(() => change(() => ({ kind: "task", command: kind, id, checklist: name })));
    };
    const checklist: Checklist<AnyTask> = {
      getSnapshot: snapshot,
      getServerSnapshot: () => serverSnapshot,
      subscribe: (listener) => {
        join(group);
        return listen(queue, handleListeners, snapshot)(listener);
      },
      start: (id) => {
        join(group);
        const walkthrough = taskWalkthrough(model.state, id);
        if (walkthrough === undefined) return;
        const start = take(walkthrough);
        later(() => change(() => ({ kind: "start", walkthrough: start, checklist: name })));
      },
      markDone: command("markDone"),
      markTodo: command("markTodo"),
      skip: command("skip"),
      toggle: command("toggle"),
    };
    handles.set(definition, { checklist, listeners: handleListeners });
    return checklist;
  };

  // Loading

  const loaded = (read: Parsed<Read> | "failed") => {
    try {
      // Restoring saves nothing: storage already holds it.
      change(() => ({ kind: "loaded", read }));
      change(() => ({ kind: "arrive", walkthroughs: "all", verdicts: verdicts() }));
      for (const command of held.splice(0)) command();
    } finally {
      adapter?.subscribe?.(hear);
    }
  };

  /** A record saved elsewhere, such as in another tab. Checked here, at the boundary; the core gets a Read. */
  const hear = (value: unknown) => {
    const parsed = parseRecord(value);
    if (!parsed.ok) {
      report(recordUnreadable(parsed.error));
      return;
    }
    change(() => ({ kind: "heard", read: parsed.value }));
    // A Task held done by its condition stays done, though the record heard lacks it.
    change(() => ({ kind: "arrive", walkthroughs: [], verdicts: verdicts() }));
  };

  if (options.initial !== undefined) loaded(parseRecord(options.initial));
  /** What a server render shows: it cannot see the browser's storage. A value, so nothing can change it. */
  const server = model;
  if (adapter !== undefined && options.initial === undefined) {
    loadFrom(
      adapter,
      (value) => loaded(parseRecord(value)),
      (error) => {
        try {
          report(storageFailed(error));
        } finally {
          loaded("failed");
        }
      },
    );
  }

  return {
    start: (walkthrough) => {
      const start = take(walkthrough);
      later(() => change(() => ({ kind: "start", walkthrough: start })));
    },
    requestStart: (walkthrough) => {
      const requested = take(walkthrough);
      let withdrawn = false;
      later(() => {
        if (!withdrawn) change(() => ({ kind: "request", walkthrough: requested }));
      });
      return () => {
        withdrawn = true;
        model = withdraw(model, requested);
      };
    },
    act: (action, walkthrough) => {
      const given = walkthrough === undefined ? undefined : take(walkthrough);
      later(() => {
        // The one open when the command is given, not when its change runs, as today.
        const target = given ?? model.state.open?.walkthrough;
        if (target !== undefined) change(() => ({ kind: "act", action, walkthrough: target }));
      });
    },
    reset: (walkthrough) => {
      const reset = take(walkthrough);
      later(() => change(() => ({ kind: "reset", walkthrough: reset })));
    },
    getSnapshot: () => model.shown.run,
    getServerSnapshot: () => server.shown.run,
    subscribe: listen(queue, listeners, () => model.shown.run),
    attach: page.attach,
    setContext: (next) => {
      if (Object.is(next, context)) return;
      context = next;
      // Not held: only the latest context matters, and it is checked once the record is in.
      if (model.state.storageStatus !== "loading") change(() => ({ kind: "context", verdicts: verdicts() }));
    },
    checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      checklistOf(definition) as Checklist<TTask>,
    skipTask: (id) => later(() => change(() => ({ kind: "task", command: "skip", id, checklist: undefined }))),
  };
}
