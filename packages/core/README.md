# waymark-core

The framework-agnostic engine behind Waymark: walkthroughs and onboarding checklists for web apps.

**Using React? Install [`react-waymark`](https://www.npmjs.com/package/react-waymark) instead.** It includes this package, and draws the popover, beacon and checklist for you.

This package is for building Waymark into another framework, or into an app without one.

## Why Waymark

- **Steps wait for the user.** A step can move on when the user clicks what it points at, when an element fires a DOM event, or when a check of your app's state holds.
- **Easy to put aside, easy to come back to.** Clicking away or pressing Escape leaves a beacon to resume from, and progress is saved per user, in localStorage or on your server.
- **Checklists that tick themselves.** Each task can have its own walkthrough, and an `isComplete` condition that ticks it when the user does the task on their own.
- **You only draw.** Core finds elements as they render, measures them every frame, and handles the keyboard, clicks and saving. Your renderer draws from one snapshot.
- **Events for analytics.** Every start, step, collapse, resume, exit and finish, plus every task ticked or skipped, via `onEvent`.
- **No dependencies.** About 16 kB minified and gzipped, with everything included.

## Install

```sh
npm install waymark-core
```

## How it fits together

- A **walkthrough** is a list of steps, made with `defineWalkthrough`. A step can point at an element on the page, which Waymark calls its **waymark**: one marked `data-waymark="<name>"`, or one matched by a CSS `selector`. A step without one is drawn in the middle of the screen.
- A **Run**, made with `createRun`, holds one user's progress through every walkthrough and checklist, and works out what should be on screen. It saves that progress as one **record**, in plain JSON ([its shape](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/storage.md#the-record)).
- **Your renderer**, the code you write for your framework or page, subscribes to the Run. It draws the open walkthrough's popover beside its waymark, and a **beacon** for each walkthrough the user put aside, which they click to go back to it.

## A first walkthrough, in plain DOM

The page:

```html
<button data-waymark="new-project">New project</button>

<div id="walkthrough" role="dialog" hidden style="position: fixed; z-index: 51; max-width: 320px">
  <p id="walkthrough-text"></p>
  <button id="walkthrough-next">Next</button>
  <button id="walkthrough-exit" aria-label="Close">×</button>
</div>
```

The script, as an ES module your bundler builds, such as Vite with `<script type="module" src="/main.ts">`:

```ts
import { createRun, defineWalkthrough, type RunSnapshot } from "waymark-core";

// Core steps say where and when. What a step shows is up to you: here, text in each step's meta.
const welcome = defineWalkthrough({
  id: "welcome",
  steps: [
    { meta: "Welcome! This takes ten seconds." },
    { waymark: "new-project", advance: "click", meta: "Click here to start your first project." },
  ],
});

// One Run per user. In an app, give each user their own key, such as `waymark:${userId}`.
const run = createRun({ storage: "waymark" });

const popover = document.querySelector<HTMLElement>("#walkthrough")!;
const text = document.querySelector<HTMLElement>("#walkthrough-text")!;
const next = document.querySelector<HTMLButtonElement>("#walkthrough-next")!;
next.addEventListener("click", () => run.act("advance"));
document.querySelector("#walkthrough-exit")!.addEventListener("click", () => run.act("exit"));

const beacons = document.createElement("div");
document.body.append(beacons);

function draw({ open, beacons: collapsed }: RunSnapshot) {
  // Hidden for the first half second of looking for a waymark, so a late one doesn't make it jump.
  popover.hidden = open === null || open.snapshot.waymark.status === "searching";
  if (open !== null) {
    const { step, stepIndex, stepCount, canAdvance, waymark } = open.snapshot;
    popover.setAttribute("aria-label", `Step ${stepIndex + 1} of ${stepCount}`);
    const notFound = waymark.status === "lost" || waymark.status === "missing";
    text.textContent = notFound ? `${String(step.meta)} (Can't find this part of the page.)` : String(step.meta);
    next.textContent = stepIndex === stepCount - 1 ? "Finish" : "Next";
    next.disabled = !canAdvance;
    // Minimal placement: below the waymark once it's found, in the middle of the screen otherwise.
    const found = waymark.status === "found";
    popover.style.left = found ? `${waymark.rect.left}px` : "50%";
    popover.style.top = found ? `${waymark.rect.bottom + 12}px` : "50%";
    popover.style.translate = found ? "none" : "-50% -50%";
  }
  beacons.replaceChildren(
    ...collapsed.map((beacon) => {
      const button = document.createElement("button");
      button.textContent = "Resume";
      button.setAttribute("aria-label", "Resume walkthrough");
      button.style.position = "fixed";
      const rect = beacon.waymark.status === "found" ? beacon.waymark.rect : null;
      button.style.left = rect ? `${rect.right}px` : "50%";
      button.style.top = rect ? `${rect.top}px` : "calc(100% - 48px)";
      button.addEventListener("click", () => run.act("resume", beacon.walkthrough));
      return button;
    }),
  );
}

