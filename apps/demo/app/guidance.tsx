import { useEffect, useState } from "react";
import { createChecklists, defineWalkthrough, Walkthrough } from "react-waymark";
import { track } from "./analytics";
import { data, type AppData, type Tab } from "./data";

const isEmail = (waymark: Element | null) =>
  waymark instanceof HTMLInputElement && /^\S+@\S+\.\S{2,}$/.test(waymark.value);

const hasName = (waymark: Element | null) => waymark instanceof HTMLInputElement && waymark.value.trim().length >= 3;

/** Act 1. Every step moves on by itself: a click, a valid email, then the send. */
export const inviteTour = defineWalkthrough(
  [
    {
      waymark: "invite",
      advance: "click",
      preferredPlacement: "below",
      content: (
        <>
          <b>Plotline is better with your team.</b> Invite someone to get started.
        </>
      ),
    },
    {
      waymark: "invite-email",
      advance: { state: isEmail, delayMs: 700 },
      preferredPlacement: "below",
      content: "Type a teammate's email.",
    },
    {
      waymark: "send-invite",
      advance: "click",
      preferredPlacement: "below",
      content: "And send it.",
    },
  ],
  { storage: "plotline-invite-tour" },
);

/**
 * Act 2. Started by the app the first time someone opens their own projects.
 * A Task in a checklist no one sees, so its popover has a Skip button and the
 * owner reports the skip.
 */
let step = 0;
const of = (index: number) => `Step ${index + 1} of 3 · Views tour`;

export const views = createChecklists({
  tasks: {
    views: {
      title: "Views",
      walkthrough: [
        {
          waymark: "tabs",
          preferredPlacement: "below",
          content: (
            <>
              <b>Your projects.</b> This view shows only the ones you own.
            </>
          ),
        },
        {
          waymark: "filter",
          preferredPlacement: "below",
          content: "Narrow any view by team, owner or due date.",
        },
        {
          waymark: "search",
          preferredPlacement: "below",
          content: "And find anything from here with ⌘K.",
        },
      ],
    },
  },
  storage: { tasks: "plotline-views", walkthrough: "plotline-views-walkthrough" },
  onEvent: (event) => {
    if (event.type === "taskSkipped") track("Tour skipped", of(step));
  },
  run: {
    onEvent: (event) => {
      step = event.stepIndex;
      if (event.type === "start") track("Tour started", of(event.stepIndex));
      if (event.type === "collapse") track("Tour paused", of(event.stepIndex));
      if (event.type === "resume") track("Tour resumed", of(event.stepIndex));
    },
  },
});

/** The first time someone opens their own projects, unless the tour is on screen or dealt with. */
export function onTab(next: Tab) {
  if (next !== "Mine" || views.getSnapshot().active !== null) return;
  if (views.checklists.main.getSnapshot().tasks[0]?.status === "todo") views.start("views");
}

const contextOf = (app: AppData) => {
  const project = app.projects.find((p) => p.id.startsWith("new-"));
  return { invited: app.pending.length > 0, hasProject: project !== undefined, hasOwner: project?.owner != null };
};

/** Act 3. */
export const onboarding = createChecklists({
  context: contextOf(data.get()),
  tasks: {
    invite: {
      title: "Invite a teammate",
      description: "Plotline works best with everyone in.",
      isComplete: (c) => c.invited,
    },
    project: {
      title: "Create a new project",
      description: "Give your next piece of work a home.",
      walkthrough: [
        { waymark: "new-project", advance: "click", preferredPlacement: "below", content: "Every project starts here." },
        { waymark: "project-name", advance: { state: hasName, delayMs: 600 }, preferredPlacement: "below", content: "Give it a name." },
        { waymark: "create-project", advance: "click", preferredPlacement: "left", content: "And create it." },
      ],
      isComplete: (c) => c.hasProject,
    },
    owner: {
      title: "Assign it an owner",
      description: "Someone to keep it moving.",
      walkthrough: [
        { waymark: "assign-owner", advance: "click", preferredPlacement: "below", content: "Pick who owns this project." },
        { waymark: "owner-menu", advance: "click", preferredPlacement: "right", content: "Anyone on your team can own it." },
      ],
      isComplete: (c) => c.hasOwner,
    },
  },
  storage: { tasks: "plotline-onboarding", walkthrough: "plotline-onboarding-walkthrough" },
});

data.subscribe(() => onboarding.update(contextOf(data.get())));

/** Holds a tour back a moment, as an app would until its data is in. */
function useAfter(ms: number, ready = true) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = ready ? setTimeout(() => setDone(true), ms) : undefined;
    return () => clearTimeout(timer);
  }, [ms, ready]);
  return done;
}

export function Guidance() {
  const settled = useAfter(900);
  return (
    <>
      <Walkthrough walkthrough={inviteTour} active={settled} />
      <Walkthrough checklists={views} labels={{ skipTask: "Skip" }} />
      <Walkthrough checklists={onboarding} />
    </>
  );
}
