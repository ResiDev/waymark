# react-waymark

Walkthroughs and checklists for React.

Steps can advance automatically, or unlock Next, when the user clicks an element, triggers a DOM event, or meets a condition in your app. Clicking away collapses a walkthrough into a pulsing beacon on that element, so the user can come back to the same step later. Progress persists across reloads in `localStorage` or your own backend. Checklists track tasks that can launch a walkthrough and tick themselves off from your app's state.

## Why Waymark

- **Steps wait for the user.** A step can move on by itself when the user clicks the button it points at, or types a valid email, so they learn by doing rather than pressing Next.
- **Easy to put aside, easy to come back to.** Clicking away leaves a pulsing beacon on the page, and clicking it picks up on the same step. Progress is saved per user, so a reload doesn't lose their place.
- **Checklists that tick themselves.** Each task can have its own short walkthrough. It ticks when that walkthrough finishes, or when your app's state says the user did the task without it.
- **Never stuck on a missing element.** Steps wait for elements that render late, and if one never appears, the user can still move on.
- **Events for analytics.** Every start, step, put-aside, resume, exit and finish, plus every task ticked or skipped, via `onEvent`.
- **Self-contained, with no stylesheet to import.** On top of React, minified and gzipped: about 19 kB for walkthroughs with the default popover, 17 kB if you draw your own, and 23 kB for everything. Colours come from four CSS variables.

## Install

```sh
npm install react-waymark
```

