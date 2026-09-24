import { actions, createRun, defineWalkthrough } from "waymark";
import type { Action, Run, RunEvent, RunOptions, Snapshot, Step, Walkthrough } from "waymark";

/**
 * A lab for core. The page can be put into situations, a walkthrough can be
 * written as JSON, and the run's snapshot and events are shown as they happen.
 *
 * The whole starting state lives in the URL, so a link is a reproduction:
 *
 *   /?situations=sticky,late&steps=[{"waymark":"save"}]&padding=12&startAt=0
 *
 * The same API is on `window.waymark` for scripts and the console.
 */

// ---- situations: what the page is like ---------------------------------------

type Situation = Readonly<{ describe: string; apply: () => void }>;

const target = () => document.querySelector<HTMLElement>('[data-waymark="save"]');
let removed: { element: HTMLElement; parent: Node; next: Node | null } | undefined;

const removeTarget = () => {
  const element = target();
  if (!element) return;
  removed = { element, parent: element.parentNode!, next: element.nextSibling };
  element.remove();
};
const restoreTarget = () => {
  if (!removed) return;
  removed.parent.insertBefore(removed.element, removed.next);
  removed = undefined;
};

const situations: Record<string, Situation> = {
  sticky: { describe: "sticky header covers the top 60px", apply: () => document.body.classList.add("sticky") },
  panel: { describe: "content scrolls inside a panel, not the window", apply: () => document.body.classList.add("panel") },
  transform: { describe: "content is translated and scaled", apply: () => document.body.classList.add("transform") },
  late: { describe: "the save waymark mounts after 1s", apply: () => { removeTarget(); setTimeout(restoreTarget, 1000); } },
  shift: { describe: "layout shifts down 200px after 500ms", apply: () => setTimeout(() => document.body.classList.add("shifted"), 500) },
};

/** Things to do to the page while a run is going. Not part of the URL: they are a script. */
const pageActions: Record<string, () => void> = {
  "remove save": removeTarget,
  "restore save": restoreTarget,
  "shift layout": () => document.body.classList.toggle("shifted"),
  "scroll top": () => (document.body.classList.contains("panel") ? document.querySelector("#content")! : window).scrollTo({ top: 0 }),
};

// ---- walkthroughs as JSON ----------------------------------------------------

/** State predicates by name, since a function cannot live in a URL. */
const predicates: Record<string, (el: Element | null) => boolean> = {
  nameFilled: (el) => el instanceof HTMLInputElement && el.value.length >= 3,
  never: () => false,
};

/** Replace `advance: { state: "<name>" }` with the named predicate. */
const hydrate = (step: Step): Step => {
  const advance = step.advance as unknown;
  if (typeof advance !== "object" || advance === null || !("state" in advance)) return step;
  if (typeof advance.state !== "string") return step;
  const predicate = predicates[advance.state];
  if (!predicate) throw new Error(`Unknown predicate "${advance.state}". Known: ${Object.keys(predicates).join(", ")}`);
  return { ...step, advance: { ...advance, state: predicate } } as Step;
};

const DEFAULT_STEPS: readonly Step[] = [
  { waymark: "save", advance: "click" },
  { waymark: "name", advance: { state: "nameFilled" as never, then: "unlock" } },
  { waymark: "footer" },
  {},
];

// ---- the run -----------------------------------------------------------------

type StartOptions = Readonly<{ waymarkPadding?: number; startAt?: number }>;

let run: Run | undefined;
let stop: (() => void) | undefined;
const events: RunEvent[] = [];

const start = (steps: readonly Step[], options: StartOptions = {}) => {
  stop?.();
  events.length = 0;
  const runOptions: RunOptions = {
    ...(options.waymarkPadding === undefined ? {} : { waymarkPadding: options.waymarkPadding }),
    ...(options.startAt === undefined ? {} : { startAt: options.startAt }),
    onEvent: (event) => {
      events.push(event);
      render();
    },
  };
  run = createRun(defineWalkthrough(steps.map(hydrate)) as Walkthrough, runOptions);
  stop = run.subscribe(render);
  render();
  return run;
};

// ---- the URL: the whole starting state ---------------------------------------

type PageState = Readonly<{ situations: readonly string[]; steps: readonly Step[]; options: StartOptions }>;

const readUrl = (): PageState => {
  const q = new URLSearchParams(location.search);
  const stepsParam = q.get("steps");
  const num = (key: string) => (q.get(key) === null ? undefined : Number(q.get(key)));
  const padding = num("padding");
  const startAt = num("startAt");
  return {
    situations: q.get("situations")?.split(",").filter(Boolean) ?? [],
    steps: stepsParam ? (JSON.parse(stepsParam) as Step[]) : DEFAULT_STEPS,
    options: {
      ...(padding === undefined ? {} : { waymarkPadding: padding }),
      ...(startAt === undefined ? {} : { startAt }),
    },
  };
};