// Attach DOM listeners (Escape, arrow keys, clicks, frame tracking) and tell the Run where the dialog is.
// Clicks within `waymarkPadding` px of the waymark count as clicks on it.
const detach = run.attach(() => ({ dialog: popover }), { waymarkPadding: 8 });
// Load saved progress from storage and listen for external changes (separate so SSR never touches browser storage).
const disconnect = run.connect();
// Call `draw` immediately, then whenever the snapshot changes.
const unsubscribe = run.subscribe(draw);
run.requestStart(welcome);

// And stop, as it unmounts. The popover's HTML is the page's, so it goes with the page.
export function teardown() {
  unsubscribe();
  disconnect();
  detach();
  popover.hidden = true;
  beacons.remove();
}
```

The first step has no waymark, so it shows in the middle of the screen. The second sits under the New project button and waits for a click on it, then finishes. Escape or a click elsewhere puts the walkthrough aside as its beacon, and progress is saved in localStorage under `waymark`, so a reload carries on where the user was.

This renderer is deliberately minimal: `step.meta` is untyped here, and beacons are rebuilt on every update. A real renderer types its own step fields, keeps the popover on screen on a side with room, and reuses each beacon's element between updates so a keyboard user's focus isn't lost. See [Write a renderer](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/renderer.md).

## Start a walkthrough from your code

- `run.requestStart(walkthrough)` is for your app choosing to show one, as above. It waits until no other walkthrough is open: it starts a walkthrough the user hasn't seen yet, restores one they were mid-way through after a reload, leaves a collapsed walkthrough as its beacon, and never reopens one they finished or exited. It returns a function that withdraws the request.
- `run.start(walkthrough)` is for the user asking, such as from a help button. It opens the walkthrough immediately—picking up where they left off if it's in progress, or starting from step 1 if they finished or exited it.

Only one walkthrough is open at once. `start` interrupts the open one, which does what its `dismiss` says: by default it's put aside as a beacon. Give a walkthrough opened from a help button `dismiss: "exit"`, so clicking away exits it rather than leaving a beacon.

## Checklists

A checklist lists tasks for a new user. A task can carry a walkthrough, and an `isComplete` condition that ticks it when the user does the task on their own:

```ts
import { defineChecklists } from "waymark-core";

export const onboarding = defineChecklists({
  tasks: {
    tour: { walkthrough: [{ waymark: "new-project", meta: "Every project starts here." }], meta: "Take the tour" },
    project: { isComplete: (c: { hasProject: boolean }) => c.hasProject, meta: "Create a project" },
  },
});
```

Without a `checklists` map, `defineChecklists` puts every task into `checklists.main`. `run.checklist(onboarding.checklists.main)` returns that checklist's state and commands, and `run.setContext(...)` updates the application context that `isComplete` conditions read. [Checklists](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/checklists.md) adds one to the script above, with a renderer for it.

## What your renderer does

Core handles Escape and the arrow keys, clicks on and away from the waymark, and measuring the waymark every frame while the Run is attached. Your renderer draws the rest from the snapshot:

- **The open step**, placed beside `waymark.rect` when `waymark.status` is `"found"`, and centred on screen otherwise—with a fallback message when the status is `"lost"` or `"missing"`.
- **Its buttons**, wired to `run.act`: `"advance"` (disabled unless `canAdvance`), `"previous"`, `"collapse"` and `"exit"`.
- **Beacons** from `snapshot.beacons`, each calling `run.act("resume", beacon.walkthrough)`.
- **Names and focus.** Core announces nothing and doesn't move focus; the dialog's name, a live region and where focus goes are yours.

More in [Write a renderer](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/renderer.md).

## Docs

This README gets you started. The full docs are in [`docs/`](https://github.com/ResiDev/waymark/tree/main/packages/core/docs), and ship with the package under `node_modules/waymark-core/docs/`:

- [Write a renderer](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/renderer.md): what core handles, what your renderer draws, and typing your own step and task fields.
- [Checklists](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/checklists.md): tasks, `isComplete` conditions, and drawing a checklist.
- [Storage](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/storage.md): localStorage, adapters for your server or IndexedDB, and the record's shape.
- [Server rendering](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/server-rendering.md)
- [Why isn't anything showing?](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/troubleshooting.md)
- [API reference](https://github.com/ResiDev/waymark/blob/main/packages/core/docs/api.md): every export, the Run, snapshots, events and problems.

## Good to know

- **Modern setups.** ES modules only, built for ES2022 browsers. Its types need TypeScript 5.4 or later.
- **Development checks.** Passing two different walkthrough definitions with the same `id` throws, and attaching a second Run warns, unless `process.env.NODE_ENV` is `"production"`. In production, the first walkthrough with an id wins and a second Run stays quiet. Code loaded without a bundler, such as from a CDN, counts as development.
- **One Run per page.** Attach one Run, drawn by one renderer. Waymarks are found with `querySelector` from the Run's `root`, so they must be in the page's own document, not inside a shadow root or an iframe.
- **Before 1.0.** The API may still change between minor versions.

## Licence

MIT