Works with React 18 and 19, including server rendering and the Next.js App Router ([see below](#nextjs)).

## Quick start

Three pieces make a walkthrough:

1. `<WaymarkRoot>` once, around your app. It keeps the user's progress and draws the open walkthrough.
2. A `data-waymark` attribute on each element a step points at. Waymark calls these elements **waymarks**.
3. A walkthrough, made with `defineWalkthrough` and shown with `<Walkthrough>`.

```tsx
import { Walkthrough, WaymarkRoot, defaultBeacon, defaultPopover, defineWalkthrough } from "react-waymark";

const welcome = defineWalkthrough({
  id: "welcome",
  steps: [
    { waymark: "search", title: "Search", content: "Find any project from here." },
    { waymark: "new-project", advance: "click", content: "Click here to start your first project." },
  ],
});

export function App() {
  return (
    <WaymarkRoot renderPopover={defaultPopover} renderBeacon={defaultBeacon}>
      <input data-waymark="search" placeholder="Search projects" />
      <button data-waymark="new-project">New project</button>
      <Walkthrough walkthrough={welcome} />
    </WaymarkRoot>
  );
}
```

When `<Walkthrough>` mounts, the walkthrough opens. The page is shaded except for the search field, with a popover beside it. The first step has a Next button. The second waits for the user to click New project, then finishes the walkthrough. If nothing appears, see [Why isn't a walkthrough showing?](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/troubleshooting.md).

`renderPopover` and `renderBeacon` render the popover and the **beacon** (the small marker left on the page when a user puts a walkthrough aside). Pass `defaultPopover` and `defaultBeacon` to use the built-in UI. They are passed explicitly so apps with custom UI don't ship them.

Define each walkthrough once, outside any component (defining one inside render throws in development). Its `id` names it in the user's saved progress, so keep it the same across releases. To hold a walkthrough back until something is ready, such as your data, pass `<Walkthrough walkthrough={welcome} active={loaded} />`.

### What the user can do

- **Move through it.** Next and Previous, or the right and left arrow keys when the user isn't typing in a field. Next is disabled while a step is waiting for its `advance` condition, and reads Finish on the last step.
- **Put it aside.** Clicking anywhere outside the popover and its waymark, or pressing Escape, collapses the walkthrough to its beacon on the waymark. Clicking the beacon reopens it on the same step.
- **Exit it.** The × button exits the walkthrough, and it doesn't come back by itself.

A click within 20px of the waymark counts as a click on it; change the distance with `waymarkPadding` on `<WaymarkRoot>`. The shade doesn't block clicks, and Escape and the arrow keys work page-wide while a walkthrough is open. See [Accessibility and the keyboard](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/accessibility.md) for how to stop them interfering with your own menus or modals.

## Save progress for each user

Without `storage`, progress lasts only as long as `<WaymarkRoot>` stays mounted. Give it a localStorage key, and a `key` for the user:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon, defaultPopover } from "react-waymark";

export function Guidance({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <WaymarkRoot key={userId} storage={`waymark:${userId}`} renderPopover={defaultPopover} renderBeacon={defaultBeacon}>
      {children}
    </WaymarkRoot>
  );
}
```

A reload puts the user back where they were, and `<Walkthrough>` never shows a walkthrough again once they've finished or exited it. `<WaymarkRoot>` reads `storage` once when it mounts, so `key={userId}` ensures switching users mounts a fresh root with its own progress. To keep progress on your server, see [Saving progress](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/storage.md).

## Wait for the user

`advance` says what has to happen before a step moves on:

- `"click"`: a click on the waymark.
- `{ event: "input" }`: any DOM event the waymark fires.
- `{ state: (waymark) => boolean }`: a check Waymark runs every frame while the step is open, such as whether a field holds a valid email.

A step without `advance` has a Next button that works straight away, and a step without `waymark` shows in the middle of the screen. Waymark keeps looking for a waymark that isn't on the page yet, and never leaves the user stuck if it doesn't appear. More in [Walkthroughs](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/walkthroughs.md).

## Start one from a button

`<Walkthrough>` suits a walkthrough a page shows by itself. To start one when the user asks, such as from a help menu, call `useRun()` to get the **Run** (the object managing the current user's walkthroughs):

```tsx
import { useRun } from "react-waymark";
import { invite } from "./walkthroughs";

export function HelpMenu() {
  const run = useRun();
  return <button onClick={() => run.start(invite)}>How do I invite someone?</button>;
}
```

`run.start` opens the walkthrough immediately, picking up where the user left off if it's in progress, or starting from step 1 if they finished or exited it. `<Walkthrough>` waits until no other walkthrough is open: it starts a walkthrough the user hasn't seen yet, restores one they were mid-way through after a reload, leaves a put-aside walkthrough as its beacon, and never reopens one they finished or exited. For help-menu walkthroughs, set `dismiss: "exit"` so clicking away exits the walkthrough instead of leaving a beacon. More in [Walkthroughs](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/walkthroughs.md#start-a-walkthrough-from-your-code).

## Checklists

```tsx
import { Checklist, defineChecklists } from "react-waymark";
import { invite } from "./walkthroughs";

export const onboarding = defineChecklists({
  tasks: {
    project: {
      title: "Create a project",
      walkthrough: [
        { waymark: "new-project", advance: "click", content: "Every project starts here." },
        { waymark: "create-project", advance: "click", content: "Name it and create it." },
      ],
    },
    invite: { title: "Invite a teammate", walkthrough: invite },
  },
});

export function GetStarted() {
  return <Checklist checklist={onboarding.checklists.main} title="Get started" />;
}
```

Without a `checklists` map, `defineChecklists` puts every task into `checklists.main`. Render `<Checklist>` anywhere inside `<WaymarkRoot>`: it draws a progress bar and a checkbox for each task, with a "Show me" button that starts the task's walkthrough and a Skip button. Finishing the walkthrough ticks the task, and a task can also tick itself when your app's state says it's done. For custom markup or a header popover, use `useChecklist` or the composable `Checklist*` primitives. More in [Checklists](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/checklists.md).

## Change the look

The default popover, beacon and checklist read four CSS variables:

```css
:root {
  --waymark-accent: #7c3aed;
  --waymark-on-accent: #fff;
  --waymark-surface: #fff;
  --waymark-text: #1c1917;
}
```

Left unset, the accent is blue, and the rest follow the page's `color-scheme`, so a dark page gets a dark popover. To translate the text or draw your own popover, see [Change the look](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/styling.md).

## Next.js

Waymark's components use hooks, so in the App Router render `<WaymarkRoot>`, `<Walkthrough>` and `<Checklist>` from files that start with `"use client"`. On the server no walkthrough is drawn, and a checklist renders every task as `"todo"` until the browser reads the user's progress, unless you pass a server-fetched record via `initial`. In Route Handlers or other server-only files, import `applyChanges` and `RecordUnreadableError` from `"react-waymark/server"`. More in [Next.js and server rendering](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/server-rendering.md).

## Docs

This README gets you started. The full docs are in [`docs/`](https://github.com/ResiDev/waymark/tree/main/packages/react/docs), and ship with the package under `node_modules/react-waymark/docs/`:

- [Walkthroughs](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/walkthroughs.md): writing steps, waiting for the user, elements that render late or not at all, and starting walkthroughs from your code.
- [Checklists](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/checklists.md): tasks, ticking them from your app's state, and drawing your own checklist.
- [Saving progress](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/storage.md): per-user storage, and adapters for your server or IndexedDB.
- [Change the look](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/styling.md): colours, translations, and your own popover and beacon.
- [Accessibility and the keyboard](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/accessibility.md): what screen readers get, and the keys and clicks a walkthrough takes.
- [Next.js and server rendering](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/server-rendering.md)
- [Events and problems](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/events-and-problems.md): analytics, and handling what goes wrong.
- [Why isn't a walkthrough showing?](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/troubleshooting.md)
- [API reference](https://github.com/ResiDev/waymark/blob/main/packages/react/docs/api.md): every export, prop and type.

## Good to know

- **Modern setups.** ES modules only, built for ES2022 browsers. Its types need TypeScript 5.4 or later.
- **One per page.** Use one `<WaymarkRoot>`. The elements walkthroughs point at must be in the page's own document, not inside a shadow root or an iframe.
- **Before 1.0.** The API may still change between minor versions.

## Without React

`react-waymark` is built on [`waymark-core`](https://www.npmjs.com/package/waymark-core), which holds everything but the drawing and has no dependencies. To use Waymark with another framework, start there.

## Licence

MIT
