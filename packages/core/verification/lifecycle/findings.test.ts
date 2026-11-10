// What Lifecycle.tla found, on the real Run. Each `it.fails` states the behaviour
// the user should see; it fails today, so the suite stays green, and flips once
// the code is fixed. The Broken*.cfg next to each finding shows TLC's trace.
import { describe, expect, it } from "vitest";
import type { StoredRecord } from "../../src/storage/records";
import { connected } from "../../src/test/run";
import { elsewhere } from "../../src/test/storage";
import type { WalkthroughProgress } from "../../src/walkthrough/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";

// This tab's release: the tour has two steps. Another tab's has three.
const tour = defineWalkthrough({ id: "tour", steps: [{}, {}] });
const hint = defineWalkthrough({ id: "hint", steps: [{}], dismiss: "exit" });

const record = (walkthroughs: StoredRecord["walkthroughs"]): StoredRecord => ({ version: 1, walkthroughs, tasks: {} });

const running = (step: number, stepCount: number, collapsed: boolean, changedAt = Date.now() + 60_000): WalkthroughProgress => ({
  status: "running",
  step,
  stepCount,
  collapsed,
  changedAt,
});

// The newer release's tour, collapsed on its third step, which this release does not have.
const onThirdStep = (collapsed: boolean) => record({ tour: running(2, 3, collapsed) });

// StepInRange and ChangesNeverThrow, BrokenStepInRange.cfg and BrokenChangesNeverThrow.cfg.
// record.ts heardWalkthroughProgress takes the heard entry of a walkthrough this
// tab knows without checking it against the definition, as verifyOne does.
describe("another tab on a release where the tour has more steps", () => {
  it.fails("hears the tour on a step this release does not have without throwing", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");

    expect(() => push(onThirdStep(true))).not.toThrow();
  });

  it.fails("lets the user close the open hint after hearing the tour on a step this release does not have", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");
    run.start(hint);
    push(onThirdStep(false));

    run.act("exit");
    expect(run.getSnapshot().open).toBeNull();
  });

  // BrokenStartAlwaysShows.cfg: run.md:285, a click always shows something.
  it.fails("opens the tour from its button after hearing it on a step this release does not have", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");
    run.start(hint);
    push(onThirdStep(false));

    run.start(tour);
    expect(run.getSnapshot().open?.walkthrough.id).toBe("tour");
  });
});

// HintNeverPartWay, BrokenHintNeverPartWay.cfg. Thread 6, option b: a hint open
// in another tab shows no beacon here. record.ts:61 collapses every heard open
// entry, hints included.
describe("a hint open in another tab", () => {
  it.fails("shows no beacon for a hint open in another tab", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(hint);
    run.act("exit");

    push(record({ hint: running(0, 1, false) }));
    expect(run.getSnapshot().beacons).toEqual([]);
  });

  // The same line, reached by a save in another tab that echoes this page's own
  // stored hint before the hint's page mounts. run.md:381 says a restored hint
  // never waits part way.
  it.fails("shows no beacon for a hint restored open when another tab saves before its page mounts", () => {
    const stored = record({ hint: running(0, 1, false, Date.now()) });
    const { storage, push } = elsewhere(stored);
    const run = connected({ storage });
    push(stored);

    run.requestStart(hint);
    expect(run.getSnapshot().beacons).toEqual([]);
  });
});

// RestoredReopens, BrokenRestoredReopens.cfg. run.md:378: once the definition
// arrives, a walkthrough that was open opens again if nothing else is. A heard
// record that only echoes this page's stored entry collapses it first. The
// echo cannot tell this page's last state from the tour open in another tab,
// so this one needs the user's decision.
describe("a tour restored open", () => {
  it.fails("reopens a tour restored open, with nothing else open, though another tab saved before its page mounts", () => {
    const stored = record({ tour: running(1, 2, false, Date.now()) });
    const { storage, push } = elsewhere(stored);
    const run = connected({ storage });
    push(stored);

    run.requestStart(tour);
    expect(run.getSnapshot().open?.walkthrough.id).toBe("tour");
  });
});
