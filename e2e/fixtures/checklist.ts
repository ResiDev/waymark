import { createChecklists, createLocalStorageRecord, defineWalkthrough } from "waymark";
import type { Checklist, ChecklistsEvent, Run, Snapshot, Stored } from "waymark";

/**
 * A lab for checklists. The page is a small application; the panel is the
 * checklist UI that application would draw with core alone. Progress persists
 * in local storage under `waymark-checklist`, so a reload keeps it; `clear`
 * forgets it.
 *
 * The same API is on `window.checklists` for scripts and the console.
 */

// ---- the application ------------------------------------------------------------

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const context = { hasDeck: false, hasPhoto: false };
const hasDeck = $<HTMLInputElement>("#has-deck");
const hasPhoto = $<HTMLInputElement>("#has-photo");

/** Steps carry this page's popover text in `meta`, which core keeps and ignores. */
const createDeck = defineWalkthrough([
  { waymark: "new-deck", advance: "click", meta: { text: "Press New deck. The app then has a deck." } },
  { meta: { text: "Decks group the cards you study. That is the whole idea." } },
]);
const addPhoto = defineWalkthrough([
  { waymark: "avatar", advance: "click", meta: { text: "Choose a photo so your teammates can recognise you." } },
]);
const readTips = defineWalkthrough([
  { waymark: "tips", meta: { text: "The tips live down here. Finishing this marks the task done." } },
]);

const record = createLocalStorageRecord("waymark-checklist");
const events: ChecklistsEvent<any, any>[] = [];

const owner = createChecklists({
  context,
  tasks: {
    "create-deck": { meta: { title: "Create your first deck" }, walkthrough: createDeck, isComplete: (c) => c.hasDeck },
    "add-photo": { meta: { title: "Add a profile photo" }, walkthrough: addPhoto, isComplete: (c) => c.hasPhoto },
    "read-tips": { meta: { title: "Read the tips" }, walkthrough: readTips },
    "say-hello": {
      meta: { title: "Understand sharing", description: "Your decks stay private until you share them." },
    },
  },
  checklists: {
    home: ["create-deck", "add-photo", "read-tips", "say-hello"],
    decks: ["create-deck"],
  },
  stored: record.load(),
  onChange: (stored) => {
    record.save(stored);
    renderStored(stored);
  },
  onEvent: (event) => {
    events.push(event);
    renderLog();
  },
  run: { waymarkPadding: 8 },
});

/** The application reacts to its own buttons, then tells the owner what is now true. */
const update = () => owner.update({ hasDeck: hasDeck.checked, hasPhoto: hasPhoto.checked });
$("#new-deck").addEventListener("click", () => {
  hasDeck.checked = true;
  update();
});
$("#avatar").addEventListener("click", () => {
  hasPhoto.checked = true;
  update();
});
hasDeck.addEventListener("change", update);
hasPhoto.addEventListener("change", update);

// ---- the checklist UI --------------------------------------------------------------

const button = (label: string, onClick: () => void, disabled = false) => {
  const el = document.createElement("button");
  el.textContent = label;
  el.disabled = disabled;
  el.addEventListener("click", onClick);
  return el;
};

const ui = {
  checklists: $<HTMLDivElement>("#checklists"),
  owner: $<HTMLDivElement>("#owner"),
  status: $<HTMLDivElement>("#status"),
  stored: $<HTMLPreElement>("#stored"),
  log: $<HTMLPreElement>("#log"),
  halo: $<HTMLDivElement>("#halo"),
  popover: $<HTMLDivElement>("#popover"),
};

/** A generic panel over every view. Each view's ids are typed per checklist; this panel takes any. */
type AnyView = Checklist<{ readonly id: string; readonly [field: string]: unknown }>;
const views = Object.entries(owner.checklists) as unknown as [string, AnyView][];
const sections = new Map(
  views.map(([name]) => {
    const section = document.createElement("section");
    ui.checklists.append(section);
    return [name, section] as const;
  }),
);

function renderView(name: string, view: AnyView) {
  const snapshot = view.getSnapshot();
  const section = sections.get(name)!;
  section.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = name;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = `${snapshot.finishedCount} of ${snapshot.taskCount}${snapshot.complete ? " · complete" : ""}`;
  heading.append(count);
  const list = document.createElement("ol");
  for (const { task, status } of snapshot.tasks) {
    const item = document.createElement("li");
    const active = snapshot.active?.task.id === task.id;
    item.dataset.status = status;
    item.dataset.active = String(active);
    const title = document.createElement("span");
    title.className = "title";
    const meta = task.meta as { title: string; description?: string };
    title.textContent = `${status === "done" ? "✓" : status === "skipped" ? "–" : "○"} ${meta.title}`;
    title.title = meta.description ?? "";
    item.append(title);
    if (task.walkthrough) {
      item.append(button(status === "done" ? "replay" : "start", () => view.start(task.id), active));
    } else if (status === "todo" && !task.isComplete) {
      item.append(button("done", () => view.markDone(task.id)));
    }
    if (status === "todo") item.append(button("skip", () => view.skip(task.id)));
    list.append(item);
  }
  section.append(heading, list);
}

