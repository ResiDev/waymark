// packages/core/src/run/run.ts — about 175 lines.
//
// Owns: the Run's snapshot, its server snapshot and its listeners, and the one
// change pipeline, `commit`, the only maker of a `Change`.
//
// Otherwise a composition root. It makes each owner, hands each the reads it
// needs of the others, and wires `Run` onto them. A Run method here is wiring
// only: take the definition, hold while loading, make a change, call the
// owner. Policy belongs in the owner.
//
// Who reads whom. An arrow is "reads, or asks to change". No owner keeps a copy
// of another's state, and each factory's parameter type names exactly what it
// reads of each neighbour.
//
//   walkthroughs → attachments
//   beacons      → walkthroughs
//   checklists   → walkthroughs, storage
//   page         → walkthroughs, beacons, attachments
//   storage      → each `Durable` in `record`, handed to it once they are made
//   run.ts       → all of them
//
// The one pair that talk both ways is storage and the record's owners: the
// owners read whether it is loading, and it hands them each record read. It
// does so through `Durable`, so storage imports no owner.

import { inDevelopment } from "../dev";
import type { Moment } from "../checklists/tasks";
import type { Checklist } from "../checklists/types";
import { problemReporter } from "../problems";
import type { WaymarkProblem } from "../problems";
import { createQueue } from "../queue";
import { listen } from "../subscribe";
import type { Walkthrough } from "../walkthrough/types";
import { createAttachments } from "./attachments";
import { createBeacons } from "./beacons";
import type { Change, Flags, Gathered, RecordOwners } from "./change";
import { createChecklists } from "./checklists";
import { createPage } from "./page";
import { createStorage } from "./storage";
import type { Run, RunEvent, RunOptions, RunSnapshot } from "./types";
import { createWalkthroughs } from "./walkthroughs";

