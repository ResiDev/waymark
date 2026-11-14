# Why isn't a walkthrough showing?

`<Walkthrough>` holds back on purpose in these cases:

- **The user already finished or exited it.** It's in their record, and `<Walkthrough>` never shows it again. While developing, clear the localStorage key you gave `storage`, or call `run.reset(walkthrough)` and remount the page.
- **The user put it aside.** It shows as a beacon instead, once no other walkthrough is open. One put aside for longer than its `maxAge`, a day by default, is forgotten when its progress is next read from storage, such as on a reload, and then `<Walkthrough>` opens it again from step 1.
- **Another walkthrough is open.** It waits its turn.
- **Storage is still loading.** It waits for the record, so it doesn't open over progress it hasn't read yet.
- **`active` is `false`.**

A walkthrough the user put aside comes back as a beacon after a reload only once the page hands it to the Run again: with `<Walkthrough>`, `run.requestStart`, `run.act` naming it, or by showing the checklist whose task it belongs to. Waymark keeps the user's progress for every walkthrough, but only draws the ones it's been given since the root mounted.

`run.start(walkthrough)` opens a walkthrough whatever its progress, interrupting any open one, so it's a quick way to check the walkthrough itself works. It still waits for storage.

If the popover shows in the middle of the screen instead of beside its element, the step's waymark wasn't found. Check the `data-waymark` value matches the step's `waymark` exactly, and that the element is on the page with a size.

Mistakes in a definition throw instead of failing quietly. Most are type errors first, such as a step that waits for a click or an event without a `waymark` or `selector`, and `defineWalkthrough` or `defineChecklists` throws on them in JavaScript. In development, Waymark throws when two different walkthroughs share an `id`, which is often a sign of calling `defineWalkthrough` inside a component. In production it doesn't check, and the first definition it was given is used. In development, Waymark also warns when two roots are attached to one page. Development checks run unless `process.env.NODE_ENV` is `"production"`, which most bundlers set in production builds; code loaded without a bundler counts as development.
