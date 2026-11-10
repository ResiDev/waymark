// What Lifecycle.tla found, on the real Run. Each test states the behaviour the
// user should see. Each was an `it.fails` until the code was fixed; the rule it
// names now holds in MCLifecycle.cfg.
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

// StepInRange and ChangesNeverThrow. record.ts heard took the heard entry of a
// walkthrough this tab knows without checking it against the definition, as
// verifyOne does. It now checks it, and drops a stale one from this tab's record.
describe("another tab on a release where the tour has more steps", () => {
  it("hears the tour on a step this release does not have without throwing", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");

    expect(() => push(onThirdStep(true))).not.toThrow();
  });

  it("lets the user close the open hint after hearing the tour on a step this release does not have", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");
    run.start(hint);
    push(onThirdStep(false));

    run.act("exit");
    expect(run.getSnapshot().open).toBeNull();
  });

  // StartAlwaysShows. run.md:285: a click always shows something.
  it("opens the tour from its button after hearing it on a step this release does not have", () => {
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

// Fixed, so these hold now. A heard record that only echoes this page's stored
// entry used to collapse a walkthrough restored open before its page mounted.
// record.ts now treats the echo as the same write heard again and keeps this
// page's copy. HintNeverPartWay and RestoredReopens in MCLifecycle.cfg check it.

// HintNeverPartWay. run.md:383: a hint is part way through only while it is
// open, here or in another tab, or once the app collapses it.
describe("a hint restored open", () => {
  it("shows no beacon for a hint restored open when another tab saves before its page mounts", () => {
    const stored = record({ hint: running(0, 1, false, Date.now()) });
    const { storage, push } = elsewhere(stored);
    const run = connected({ storage });
    push(stored);

    run.requestStart(hint);
    expect(run.getSnapshot().beacons).toEqual([]);
  });
});

// RestoredReopens. run.md:381: once the definition arrives, a walkthrough that
// was open opens again if nothing else is.
describe("a tour restored open", () => {
  it("reopens a tour restored open, with nothing else open, though another tab saved before its page mounts", () => {
    const stored = record({ tour: running(1, 2, false, Date.now()) });
    const { storage, push } = elsewhere(stored);
    const run = connected({ storage });
    push(stored);

    run.requestStart(tour);
    expect(run.getSnapshot().open?.walkthrough.id).toBe("tour");
  });
});
