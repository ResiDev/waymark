import { actions, createRun, defineWalkthrough } from "waymark";
import type { Run, RunEvent, Snapshot, Walkthrough } from "waymark";

/**
 * Named scenarios: the test picks one by name, because a Step's `state`
 * predicate is a function and cannot cross the page boundary.
 */
const scenarios = {
  locate: defineWalkthrough([{ waymark: "save" }]),
  scrollOnce: defineWalkthrough([{ waymark: "footer" }]),
  clickToAdvance: defineWalkthrough([{ waymark: "save", advance: "click" }, {}]),
  holdState: defineWalkthrough([
    {
      waymark: "name",
      advance: {
        when: { state: (el) => el instanceof HTMLInputElement && el.value.length >= 3 },
        delayMs: 300,
      },
    },
    {},
  ]),
  tour: defineWalkthrough([
    { waymark: "save", advance: "click" },
    { waymark: "name", advance: { when: { state: (el) => el instanceof HTMLInputElement && el.value.length > 0 }, then: "unlock" } },
    { waymark: "footer" },
    {},
  ]),
} satisfies Record<string, Walkthrough>;

export type ScenarioName = keyof typeof scenarios;

declare global {
  interface Window {
    waymark: {
      start: (name: ScenarioName, options?: { waymarkPadding?: number }) => void;
      snapshot: () => Snapshot;
      act: Run["act"];
      events: RunEvent[];
    };
  }
}

let run: Run | undefined;
let stop: (() => void) | undefined;
const events: RunEvent[] = [];

// ---- what a person sees: the panel and the halo ------------------------------

const panel = {
  scenario: document.querySelector<HTMLSelectElement>("#scenario")!,
  start: document.querySelector<HTMLButtonElement>("#start")!,
  actions: document.querySelector<HTMLDivElement>("#actions")!,
  snapshot: document.querySelector<HTMLPreElement>("#snapshot")!,
  halo: document.querySelector<HTMLDivElement>("#halo")!,
};

const render = () => {
  const snapshot = run?.getSnapshot();
  panel.snapshot.textContent = snapshot
    ? JSON.stringify({ ...snapshot, step: undefined }, null, 2)
    : "No scenario started.";
  const rect =
    snapshot?.phase === "running" && snapshot.waymark.status === "found" && !snapshot.collapsed
      ? snapshot.waymark.rect
      : undefined;
  panel.halo.style.display = rect ? "block" : "none";
  if (rect) {
    panel.halo.style.left = `${rect.left}px`;
    panel.halo.style.top = `${rect.top}px`;
    panel.halo.style.width = `${rect.width}px`;
    panel.halo.style.height = `${rect.height}px`;
  }
};

for (const name of Object.keys(scenarios)) {
  panel.scenario.append(new Option(name, name));
}
for (const action of actions) {
  const button = document.createElement("button");
  button.textContent = action;
  button.addEventListener("click", () => run?.act(action));
  panel.actions.append(button);
}

// ---- what a test drives ------------------------------------------------------

const start = (name: ScenarioName, options: { waymarkPadding?: number } = {}) => {
  stop?.();
  events.length = 0;
  panel.scenario.value = name;
  run = createRun(scenarios[name] as Walkthrough, {
    ...options,
    onEvent: (event) => events.push(event),
  });
  stop = run.subscribe(render);
  render();
};

panel.start.addEventListener("click", () => start(panel.scenario.value as ScenarioName));

window.waymark = {
  start,
  snapshot: () => {
    if (!run) throw new Error("No scenario started.");
    return run.getSnapshot();
  },
  act: (action) => run?.act(action),
  events,
};
