import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  defineChecklists,
  defineWalkthrough,
  useChecklist,
  Walkthrough,
  WaymarkRoot,
  type Run,
  type WalkthroughStep,
  type WaymarkEvent,
} from "react-waymark";
import { track } from "./analytics";
import { data, useStore, type AppData, type Tab } from "./data";

const isEmail = (waymark: Element | null) =>
  waymark instanceof HTMLInputElement && /^\S+@\S+\.\S{2,}$/.test(waymark.value);

const hasName = (waymark: Element | null) => waymark instanceof HTMLInputElement && waymark.value.trim().length >= 3;

/** Act 1. Every step moves on by itself: a click, a valid email, then the send. */
export const inviteTour = defineWalkthrough({
  id: "inviteTour",
  steps: [
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
});

/**
 * Act 2. Started by the app the first time someone opens their own projects.
 * A Task in a checklist no one sees, so its popover has a Skip button and the
 * skip is reported.
 */
const viewsTour = defineWalkthrough({
  id: "views",
  steps: [
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
});

export const views = defineChecklists({
  tasks: {
    views: { title: "Views", walkthrough: viewsTour },
  },
});

/**
 * The first time someone opens their own projects. The app asks, so the tour
 * waits for any open one, and never comes back once finished or skipped.
 */
export function onTab(run: Run, next: Tab) {
  if (next === "Mine") run.requestStart(viewsTour);
}

let step = 0;
const of = (index: number) => `Step ${index + 1} of 3 · Views tour`;

/** Every walkthrough's events and every checklist's come here; analytics wants only the views tour's. */
const onEvent = (event: WaymarkEvent<WalkthroughStep>) => {
  if (!("walkthrough" in event)) {
    if (event.type === "taskSkipped" && event.task.id === "views") track("Tour skipped", of(step));
    return;
  }
  if (event.walkthrough !== viewsTour.id) return;
  step = event.stepIndex;
  if (event.type === "start") track("Tour started", of(event.stepIndex));
  if (event.type === "collapse") track("Tour paused", of(event.stepIndex));
  if (event.type === "resume") track("Tour resumed", of(event.stepIndex));
};

const contextOf = (app: AppData) => {
  const project = app.projects.find((p) => p.id.startsWith("new-"));
  return { invited: app.pending.length > 0, hasProject: project !== undefined, hasOwner: project?.owner != null };
};

type Context = ReturnType<typeof contextOf>;

/** Act 3. */
export const onboarding = defineChecklists({
  tasks: {
    invite: {
      title: "Invite a teammate",
      description: "Plotline works best with everyone in.",
      isComplete: (c: Context) => c.invited,
    },
    project: {
      title: "Create a new project",
      description: "Give your next piece of work a home.",
      walkthrough: [
        { waymark: "new-project", advance: "click", preferredPlacement: "below", content: "Every project starts here." },
        { waymark: "project-name", advance: { state: hasName, delayMs: 600 }, preferredPlacement: "below", content: "Give it a name." },
        { waymark: "create-project", advance: "click", preferredPlacement: "left", content: "And create it." },
      ],
      isComplete: (c: Context) => c.hasProject,
    },
    owner: {
      title: "Assign it an owner",
      description: "Someone to keep it moving.",
      walkthrough: [
        { waymark: "assign-owner", advance: "click", preferredPlacement: "below", content: "Pick who owns this project." },
        { waymark: "owner-menu", advance: "click", preferredPlacement: "right", content: "Anyone on your team can own it." },
      ],
      isComplete: (c: Context) => c.hasOwner,
    },
  },
});

/** One Run for the one user: it keeps every tour's progress and every task's status under one key. */
export function Guided({ children }: { children: ReactNode }) {
  const app = useStore(data);
  const context = useMemo(() => contextOf(app), [app]);
  return (
    <WaymarkRoot storage="plotline" context={context} onEvent={onEvent} labels={{ skipTask: "Skip" }}>
      {children}
    </WaymarkRoot>
  );
}

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
  // Shown nowhere, but subscribing brings its tour to the Run: a tour restored
  // on a reload opens again, and its popover knows the Task, so it offers Skip.
  useChecklist(views.checklists.main);
  return <Walkthrough walkthrough={inviteTour} active={settled} />;
}
