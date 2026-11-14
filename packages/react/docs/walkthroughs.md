# Walkthroughs

Everything about writing steps and controlling walkthroughs. Start with the [quick start](../README.md#quick-start).

## Steps

Every field but `content` is optional:

```tsx
{
  waymark: "invite",           // points at data-waymark="invite"
  title: "Invite your team",   // a heading in the default popover
  content: <p>Projects work better with everyone in.</p>,
  advance: "click",            // what has to happen before it moves on
  preferredPlacement: "right", // "below" by default
}
```

A step without `waymark` shows its popover in the middle of the screen, which suits a welcome or a closing message. For an element you can't add an attribute to, use `selector: ".some-css-selector"` in place of `waymark`. The full list of fields is in the [reference](api.md#step-fields).

### Waiting for the user

`advance` says what has to happen before the walkthrough moves on:

- `"click"`: a click on the waymark.
- `{ event: "input" }`: any DOM event the waymark fires. `{ event: ["change", "blur"] }` takes any of several.
- `{ state: (waymark) => boolean }`: a check Waymark runs every frame. It gets the waymark element, or `null` while no element matches, and can also read anything else in your app.
- `{ state: check, delayMs: 700 }`: the check has to hold for 700ms without a break.
- `{ click: true, then: "unlock" }`: enables Next instead of moving on, so the user decides when to go on. `then` and `delayMs` work with every object form.

A step without `advance` has a Next button that works straight away.

This walkthrough waits for a click, then for a valid email, then for the form to be sent:

```tsx
import { defineWalkthrough } from "react-waymark";

const isEmail = (input: Element | null) =>
  input instanceof HTMLInputElement && /^\S+@\S+\.\S{2,}$/.test(input.value);

export const invite = defineWalkthrough({
  id: "invite",
  steps: [
    { waymark: "invite", advance: "click", content: "Invite someone to get started." },
    { waymark: "invite-email", advance: { state: isEmail, delayMs: 700 }, content: "Type a teammate's email." },
    { waymark: "send-invite", advance: "click", content: "And send it." },
  ],
});
```

A click or a DOM event happens on the waymark, so a step that waits for one needs a `waymark` or `selector`: without one, it's a type error, and `defineWalkthrough` throws in JavaScript. A `state` check needs no waymark.

### When the waymark isn't on the page

Waymark looks for each step's waymark every frame, so it finds elements that render late, such as the form in the example above.

1. For the first half second, only the shade shows, so a waymark that renders a moment late doesn't make the popover jump.
2. After that, the popover waits in the middle of the screen.
3. After `missingAfterMs` (3 seconds by default), the popover says it can't find that part of the page and enables Next, so the user is never stuck.

A waymark that was found and then leaves the page counts as lost after 0.2 seconds: the popover moves to the middle of the screen, says it can't find that part of the page, and enables Next. An element with no size, such as one with `display: none`, has nowhere for the popover to point: one that never had a size is waited for like a missing one, and one that loses its size counts as lost. A `state` check still gets the element. Missing and lost waymarks are reported to your [problem handlers](events-and-problems.md#handle-problems).

### Steps on other pages

Put `<WaymarkRoot>` above your router, in your root layout, so an open walkthrough carries on as the user moves between pages. A step whose waymark is on another page waits for it like any late element, and says it's missing after `missingAfterMs`, so lead the user there: the step before can point at the link with `advance: "click"`. Unmounting `<Walkthrough>`, as leaving its page does, doesn't close a walkthrough that has already opened.

## Start a walkthrough from your code

`<Walkthrough>` suits a walkthrough a page shows by itself. To start one from a button, such as a help menu, use the Run, the object that holds the user's progress, from `useRun()`:

```tsx
import { useRun } from "react-waymark";
import { invite } from "./walkthroughs";

export function HelpMenu() {
  const run = useRun();
  return <button onClick={() => run.start(invite)}>How do I invite someone?</button>;
}
```

There are two ways to start one, and the difference is who asked:

- `run.start(walkthrough)` is for the user asking. It opens the walkthrough now: where they left it if part way through, or from step 1 if they finished or exited it.
- `run.requestStart(walkthrough)` is for your app choosing to show one. It waits until no other walkthrough is open, then opens it only if the user has never started it. One they put aside stays as its beacon, and one they finished or exited stays closed. It returns a function that withdraws the request. `<Walkthrough>` calls this when it mounts, and withdraws the request when it unmounts.

`run.reset(walkthrough)` puts an open walkthrough back to step 1. Any other is forgotten, as if the user had never started it; that doesn't open it. `run.act(action)` does what the user can do on the open walkthrough: `"advance"`, `"previous"`, `"collapse"`, `"reset"` or `"exit"`. `run.act("resume", walkthrough)` brings back one the user put aside.

### When two walkthroughs compete

Only one walkthrough is open at once. When `start` opens one while another is open, the open one is interrupted, and does what its `dismiss` setting says: by default it collapses to its beacon and keeps its step. Beacons only show while no walkthrough is open, so the user can pick which one to go back to.

### Help-menu walkthroughs: `dismiss: "exit"`

A walkthrough opened from a help menu shouldn't linger as a beacon when the user clicks away. Give it `dismiss: "exit"`, and clicking away, pressing Escape or being interrupted by another walkthrough exits it instead:

```tsx
import { defineWalkthrough } from "react-waymark";

export const filtersHelp = defineWalkthrough({
  id: "filtersHelp",
  dismiss: "exit",
  steps: [
    { waymark: "filter-status", content: "Pick which statuses to show." },
    { waymark: "save-view", content: "Save the combination as a view." },
  ],
});
```

Keep onboarding on the default, `"collapse"`. With `"exit"`, one stray click ends a walkthrough for good, and `<Walkthrough>` won't show it again.

To stop clicks inside part of your app from counting as clicking away, such as a help menu that sits over the page, add `data-waymark-ui` to it. Waymark then also leaves Escape, the arrow keys and Tab pressed inside it alone, unless they're inside the walkthrough's own popover. Clicks inside it belong to it too, so a step whose waymark is inside a `data-waymark-ui` element, including `ChecklistTrigger` and `ChecklistPanel`, should wait with `advance: { event: "click" }` rather than `"click"`.
