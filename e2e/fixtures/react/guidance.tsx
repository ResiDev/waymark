import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  defineChecklists,
  defineWalkthrough,
  everyProblem,
  localStorageAdapter,
  useRun,
  Walkthrough,
  WaymarkRoot,
  type BeaconRenderProps,
  type ChecklistsEvent,
  type Run,
  type RunSnapshot,
  type Snapshot,
  type StorageAdapter,
  type StoredRecord,
  type WalkthroughRenderProps,
  type WalkthroughStep,
  type WaymarkEvent,
  type WaymarkProblem,
} from "react-waymark";
import { CustomBeacon, CustomPopover } from "./popover";
import { createStore, data, inviteOpen, record, runStatus, setup, useStore, whatsNewOpen, type AppData } from "./state";

// Between them these walkthroughs use every step shape, so the lab exercises each.

const nameLongEnough = (waymark: Element | null) =>
  waymark instanceof HTMLInputElement && waymark.value.trim().length >= 3;

/** Crosses a route: step 2's Waymark mounts only once the decks page has. */
const createDeck = defineWalkthrough({
  id: "createDeck",
  steps: [
    {
      waymark: "nav-decks",
      advance: "click",
      preferredPlacement: "right",
      content: <>Decks live under <b>Decks</b> in the sidebar.</>,
    },
    { waymark: "new-deck", advance: "click", content: "Press New deck." },
    {
      waymark: "deck-name",
      advance: { state: nameLongEnough, then: "unlock" },
      content: "Name it. Next unlocks at three letters.",
    },
    { waymark: "deck-create", advance: "click", content: "Create it." },
    { content: <>That's your first deck. <i>Decks group the cards you study.</i></> },
  ],
});

const addPhoto = defineWalkthrough({
  id: "addPhoto",
  steps: [
    {
      waymark: "avatar",
      advance: "click",
      preferredPlacement: "left",
      content: "Your profile is behind your avatar.",
    },
    { waymark: "upload-photo", advance: "click", content: "Choose a photo. Any will do." },
  ],
});

const tour = defineWalkthrough({
  id: "tour",
  steps: [
    {
      content: (
        <>
          <b>Welcome to Study.</b> A quick look around. <kbd>→</kbd> moves on, <kbd>←</kbd> goes back,{" "}
          <kbd>Esc</kbd> or a click elsewhere collapses this into a beacon.
        </>
      ),
    },
    {
      selector: ".brand",
      preferredPlacement: "below",
      content: "Found by a CSS selector rather than data-waymark.",
    },
    {
      waymark: "search",
      advance: { event: "focus", then: "unlock" },
      content: "Click into search. Next unlocks once it has focus.",
    },
    {
      waymark: "help",
      preferredPlacement: "right",
      content: "Help sits at the right edge, so the popover flips to fit.",
    },
    {
      waymark: "streak",
      advance: { state: () => true, delayMs: 2000 },
      content: "Your streak. This step moves on by itself after two seconds.",
    },
    {
      waymark: "tip",
      preferredPlacement: "below",
      content: "A tip. Press its × to take this step's Waymark out of the page.",
    },
    { waymark: "guide", content: "Far down the page: the Run scrolled here." },
    {
      waymark: "feedback",
      preferredPlacement: "below",
      content: "Feedback, bottom right. There is no room below, so it opens above.",
    },
    { content: "That's the tour.", popoverStyle: { background: "#f0fdf4", borderColor: "#bbf7d0" } },
  ],
});

export const whatsNew = defineWalkthrough({
  id: "whatsNew",
  steps: [
    {
      waymark: "whats-new",
      preferredPlacement: "below",
      content: (
        <>
          New: sharing. This walkthrough is its own <code>{"<Walkthrough walkthrough>"}</code>, outside the
          checklists.
        </>
      ),
    },
    { waymark: "nav-decks", preferredPlacement: "right", content: "Share a deck from the decks page." },
  ],
});

const contextOf = (app: AppData) => ({
  hasDeck: app.decks.length > 0,
  hasPhoto: app.hasPhoto,
  invited: app.invited,
  emailVerified: app.emailVerified,
});

type Context = ReturnType<typeof contextOf>;

export const onboarding = defineChecklists({
  tasks: {
    tour: {
      title: "Take the tour",
      description: "Nine stops, most of what a step can do.",
      walkthrough: tour,
    },
    "create-deck": {
      title: "Create your first deck",
      description: "Done when the app has a deck, however it got one.",
      walkthrough: createDeck,
      isComplete: (c: Context) => c.hasDeck,
    },
    "add-photo": {
      title: "Add a profile photo",
      walkthrough: addPhoto,
      isComplete: (c: Context) => c.hasPhoto,
    },
    "pick-theme": {
      title: "Pick a theme",
      description: "No condition: done when its walkthrough finishes.",
      walkthrough: [
        {
          waymark: "nav-settings",
          advance: "click",
          preferredPlacement: "right",
          content: "Themes are in Settings.",
        },
        { waymark: "theme", advance: { event: "change" }, content: "Pick one. This moves on when it changes." },
        { content: "Change it back any time." },
      ],
    },
    invite: {
      title: "Invite a teammate",
      description: "An application action rather than a walkthrough.",
      action: { label: "Invite", onSelect: () => inviteOpen.set(true) },
      isComplete: (c: Context) => c.invited,
    },
    "verify-email": {
      title: "Verify your email",
      description: "The app ticks this one. Its box can't be ticked by hand.",
      toggleable: false,
      isComplete: (c: Context) => c.emailVerified,
    },
    "read-guide": {
      title: "Read the study guide",
      description: (
        <>
          Ten minutes on{" "}
          <a href="https://en.wikipedia.org/wiki/Spaced_repetition" target="_blank" rel="noreferrer">
            spaced repetition
          </a>
          . No walkthrough, no condition: tick it yourself.
        </>
      ),
    },
  },
  checklists: {
    home: ["tour", "create-deck", "add-photo", "pick-theme", "invite", "verify-email", "read-guide"],
    decks: ["create-deck"],
    settings: ["add-photo", "pick-theme", "verify-email"],
  },
});

/** The Run keeps one record per user: every walkthrough's progress and every task's status. */
const RECORD_KEY = "waymark-react";

/** What storage holds now, shown in the lab. In `server` mode, what the server last answered. */
export const stored = createStore<StoredRecord | null>(null);

/** localStorage, with each load, each save and each change another tab makes shown in the lab. */
function shownLocally(key: string): StorageAdapter {
  const local = localStorageAdapter(key);
  const read = () => local.load() as StoredRecord | null;
  return {
    load: () => {
      const value = read();
      // The root makes its Run, which loads, while it renders: the lab hears it after.
      queueMicrotask(() => stored.set(value));
      return value;
    },
    save: (changes) => {
      void local.save(changes);
      stored.set(read());
    },
    subscribe: (listener) =>
      local.subscribe!((value) => {
        stored.set(value);
        listener(value);
      }),
  };
}

const answer = async (response: Promise<Response>): Promise<StoredRecord | null> => {
  const answered = await response;
  if (!answered.ok) throw new Error(`The record server answered ${answered.status}.`);
  const value = (await answered.json()) as StoredRecord | null;
  stored.set(value);
  return value;
};

/** The dev server's /api/record: slow, and without `subscribe`, so tabs don't hear each other. */
const serverRecord: StorageAdapter = {
  load: () => answer(fetch("/api/record")),
  save: async (changes) => {
    await answer(fetch("/api/record", { method: "PATCH", body: JSON.stringify(changes) }));
  },
};

const localRecord = shownLocally(RECORD_KEY);

/** Bumped to give `<WaymarkRoot>` a new key: a new Run, as for another user. */
const generation = createStore(0);

/** Clears the stored record and starts a new Run on it, without a reload. */
export const forgetRecord = async () => {
  if (setup.get().storage === "server") await answer(fetch("/api/record", { method: "DELETE" }));
  else {
    localStorage.removeItem(RECORD_KEY);
    stored.set(null);
  }
  generation.set(generation.get() + 1);
};

const describeProblem = (problem: WaymarkProblem): string => {
  switch (problem.type) {
    case "storageFailed":
    case "recordUnreadable":
      return `${problem.type}: ${String(problem.error)}`;
    case "recordDropped":
      return `${problem.type} ${"walkthrough" in problem ? problem.walkthrough : problem.task} (${problem.reason})`;
    case "waymarkLost":
    case "waymarkMissing":
      return `${problem.type} in ${problem.walkthrough} on step ${problem.stepIndex + 1}`;
    default:
      return `${problem.type} in ${problem.callback}: ${String(problem.error)}`;
  }
};

const describeTaskEvent = (event: ChecklistsEvent): string => {
  switch (event.type) {
    case "taskStopped":
      return `${event.type} ${event.task.id} (${event.reason})`;
    case "taskSkipped":
    case "taskUnskipped":
      return `${event.type} ${event.task.id}${event.checklist ? ` from ${event.checklist}` : ""}`;
    case "checklistComplete":
      return `${event.type} ${event.checklist}`;
    default:
      return `${event.type} ${event.task.id}`;
  }
};

export const describe = (snapshot: Snapshot): string => {
  if (snapshot.phase !== "running") return snapshot.phase;
  const parts = [`step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`, snapshot.waymark.status];
  if (!snapshot.canAdvance) parts.push("gate shut");
  if (snapshot.collapsed) parts.push("collapsed");
  return parts.join(" · ");
};

/** The open walkthrough, or else the beacons to go back to. */
const describeRun = ({ open, beacons }: RunSnapshot): string | null => {
  if (open) return `${open.task ?? open.walkthrough.id}: ${describe(open.snapshot)}`;
  if (beacons.length === 0) return null;
  return `beacons: ${beacons.map((beacon) => `${beacon.walkthrough.id} at step ${beacon.stepIndex + 1}`).join(", ")}`;
};

const onEvent = (event: WaymarkEvent<WalkthroughStep>) => {
  if (!("walkthrough" in event)) {
    record("checklist", describeTaskEvent(event));
    return;
  }
  const by = event.type === "interrupt" ? ` by ${event.interruptedBy}` : "";
  record("run", `${event.walkthrough}: ${event.type}${by} on step ${event.stepIndex + 1} → ${describe(event.snapshot)}`);
  // Asked for again only once it has ended, as the app would.
  if (event.walkthrough === whatsNew.id && event.snapshot.phase !== "running") whatsNewOpen.set(false);
};

const problemHandlers = everyProblem((problem) => record("problem", describeProblem(problem)));

/** The Run of the mounted root, for what lives outside it: the lab and `window.playground`. */
export const currentRun = createStore<Run | null>(null);

const noRun = () => () => {};

/** The current Run's snapshot, or null before a root has mounted. */
export function useRunSnapshot(): RunSnapshot | null {
  const run = useStore(currentRun);
  const subscribe = useCallback((listener: () => void) => run?.subscribe(listener) ?? noRun(), [run]);
  const get = () => run?.getSnapshot() ?? null;
  return useSyncExternalStore(subscribe, get, get);
}

/** Inside the root, hands its Run out and logs where it is. Following it with `subscribe` changes nothing. */
function ShareRun() {
  const run = useRun();
  useEffect(() => {
    currentRun.set(run);
    let last: string | null = null;
    const stop = run.subscribe((snapshot) => {
      const line = describeRun(snapshot);
      if (line === last) return;
      last = line;
      runStatus.set(line);
      if (line !== null) record("waymark", line);
    });
    return () => {
      stop();
      runStatus.set(null);
      if (currentRun.get() === run) currentRun.set(null);
    };
  }, [run]);
  return null;
}

/** Rendered as elements, not called, so each is a component of its own and may use hooks. */
const customPopover = {
  renderPopover: (props: WalkthroughRenderProps) => <CustomPopover {...props} />,
  renderBeacon: (props: BeaconRenderProps) => <CustomBeacon {...props} />,
};

/**
 * The one `<WaymarkRoot>`: it makes the Run, draws it, and reads the app's
 * data as its checklists' context. A new key, for new storage or a forgotten
 * record, makes a new Run, as another user would get.
 */
export function Guidance({ children }: { children: ReactNode }) {
  const { popover, padding, storage } = useStore(setup);
  const key = `${storage}:${useStore(generation)}`;
  const app = useStore(data);
  const context = useMemo(() => contextOf(app), [app]);
  return (
    <WaymarkRoot
      key={key}
      storage={storage === "server" ? serverRecord : localRecord}
      context={context}
      waymarkPadding={padding}
      problemHandlers={problemHandlers}
      onEvent={onEvent}
      {...(popover === "custom" ? customPopover : {})}
    >
      <ShareRun />
      {children}
    </WaymarkRoot>
  );
}

/** The app asking: shown once nothing else is open, and never again once finished or exited. */
export function WhatsNew() {
  return <Walkthrough walkthrough={whatsNew} active={useStore(whatsNewOpen)} />;
}
