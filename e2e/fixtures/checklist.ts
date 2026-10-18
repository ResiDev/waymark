import { createRun, defineChecklists, defineWalkthrough } from "waymark-core";
import type { Checklist, RunSnapshot, Snapshot, StoredRecord, WaymarkEvent } from "waymark-core";

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

type Context = Readonly<{ hasDeck: boolean; hasPhoto: boolean }>;
const hasDeck = $<HTMLInputElement>("#has-deck");
const hasPhoto = $<HTMLInputElement>("#has-photo");

const createDeck = defineWalkthrough({
  id: "createDeck",
  steps: [
    { waymark: "new-deck", advance: "click", meta: { text: "Press New deck. The app then has a deck." } },
    { meta: { text: "Decks group the cards you study. That is the whole idea." } },
  ],
});
const addPhoto = defineWalkthrough({
  id: "addPhoto",
  steps: [{ waymark: "avatar", advance: "click", meta: { text: "Choose a photo so your teammates can recognise you." } }],
});
const readTips = defineWalkthrough({
  id: "readTips",
  steps: [{ waymark: "tips", meta: { text: "The tips live down here. Finishing this marks the task done." } }],
});

/** The Run keeps one record: every walkthrough's progress and the task statuses. */
const STORAGE_KEY = "waymark-checklist";
const readStored = (): StoredRecord | null => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
const events: WaymarkEvent[] = [];

const onboarding = defineChecklists({
  tasks: {
    "create-deck": {
      meta: { title: "Create your first deck" },
      walkthrough: createDeck,
      isComplete: (c: Context) => c.hasDeck,
    },
    "add-photo": {
      meta: { title: "Add a profile photo" },
      walkthrough: addPhoto,
      isComplete: (c: Context) => c.hasPhoto,
    },
    "read-tips": { meta: { title: "Read the tips" }, walkthrough: readTips },
    "say-hello": {
      meta: { title: "Understand sharing", description: "Your decks stay private until you share them." },
    },
  },
  checklists: {
    home: ["create-deck", "add-photo", "read-tips", "say-hello"],
    decks: ["create-deck"],
  },
});

const run = createRun({
  storage: STORAGE_KEY,
  context: { hasDeck: false, hasPhoto: false } satisfies Context,
  onChange: (stored) => renderStored(stored),
  onEvent: (event) => {
    events.push(event);
    renderLog();
  },
});

const update = () => run.setContext({ hasDeck: hasDeck.checked, hasPhoto: hasPhoto.checked } satisfies Context);
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

const button = (label: string, onClick: () => void, disabled = false) => {
  const el = document.createElement("button");
  el.textContent = label;
  el.disabled = disabled;
  el.addEventListener("click", onClick);
  return el;
};

const ui = {
  checklists: $<HTMLDivElement>("#checklists"),
  run: $<HTMLDivElement>("#run"),
  status: $<HTMLDivElement>("#status"),
  stored: $<HTMLPreElement>("#stored"),
  log: $<HTMLPreElement>("#log"),
  halo: $<HTMLDivElement>("#halo"),
  popover: $<HTMLDivElement>("#popover"),
};

// Each view's ids are typed per checklist; this one panel draws them all.
type AnyView = Checklist<{ readonly id: string; readonly [field: string]: unknown }>;
const views = Object.entries(onboarding.checklists).map(([name, definition]) => [
  name,
  run.checklist(definition),
]) as unknown as [string, AnyView][];
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
  for (const { task, status, inProgress } of snapshot.tasks) {
    const item = document.createElement("li");
    const open = snapshot.open?.id === task.id;
    item.dataset.status = status;
    item.dataset.open = String(open);
    item.dataset.inProgress = String(inProgress);
    const title = document.createElement("span");
    title.className = "title";
    const meta = task.meta as { title: string; description?: string };
    title.textContent = `${status === "done" ? "✓" : status === "skipped" ? "–" : "○"} ${meta.title}`;
    title.title = meta.description ?? "";
    item.append(title);
    if (task.walkthrough) {
      const label = status === "done" ? "replay" : inProgress ? "resume" : "start";
      item.append(button(label, () => view.start(task.id), open));
    }
    item.append(button(status === "todo" ? "tick" : "untick", () => view.toggle(task.id)));
    if (status === "todo") item.append(button("skip", () => view.skip(task.id)));
    list.append(item);
  }
  section.append(heading, list);
}

// Each subscribe renders at once, then on every change. The first brings the
// checklists, and their tasks' walkthroughs, to the Run.
for (const [name, view] of views) view.subscribe(() => renderView(name, view));

ui.run.append(
  // The Run has no clear: forgetting the user is a new, empty record.
  button("clear", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }),
  button("reload", () => location.reload()),
);

const renderStored = (stored: StoredRecord | null) => {
  ui.stored.textContent = JSON.stringify(stored);
};
renderStored(readStored());

const describeEvent = (event: WaymarkEvent): string => {
  if ("walkthrough" in event) {
    const by = event.type === "interrupt" ? ` by ${event.interruptedBy}` : "";
    return `${event.type} ${event.walkthrough} on step ${event.stepIndex + 1}${by}`;
  }
  switch (event.type) {
    case "taskStopped":
      return `${event.type} ${event.task.id} (${event.reason})`;
    case "taskSkipped":
    case "taskUnskipped":
      return `${event.type} ${event.task.id}${event.checklist ? ` in ${event.checklist}` : ""}`;
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

const describe = (snapshot: Snapshot): string => {
  if (snapshot.phase !== "running") return snapshot.phase;
  const parts = [`step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`, snapshot.waymark.status];
  if (!snapshot.canAdvance) parts.push("gate shut");
  if (snapshot.collapsed) parts.push("collapsed");
  return parts.join(" · ");
};

const describeRun = ({ open, beacons }: RunSnapshot): string => {
  if (open) return `${open.task ?? open.walkthrough.id}: ${describe(open.snapshot)}`;
  if (beacons.length === 0) return "Nothing open.";
  return `Beacons: ${beacons.map((b) => `${b.walkthrough.id} at step ${b.stepIndex + 1} (${b.waymark.status})`).join(", ")}`;
};

function drawRun(snapshot: RunSnapshot) {
  ui.status.textContent = describeRun(snapshot);
  // This page draws no beacons; a collapsed task resumes from its row.

  const running = snapshot.open?.snapshot;
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

run.subscribe(drawRun);
// This page draws the Run, so it attaches: keys, clicks and the frame loop.
run.attach(() => ({ dialog: ui.popover }), { waymarkPadding: 8 });
// And it runs in the browser, so it starts storage.
run.connect();

$("#previous").addEventListener("click", () => run.act("previous"));
$("#advance").addEventListener("click", () => run.act("advance"));
$("#exit").addEventListener("click", () => run.act("exit"));

declare global {
  interface Window {
    checklists: {
      run: typeof run;
      onboarding: typeof onboarding;
      update: typeof update;
      events: typeof events;
      stored: () => StoredRecord | null;
    };
  }
}

window.checklists = { run, onboarding, update, events, stored: readStored };