for (const [name, view] of views) {
  renderView(name, view);
  view.subscribe(() => renderView(name, view));
}

ui.owner.append(
  button("stop", () => owner.stop()),
  button("clear", () => owner.clear()),
  button("reload", () => location.reload()),
);

const renderStored = (stored: Stored) => {
  ui.stored.textContent = JSON.stringify(stored);
};
renderStored(record.load());

const describeEvent = (event: ChecklistsEvent<any, any>): string => {
  switch (event.type) {
    case "taskStopped":
      return `${event.type} ${event.task.id} (${event.reason})`;
    case "taskSkipped":
      return `${event.type} ${event.task.id} in ${event.checklist}`;
    case "checklistComplete":
      return `${event.type} ${event.checklist} (${event.snapshot.finishedCount} of ${event.snapshot.taskCount})`;
    default:
      return `${event.type} ${event.task.id}`;
  }
};

function renderLog() {
  ui.log.textContent = events.map((event, i) => `${String(i + 1).padStart(2)} ${describeEvent(event)}`).join("\n");
  ui.log.scrollTop = ui.log.scrollHeight;
}

// ---- guidance: drawing whichever Run the owner holds -------------------------------

owner.bindUi(() => ({ dialog: ui.popover, beacon: null }));

let drawn: { run: Run<any>; stop: () => void } | undefined;

const describeRun = (snapshot: Snapshot): string => {
  if (snapshot.phase !== "running") return snapshot.phase;
  const parts = [`step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`, snapshot.waymark.status];
  if (!snapshot.canAdvance) parts.push("gate shut");
  if (snapshot.collapsed) parts.push("collapsed");
  return parts.join(" · ");
};

function drawRun() {
  const active = owner.getSnapshot().active;
  const snapshot = active?.run.getSnapshot();
  ui.status.textContent = active && snapshot ? `${active.task.id}: ${describeRun(snapshot)}` : "Nothing active.";

  const running = snapshot?.phase === "running" && !snapshot.collapsed ? snapshot : undefined;
  const rect = running?.waymark.status === "found" ? running.waymark.rect : undefined;
  ui.halo.style.display = rect ? "block" : "none";
  if (rect) {
    ui.halo.style.left = `${rect.left - 8}px`;
    ui.halo.style.top = `${rect.top - 8}px`;
    ui.halo.style.width = `${rect.width + 16}px`;
    ui.halo.style.height = `${rect.height + 16}px`;
  }

  const showPopover = running !== undefined && running.waymark.status !== "searching" && running.waymark.status !== "lost";
  ui.popover.style.display = showPopover ? "block" : "none";
  if (running && showPopover) {
    $("#popover .text").textContent = (running.step.meta as { text: string }).text;
    ui.popover.style.left = `${rect ? rect.left : 40}px`;
    ui.popover.style.top = `${rect ? rect.bottom + 16 : 40}px`;
    $<HTMLButtonElement>("#previous").disabled = running.stepIndex === 0;
    $<HTMLButtonElement>("#advance").disabled = !running.canAdvance;
    $<HTMLButtonElement>("#advance").textContent = running.stepIndex === running.stepCount - 1 ? "Finish" : "Next";
  }
}

/** Follow the owner: subscribe to the Run it holds, which is what switches page watching on. */
owner.subscribe(() => {
  const active = owner.getSnapshot().active;
  if (drawn && drawn.run !== active?.run) {
    drawn.stop();
    drawn = undefined;
  }
  if (active && !drawn) {
    drawn = { run: active.run, stop: active.run.subscribe(drawRun) };
  }
  drawRun();
});

$("#previous").addEventListener("click", () => owner.getSnapshot().active?.run.act("previous"));
$("#advance").addEventListener("click", () => owner.getSnapshot().active?.run.act("advance"));
$("#exit").addEventListener("click", () => owner.getSnapshot().active?.run.act("exit"));

drawRun();

// ---- what a script drives ------------------------------------------------------------

declare global {
  interface Window {
    checklists: {
      owner: typeof owner;
      update: typeof update;
      events: typeof events;
      stored: () => Stored;
    };
  }
}

window.checklists = { owner, update, events, stored: record.load };