const writeUrl = (state: PageState) => {
  const q = new URLSearchParams();
  if (state.situations.length) q.set("situations", state.situations.join(","));
  q.set("steps", JSON.stringify(state.steps));
  if (state.options.waymarkPadding !== undefined) q.set("padding", String(state.options.waymarkPadding));
  if (state.options.startAt !== undefined) q.set("startAt", String(state.options.startAt));
  history.replaceState(null, "", `?${q}`);
};

/** Apply a whole state, in the one order that always works: page, then run. */
const apply = (state: PageState) => {
  for (const name of state.situations) {
    const situation = situations[name];
    if (!situation) throw new Error(`Unknown situation "${name}". Known: ${Object.keys(situations).join(", ")}`);
    situation.apply();
  }
  return start(state.steps, state.options);
};

// ---- what a person sees --------------------------------------------------------

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const ui = {
  situations: $<HTMLDivElement>("#situations"),
  page: $<HTMLDivElement>("#page"),
  steps: $<HTMLTextAreaElement>("#steps"),
  padding: $<HTMLInputElement>("#padding"),
  startAt: $<HTMLInputElement>("#startAt"),
  start: $<HTMLButtonElement>("#start"),
  actions: $<HTMLDivElement>("#actions"),
  status: $<HTMLDivElement>("#status"),
  snapshot: $<HTMLPreElement>("#snapshot"),
  log: $<HTMLPreElement>("#log"),
  halo: $<HTMLDivElement>("#halo"),
};

const describe = (snapshot: Snapshot): string => {
  if (snapshot.phase !== "running") return `${snapshot.phase} at step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`;
  const parts = [
    `step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`,
    snapshot.waymark.status,
    snapshot.canAdvance ? "gate open" : "gate shut",
  ];
  if (snapshot.collapsed) parts.push("collapsed");
  return parts.join(" · ");
};

function render() {
  const snapshot = run?.getSnapshot();
  ui.status.textContent = snapshot ? describe(snapshot) : "No run.";
  ui.snapshot.textContent = snapshot ? JSON.stringify({ ...snapshot, step: undefined }, null, 1) : "";
  ui.log.textContent = events
    .map((event, i) => `${String(i + 1).padStart(2)} ${event.type.padEnd(8)} on step ${event.stepIndex + 1} → ${describe(event.snapshot)}`)
    .join("\n");
  ui.log.scrollTop = ui.log.scrollHeight;

  const rect =
    snapshot?.phase === "running" && snapshot.waymark.status === "found" && !snapshot.collapsed
      ? snapshot.waymark.rect
      : undefined;
  ui.halo.style.display = rect ? "block" : "none";
  if (rect) {
    ui.halo.style.left = `${rect.left}px`;
    ui.halo.style.top = `${rect.top}px`;
    ui.halo.style.width = `${rect.width}px`;
    ui.halo.style.height = `${rect.height}px`;
  }
}

const button = (label: string, title: string, onClick: () => void) => {
  const el = document.createElement("button");
  el.textContent = label;
  el.title = title;
  el.addEventListener("click", onClick);
  return el;
};

const initial = readUrl();

for (const [name, situation] of Object.entries(situations)) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = name;
  box.checked = initial.situations.includes(name);
  label.title = situation.describe;
  label.append(box, ` ${name}`);
  ui.situations.append(label);
}
for (const [name, act] of Object.entries(pageActions)) ui.page.append(button(name, "", act));
for (const action of actions) ui.actions.append(button(action, "", () => run?.act(action)));

ui.steps.value = JSON.stringify(initial.steps);
ui.padding.value = String(initial.options.waymarkPadding ?? 0);
ui.startAt.value = String(initial.options.startAt ?? 0);

/** Start from the panel: the URL is rewritten, then the page reloads into that state. */
ui.start.addEventListener("click", () => {
  const situationsChecked = [...ui.situations.querySelectorAll<HTMLInputElement>("input:checked")].map((b) => b.value);
  const padding = Number(ui.padding.value);
  const startAt = Number(ui.startAt.value);
  writeUrl({
    situations: situationsChecked,
    steps: JSON.parse(ui.steps.value) as Step[],
    options: { ...(padding ? { waymarkPadding: padding } : {}), ...(startAt ? { startAt } : {}) },
  });
  location.reload();
});

// ---- what a script drives ------------------------------------------------------

declare global {
  interface Window {
    waymark: {
      createRun: typeof createRun;
      defineWalkthrough: typeof defineWalkthrough;
      /** Start a run on the page as it is. Steps may name predicates by string. */
      start: typeof start;
      /** Put the page into situations, then start. Same as loading a URL. */
      apply: typeof apply;
      page: typeof pageActions;
      snapshot: () => Snapshot;
      act: (action: Action) => void;
      events: RunEvent[];
    };
  }
}

window.waymark = {
  createRun,
  defineWalkthrough,
  start,
  apply,
  page: pageActions,
  snapshot: () => {
    if (!run) throw new Error("No run started.");
    return run.getSnapshot();
  },
  act: (action) => run?.act(action),
  events,
};

apply(initial);
