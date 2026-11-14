# Write a renderer

What core does for you, and what the code that draws a Run has to do. Start with the README's [first walkthrough](../README.md#a-first-walkthrough-in-plain-dom).

## What your renderer does

Core already handles, while attached:

- **The keyboard.** Escape dismisses the walkthrough, putting it aside or exiting it as its `dismiss` says, even while the user is typing in a field; the arrow keys move between steps when the user isn't typing, and Tab moves focus between your `dialog` and the waymark only. These are handled page-wide, on `window`, while a walkthrough is open; a key whose event was already `preventDefault()`ed is left alone, so a widget that uses the arrow keys keeps them by calling it. Keys pressed inside other UI marked `data-waymark-ui`, outside your `dialog`, are left to that UI.
- **Clicks.** A click on the waymark counts for `advance: "click"`, unless the waymark is inside an element marked `data-waymark-ui`, whose clicks belong to that UI; use `advance: { event: "click" }` for one there. A click anywhere else, outside your `dialog`, `waymarkPadding` and any element marked `data-waymark-ui`, dismisses the walkthrough.
- **The waymark.** It's measured every frame, scrolled into view as the step's `scroll` says, and given `aria-haspopup` and `aria-expanded` while its step is open.

Your renderer:

- **Draws the open step** from `snapshot.open`, beside `waymark.rect` once `waymark.status` is `"found"`, and in the middle of the screen while it's `"waiting"`, `"lost"`, `"missing"` or `"absent"` (a step with no waymark). While it's `"searching"`, the first half second, `react-waymark` shows only its shade.
- **Wires the buttons** to `run.act`: `"advance"` (disabled unless `canAdvance`), `"previous"`, `"collapse"` and `"exit"`. Naming the walkthrough, as in `run.act("advance", open.walkthrough)`, makes sure a click on a popover left over from one that just closed can't act on another. Tells the user the waymark can't be found while its status is `"lost"` or `"missing"`; `canAdvance` is then always true, so they're never stuck.
- **Draws beacons** from `snapshot.beacons`, which is empty while a walkthrough is open. Each beacon's button calls `run.act("resume", beacon.walkthrough)`.
- **Offers Skip task** while `snapshot.open.task` names a checklist task that's still todo, by calling `run.skipTask(task)`. `skipTask` does nothing to a done or skipped task, and `open.task` doesn't say which it is, so read the status from that checklist's snapshot.
- **Names things.** Give the popover `role="dialog"` and a name for its step, such as "Step 2 of 3", updated as the step changes, and give each beacon a name, such as "Resume walkthrough". Core only marks up the waymark, and announces nothing; a live region for step changes is yours to add.
- **Handles focus.** Core doesn't move focus. Where it goes when a step opens, and back to when the walkthrough closes, is up to you; `react-waymark` leaves it where it is, so a user typing in a field keeps their place, and Tab reaches the popover. Keep the popover's buttons between steps, or move focus to the new ones, so a keyboard user on Next isn't dropped to the page.
- **Places things.** Core gives you the waymark's box; which side the popover goes on, and keeping it on screen, are up to you.
- **Shades the page, if you want.** `react-waymark` dims everything but a box of `waymarkPadding` around the waymark. Core needs nothing from it.

## Your own step and task fields

In a plain-DOM app, `meta` can hold what a step shows, as above. A renderer for a framework usually gives steps fields of their own instead, as `react-waymark` adds `content` and `title`. Pass your step shape as `defineWalkthrough`'s second type parameter, and any field outside it is a type error, so a typo is caught where the step is written:

```ts
import { createRun, defineWalkthrough, type Step, type Walkthrough, type WalkthroughDefinition } from "waymark-core";

type TextStep = Step & Readonly<{ text: string }>;

export const defineTextWalkthrough = <const TStep extends TextStep>(definition: WalkthroughDefinition<TStep, TextStep>) =>
  defineWalkthrough<TStep, TextStep>(definition);

const welcome = defineTextWalkthrough({
  id: "welcome",
  steps: [{ waymark: "new-project", advance: "click", text: "Click here to start your first project." }],
});

// A Run of these walkthroughs hands back steps with `text` typed.
export const run = createRun<Walkthrough<TextStep>>();
run.start(welcome);
```

`defineChecklists` works the same way, taking the task shape and the step shape as its third and fourth type parameters, so a wrapper passes all four: `defineChecklists<TTasks, TSelections, MyTask, MyStep>(config)`. [`definition.ts`](https://github.com/ResiDev/waymark/blob/main/packages/react/src/definition.ts) in `react-waymark` wraps both functions like this.

`meta` then stays free for the app: anything it holds comes back in events, problems and the snapshot.
