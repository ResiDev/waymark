import { createChecklistLayer } from "../checklists/layer";
import { problemReporter } from "../problems";
import { createQueue } from "../queue";
import { adapterOf } from "../storage/adapter";
import { createPersistence } from "../storage/layer";
import { EMPTY_READ } from "../storage/records";
import type { Read } from "../storage/records";
import type { Walkthrough } from "../walkthrough/types";
import { createCore } from "./core";
import { createPageLayer } from "./page";
import type { Run, RunOptions } from "./types";

/*
 * Where the Run is put together: the core, and the three layers plugged into
 * it, in a fixed order. The only file that knows them all. About 90 lines.
 */

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
// The body works on any walkthrough, as one Run holds walkthroughs of many
// step types. TypeScript checks this signature against the one above only
// loosely.
export function createRun(options: RunOptions = {}): Run {
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);

  // The record is `Read`: one slice per key, each claimed by its owner. A key with no owner throws at `plug`.
  const core = createCore<Read>({
    queue,
    report,
    empty: EMPTY_READ,
    loading: adapter !== undefined && options.initial === undefined,
    onEvent: options.onEvent,
  });
  const { host } = core;
  const checklists = createChecklistLayer(host, { context: options.context });
  const page = createPageLayer(host, { root: () => options.root ?? document });
  const persistence = createPersistence(host, { adapter, onChange: options.onChange, queue, report });
  // Each place in a change calls these in this order. Only checklists publish, only the page has effects,
  // and only storage persists, so no layer relies on another's turn.
  core.plug({
    layers: [checklists.layer, page.layer, persistence.layer],
    ports: { attached: page.attached, taskOf: checklists.taskOf },
  });

  if (options.initial !== undefined) persistence.take(options.initial);
  // What a server render shows: it cannot see the browser's storage.
  core.freezeServer();
  if (options.initial === undefined) persistence.load();

  return {
    start: (walkthrough) => {
      const taken = host.take(walkthrough);
      host.later(() => host.change((tx) => host.start(tx, taken)));
    },
    requestStart: (walkthrough) => {
      const taken = host.take(walkthrough);
      let withdrawn = false;
      host.later(() => {
        if (!withdrawn) host.change((tx) => host.request(tx, taken));
      });
      return () => {
        withdrawn = true;
        host.withdraw(taken);
      };
    },
    act: (action, walkthrough) => {
      const given = walkthrough === undefined ? undefined : host.take(walkthrough);
      host.later(() => {
        const target = given ?? host.open()?.walkthrough;
        if (target !== undefined) host.change((tx) => host.act(tx, target, action));
      });
    },
    reset: (walkthrough) => {
      const taken = host.take(walkthrough);
      host.later(() => host.change((tx) => host.reset(tx, taken)));
    },
    getSnapshot: core.getSnapshot,
    getServerSnapshot: core.getServerSnapshot,
    subscribe: core.subscribe,
    attach: page.attach,
    setContext: checklists.setContext,
    checklist: checklists.checklist,
    skipTask: checklists.skipTask,
  };
}