const NO_BEACONS: RunSnapshot["beacons"] = Object.freeze([]);

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
// The body works on any walkthrough, as one Run holds walkthroughs of many
// step types. TypeScript checks this signature against the one above only
// loosely.
export function createRun(options: RunOptions = {}): Run {
  // Read as late as possible, so a Run can be made on a server, where there is no document.
  const root = () => options.root ?? document;
  const report = problemReporter(options.problemHandlers);
  const queue = createQueue("Waymark callbacks failed.", report);

  // Leaves first: every command waits on storage, and a walkthrough opens attached or not.
  const storage = createStorage({ options, report, queue, make });
  const attachments = createAttachments(root);
  const walkthroughs = createWalkthroughs({ attached: attachments.attached });
  const beacons = createBeacons(walkthroughs);
  const checklists = createChecklists({ walkthroughs, storage, make, queue, context: options.context });
  const page = createPage({ root, queue, make, attachments, walkthroughs, beacons });
  const record: RecordOwners = { walkthroughs: walkthroughs.record, tasks: checklists.record };

  let snapshot: RunSnapshot = {
    storageStatus: storage.status(),
    progress: walkthroughs.progress(),
    open: null,
    beacons: NO_BEACONS,
  };
  const listeners = new Set<(snapshot: RunSnapshot) => void>();

  /** What saves and checklist events are worked out from: the change between two of these. */
  const moment = (): Moment => ({ statuses: checklists.statuses(), progress: walkthroughs.progress() });

  /** `previous` itself when no part changed, so identity means "nothing to redraw". */
  const assemble = (previous: RunSnapshot): RunSnapshot => {
    // TODO: as `build` today, each part from its owner:
    // const storageStatus = storage.status();
    // const progress = walkthroughs.progress();
    // const open = walkthroughs.shown(previous.open, checklists.taskOf);
    // const shown = beacons.shown(previous.beacons);
    // return every part `===` previous's ? previous : { storageStatus, progress, open, beacons: shown };
    throw new Error("not implemented");
  };

  // A declaration, not a const: every owner above is handed it before `commit`
  // can run, and none calls it until `createRun` reads the record below.
  function make(work: (change: Change) => void, flags?: Flags): void {
    queue.run(() => commit(work, flags));
  }

  /**
   * One change, from its work to its announcement. The order is load-bearing,
   * and this is the only place it is written down. Each step is one owner's;
   * no owner calls another's step.
   */
  function commit(work: (change: Change) => void, flags: Flags = {}): void {
    // TODO:
    // 1.   const before = moment(); const [change, gather] = openChange();
    // 2.   work(change);
    // 3.   // When nothing is open, a waiting request goes before the beacons show.
    //      beacons.settle(change, walkthroughs.settle(change));
    // 4–5. // Before `after`, so a Task its walkthrough finished is saved and announced as done.
    //      checklists.settle(change, before);
    //      const after = moment();
    //      // Nothing after the settling writes; a write to `change` from here on throws in development.
    //      const { events, problems, credits }: Gathered = gather();
    // 6.   // Every snapshot is up to date before any callback runs, so a callback that reads another sees this change too.
    //      const next = assemble(snapshot); const changed = next !== snapshot; snapshot = next;
    //      const views = checklists.refresh();
    // 7.   page.sync();
    // 8.   if (changed) queue.notify(listeners, snapshot);
    //      views.notify();
    // 9.   if (flags.persist !== false) storage.save(before, after);
    // 10.  // After notify, so a handler sees a renderer that has already redrawn.
    //      for (const problem of problems) queue.invoke(() => report(problem));
    // 11.  const onEvent = options.onEvent; if (onEvent === undefined) return;
    //      const announced = flags.silent === true ? events : [...events, ...views.events(before, after, credits)];
    //      for (const event of announced) queue.callApp("onEvent", () => onEvent(event));
    throw new Error("not implemented");
  }

  // `initial` is a record in hand, so a server render shows it too; the adapter's is read after.
  storage.takeInitial(record);
  snapshot = assemble(snapshot);
  /** What a server render shows: it cannot see the browser's storage. */
  const serverSnapshot = snapshot;
  checklists.captureServer();
  storage.load(record);

  return {
    start: (walkthrough) => {
      // Taken before it is held, so a second definition under its id throws where it was handed over.
      const taken = walkthroughs.take(walkthrough);
      storage.later(() => make((change) => walkthroughs.start(change, taken)));
    },
    requestStart: (walkthrough) => {
      const taken = walkthroughs.take(walkthrough);
      let withdrawn = false;
      storage.later(() => {
        if (!withdrawn) make((change) => walkthroughs.request(change, taken));
      });
      return () => {
        withdrawn = true;
        walkthroughs.withdraw(taken);
      };
    },
    act: (action, walkthrough) => {
      const given = walkthrough === undefined ? undefined : walkthroughs.take(walkthrough);
      storage.later(() => {
        // The one open as the command runs, so a command held while loading acts on what loaded.
        const target = given ?? walkthroughs.open()?.walkthrough;
        if (target !== undefined) make((change) => walkthroughs.act(change, target, action));
      });
    },
    reset: (walkthrough) => {
      const taken = walkthroughs.take(walkthrough);
      storage.later(() => make((change) => walkthroughs.act(change, taken, "reset")));
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: listen(queue, listeners, () => snapshot),
    attach: page.attach,
    setContext: checklists.setContext,
    checklist: <TTask extends { readonly id: string }>(definition: Parameters<Run["checklist"]>[0]) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made for this definition, whose Tasks are TTask.
      checklists.checklist(definition) as Checklist<TTask>,
    skipTask: checklists.skipTask,
  };
}

/**
 * The one maker of a `Change`, and not exported, so nothing can change outside
 * `commit`. `gather` closes it: what it gathered is read once, and a write
 * after that, from a module that kept the `Change`, throws in development.
 */
function openChange(): readonly [Change, () => Gathered] {
  // TODO:
  // const events: RunEvent[] = []; const problems: WaymarkProblem[] = []; const credits = new Map<string, string>();
  // let open = true;
  // const write = <T>(push: (value: T) => void) => (value: T) => { if (!open && inDevelopment()) throw ...; push(value); };
  // return [
  //   { event: write((e) => events.push(e)), problem: write((p) => problems.push(p)), credit: (task, checklist) => ... credits.set(task, checklist) },
  //   () => { open = false; return { events, problems, credits }; },
  // ];
  throw new Error("not implemented");
}
