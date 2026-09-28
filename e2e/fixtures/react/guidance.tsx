import { useEffect } from "react";
import {
  createChecklists,
  createLocalStorageRecord,
  defineWalkthrough,
  Walkthrough,
  type ChecklistsEvent,
  type ReactTask,
  type Snapshot,
  type WalkthroughRenderProps,
} from "react-waymark";
import { CustomPopover } from "./popover";
import { createStore, data, inviteOpen, record, setup, useStore, watched, whatsNewOpen, type AppData } from "./state";

// Between them these walkthroughs use every step shape, so the lab exercises each.

const nameLongEnough = (waymark: Element | null) =>
  waymark instanceof HTMLInputElement && waymark.value.trim().length >= 3;

/** Crosses a route: step 2's Waymark mounts only once the decks page has. */
const createDeck = defineWalkthrough([
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
]);

const addPhoto = defineWalkthrough([
  {
    waymark: "avatar",
    advance: "click",
    preferredPlacement: "left",
    content: "Your profile is behind your avatar.",
  },
  { waymark: "upload-photo", advance: "click", content: "Choose a photo. Any will do." },
]);

const tour = defineWalkthrough([
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
  { waymark: "guide", content: "Far down the page: the Run scrolled here." },
  {
    waymark: "feedback",
    preferredPlacement: "below",
    content: "Feedback, bottom right. There is no room below, so it opens above.",
  },
  { content: "That's the tour.", popoverStyle: { background: "#14532d" } },
]);

const whatsNew = defineWalkthrough([
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
]);

const contextOf = (app: AppData) => ({
  hasDeck: app.decks.length > 0,
  hasPhoto: app.hasPhoto,
  invited: app.invited,
  emailVerified: app.emailVerified,
});

const storage = createLocalStorageRecord("waymark-react-checklists");

export const stored = createStore(storage.load());

const describeEvent = (event: ChecklistsEvent<any, any>): string => {
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

export const owner = createChecklists({
  context: contextOf(data.get()),
  tasks: {
    tour: {
      title: "Take the tour",
      description: "Eight stops, most of what a step can do.",
      walkthrough: tour,
    },
    "create-deck": {
      title: "Create your first deck",
      description: "Done when the app has a deck, however it got one.",
      walkthrough: createDeck,
      isComplete: (c) => c.hasDeck,
    },
    "add-photo": {
      title: "Add a profile photo",
      walkthrough: addPhoto,
      isComplete: (c) => c.hasPhoto,
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
      isComplete: (c) => c.invited,
    },
    "verify-email": {
      title: "Verify your email",
      description: "The app ticks this one. Its box can't be ticked by hand.",
      toggleable: false,
      isComplete: (c) => c.emailVerified,
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
  storage,
  onChange: (next) => stored.set(next),
  onEvent: (event) => record("owner", describeEvent(event)),
  run: {
    waymarkPadding: setup.get().padding,
    onEvent: (event) => record("run", `${event.type} on step ${event.stepIndex + 1}`),
  },
});

data.subscribe(() => owner.update(contextOf(data.get())));

export type AnyTask = ReactTask<any> & { readonly id: string };

export const describeRun = (snapshot: Snapshot): string => {
  if (snapshot.phase !== "running") return snapshot.phase;
  const parts = [`step ${snapshot.stepIndex + 1} of ${snapshot.stepCount}`, snapshot.waymark.status];
  if (!snapshot.canAdvance) parts.push("gate shut");
  if (snapshot.collapsed) parts.push("collapsed");
  return parts.join(" · ");
};

// Mounted only beside the renderer: subscribing makes a Run watch the page, so
// a logger that outlived the renderer would keep an unrendered Run working.
function WatchLog() {
  useEffect(() => {
    let last: string | null = null;
    const stop = owner.subscribeActive(({ active, step }) => {
      const line = active && step ? `${active.task.id}: ${describeRun(step)}` : null;
      if (line === last) return;
      last = line;
      watched.set(line);
      if (line !== null) record("waymark", line);
    });
    return () => {
      stop();
      watched.set(null);
    };
  }, []);
  return null;
}

/** Rendered as an element, not called, so the popover is a component of its own and may use hooks. */
const customPopover = {
  renderPopover: (props: WalkthroughRenderProps) => <CustomPopover {...props} />,
};

export function Guidance() {
  const { popover } = useStore(setup);
  return (
    <>
      <Walkthrough checklists={owner} {...(popover === "custom" ? customPopover : {})} />
      <WatchLog />
    </>
  );
}

export function WhatsNew() {
  const active = useStore(whatsNewOpen);
  const { popover, padding } = useStore(setup);
  return (
    <Walkthrough
      walkthrough={whatsNew}
      active={active}
      waymarkPadding={padding}
      onEvent={(event) => {
        record("whats-new", `${event.type} on step ${event.stepIndex + 1} → ${describeRun(event.snapshot)}`);
        if (event.snapshot.phase !== "running") whatsNewOpen.set(false);
      }}
      {...(popover === "custom" ? customPopover : {})}
    />
  );
}
