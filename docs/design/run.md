# One Run

Status: proposed. This replaces `attach.md`, which split `subscribe` from
`attach` on each walkthrough's own Run, and the "One open run per page" section
of [walkthrough-button.md](walkthrough-button.md). It answers problems 1 to 4
of [review.md](review.md).

## Problem

### Following a tour switches it on

Say an app sends each step of its onboarding tour to analytics:

```ts
const run = createRun(onboarding);
run.subscribe((snapshot) => analytics.track(snapshot));
```

Nothing draws this Run, but it acts as if its tour were on screen. It takes ←,
→ and Escape pressed anywhere on the page. The first click anywhere collapses
the hidden tour, and the collapse is saved, so the next time the tour is drawn
it opens as a beacon. It sets `aria-expanded="true"` and
`aria-haspopup="dialog"` on its waymark, so a screen reader announces a dialog
that isn't there. It measures the page every frame.

A Run can't see the screen, so it counts subscribers. The first one switches
on its page listeners: keys, clicks, the frame loop and the waymark's aria. The
last one leaving switches them off. The code calls this `mounted`, and it means
"has a subscriber", not React mounting. For React that is right, because
`useSyncExternalStore` subscribes on mount. Anything else that subscribes looks
the same to the Run.

### Two tours fight

Each `<Walkthrough>` makes its own Run, and nothing above the Runs knows about
all of them. Two open at once both draw a shade and a popover at z-index 50,
both take Escape and →, and a click in one's popover is a click away for the
other. A page of ⓘ buttons, as in
[walkthrough-button.md](walkthrough-button.md), makes this likely.

### Two kinds of walkthrough

The checklist controller keeps one tour on screen, but only among its own
tasks, and paying for that splits everything in two:

- A task's walkthrough may not have storage or problem handlers, because the
  controller stores its place and hears its problems. A standalone one may. So
  `defineWalkthrough` has three forms in each package, the types carry fields of
  type `never`, and `createChecklists` throws for apps without TypeScript.
- The controller can't subscribe to its tasks' Runs without switching them on,
  so it saves on a hand-kept list of events, `MOVES`. A standalone Run compares
  snapshots instead. A new kind of move saved by one copy and forgotten by the
  other loses the user's place on reload.
- A renderer hands a task's Run its elements through `bindUi`, and a standalone
  Run through `RunOptions.ui`. React alone stops a task when its renderer goes.

## Design

There is one Run per user. It holds how far the user is through every
walkthrough and shows one at a time. `<WaymarkRoot>` makes it, provides it to
the components below, and draws it. Anything else follows it with `subscribe`,
which changes nothing.

```ts
// filters/help.ts, beside the code it explains
export const filtersHelp = defineWalkthrough({
  id: "filtersHelp",
  dismiss: "exit",
  steps: [
    { waymark: "filter-status", content: "Pick which statuses to show." },
    { waymark: "save-view", content: "Save the combination as a view." },
  ],
});

// onboarding.ts
export const onboarding = defineChecklists({
  tasks: {
    invite: { title: "Invite a teammate", isComplete: (c) => c.invited },
    project: { title: "Create a project", walkthrough: projectTour },
  },
});
```

```tsx
<WaymarkRoot key={user.id} storage={`waymark:${user.id}`} context={appContext}>
  <App />
</WaymarkRoot>

// Anywhere below it
<WalkthroughButton walkthrough={filtersHelp} aria-label="How filters work">
  ⓘ
</WalkthroughButton>
<Checklist checklist={onboarding.checklists.main} />

const run = useRun();
run.start(filtersHelp); // from the app's own button
run.requestStart(whatsNew); // from the app's own code
run.subscribe((snapshot) => analytics.track(snapshot)); // changes nothing
```

### Terms

- The **Run** is the machinery that runs one user's walkthroughs. There is one
  per user.
- A walkthrough's **progress** is how far one user is through it: its step,
  whether it is collapsed, and whether it is running, finished or exited. A
  walkthrough with no progress hasn't started.
- The **open** walkthrough is the one whose popover shows. There is at most
  one.
- The Run is **attached** while a renderer draws it.

### Inside the Run

```ts
definitions: Map<WalkthroughId, Walkthrough>; // handed over on use, never saved
walkthroughProgress: Record<WalkthroughId, WalkthroughProgress>; // saved
waiting: Walkthrough[]; // from requestStart, oldest first, not saved

type WalkthroughProgress = Readonly<{
  step: number;
  collapsed: boolean;
  status: "running" | "finished" | "exited";
  changedAt: number;
}>;
```

Which walkthrough is open, and which beacons show, are worked out from the
progress each time, not stored, so they can't fall out of step with it:

```ts
const progress = Object.entries(walkthroughProgress);
const open = progress.find(([, p]) => p.status === "running" && !p.collapsed);
const beacons = open
  ? []
  : progress.filter(
      ([id, p]) => p.status === "running" && p.collapsed && definitions.has(id),
    );
```

The Run keeps one rule: at most one walkthrough is running and not collapsed.

There is one machine. `run/rules.ts` already works out the next state from the
current one and a message without touching the page. It works on the open
walkthrough, and opening another hands it that one's state. Every other
walkthrough is plain data, so nothing needs disposing, and `reset` edits data
whatever state the walkthrough is in. A visible beacon needs only its
waymark's position, so the frame loop measures each visible beacon's waymark
as well as the open walkthrough's.

Definitions and progress are kept apart because they arrive at different times
and only one can be saved. A step holds functions and, in React, JSX, so a
definition can't be stored. On a reload, a walkthrough's progress loads from
storage before anything has handed the Run its definition.

The app sees one object. The alternative, a map that hands out the open Run,
makes every renderer and listener drop the old Run and follow the new one each
time another walkthrough opens, which is what `subscribeActive` does today.

### Subscribe and attach

|                       | `subscribe`                    | `attach`                        |
| --------------------- | ------------------------------ | ------------------------------- |
| Means                 | Tell me when it changes        | I'm drawing it now              |
| Page listeners, frame | No                             | Yes, while attached             |
| Who calls it          | Renderer, analytics, checklist | The root renderer               |
| Undone                | Stops hearing changes          | Listeners off; progress kept    |

`attach` doesn't draw anything. The renderer draws, and `attach` tells the Run
so. While attached, the Run listens for keys on `window` and clicks on
`document`, measures waymarks each frame, and marks the open step's waymark
with aria. It keeps its attachments in a list. The first switches the page
listeners on, the last to detach switches them off, and the newest one's
elements count, so StrictMode's remount and a handoff between renderers work.
`mounted` in `State` becomes `attached`.

The renderer passes the tour's own dialog and beacon, and its waymark padding.
With the elements, keys pressed inside other Waymark UI, such as the checklist
popover, are left alone, and Tab moves focus into the dialog. Clicks need
nothing extra: anything marked `data-waymark-ui` already counts as tour UI. The
elements are passed in rather than found by attribute. The attribute says
"some Waymark UI"; the argument says "this tour's UI", and it still works when
a renderer portals into a shadow root. The padding is how much room the shade
leaves around the waymark, a drawing choice, and the Run uses the same number
to count a click near the waymark as a click on it.

What `subscribe` does today beyond calling its listener moves to `attach`:

- The page listeners.
- The `start` event. It fires once per walkthrough, the first time it is drawn.
- The clocks. A state check's `delayMs` starts again on attaching, and time
  spent detached does not count towards lost or missing.

### WaymarkRoot

`<WaymarkRoot>` wraps the app once and does two jobs. It makes the Run from its
props and provides it through context, which is how a button or `useChecklist`
deep in the tree finds it. And it is the one renderer: it draws the open
walkthrough and the visible beacons in a portal at the end of `<body>`, and
attaches the Run while mounted. With one renderer drawing at most one open
walkthrough, two tours can't fight.

| Prop                             | What it does                                    |
| -------------------------------- | ----------------------------------------------- |
| `storage`                        | A localStorage key or an adapter. Optional.     |
| `problemHandlers`                | One set for every walkthrough and checklist.    |
| `context`                        | The app's facts, read by completion conditions. |
| `waymarkPadding`                 | Room around the waymark, drawn and clicked.     |
| `renderPopover`, `renderBeacon`  | The app's own drawing, for every walkthrough.   |
| `labels`, `onEvent`              | As today.                                       |

`key={user.id}` gives a new user a new Run. Components reach the Run with
`useRun()`.

`<Walkthrough walkthrough={x} />` stays, as the way a page says it has a tour.
Mounting it calls `run.requestStart(x)`. It draws nothing itself, since
`<WaymarkRoot>` draws, but today's first README example reads the same.

`createRun` is for an app that writes its own root: one in Svelte, Vue or plain
JavaScript, or a React app that wants to. It takes the same options. Svelte
provides it with `setContext`, Vue with `provide`. A plain-JavaScript app that
only runs in the browser can export it from a module.

The Run is not a global. On a server, a global is shared by every request, and
the checklist renders there through `getServerSnapshot`. Tests would share it,
and two bundled copies of core would each keep their own. A warning in
development catches two Runs attached to one document.

### Custom drawing

`renderPopover` and `renderBeacon` on `<WaymarkRoot>` set the app's look for
every walkthrough. A definition can carry its own, which wins for that
walkthrough:

```tsx
const whatsNew = defineWalkthrough({
  id: "whatsNew",
  steps,
  renderPopover: (props) => <Announcement {...props} />,
});
```

The root's function sees the steps of every walkthrough, so it can't know the
type of a step's `meta`. A definition's sees only its own steps, with their
exact types. React's definitions already carry JSX in their steps' `content`,
so a render function there is nothing new. Without either, Waymark draws its
own popover and beacon.

### Starting a walkthrough

The caller says whether the user asked:

```ts
/**
 * Shows a walkthrough the user asked for, now. An open walkthrough is set
 * aside as its `dismiss` says. Part way through, this one opens where it was;
 * finished or exited, it starts again at step 1.
 */
start: (walkthrough: Walkthrough) => void;

/**
 * Shows a walkthrough the app chose, not the user. It waits until no
 * walkthrough is open, so it never interrupts one the user is in, and does
 * nothing if the user has already finished or exited it.
 */
requestStart: (walkthrough: Walkthrough) => void;
```

Waymark's own controls call `start`, since they are always clicks: an ⓘ
button, a checklist row's Start, a beacon. A button's `active` prop calls
`requestStart`, and so does a tour the app opens from an effect.

| Its progress               | `start`                 | `requestStart`               |
| -------------------------- | ----------------------- | ---------------------------- |
| None                       | Step 1, now             | Step 1, once nothing is open |
| Part way                   | Opens where it was, now | As it was, once nothing is open |
| Finished or exited         | Starts again at step 1  | Nothing                      |

A click always shows something, and the app never brings back a tour the user
closed. That is one rule where the earlier designs needed a special case for
the button.

### Interrupting and beacons

When `start` opens a walkthrough over an open one, the open one is set aside as
its `dismiss` says. With the default it collapses, keeping its step. With
`dismiss: "exit"`, as a hint has, it exits. It fires `interrupt` in place of
`collapse` or `exit`, naming the walkthrough that interrupted it, so analytics
can tell it from the user turning away.

While a walkthrough is open, no beacons show. Once none is open, every
collapsed walkthrough shows its beacon on its step's waymark, and the user
picks which to go back to. A beacon is already the prompt to continue, so this
needs no new UI and no paused state.

A beacon whose waymark isn't on the page has nowhere to sit. Today it falls
back to the bottom of the screen. Only the most recently collapsed walkthrough
does that now, going by `changedAt`. The others show only where their waymark
is found. The user can always pick up the tour they just left, and the bottom
of the screen never fills with beacons.

When the open walkthrough finishes, exits or collapses, a waiting
`requestStart` goes first. The beacons show once nothing is open.

### Progress and storage

Storage moves from walkthrough definitions to the Run. It is optional: a
localStorage key, an adapter, or nothing for memory only. Problem handlers move
with it, one set per Run.

Each user has one record: every walkthrough's progress and the checklist
statuses. The waiting list is not saved; the app asks again on the next load.

- While the record loads, the Run holds every command and runs them in order
  once it is in, as the controller's `whenLoaded` and a loading Run do today.
- The Run's copy is the optimistic one. A click on Next moves the tour at once
  and the save follows.
- A save that fails keeps the new step and reports `storageFailed`.
- When the adapter hears a change made elsewhere, from another tab or a server
  push, checklist statuses take it at once. The open walkthrough keeps its
  place, and its next save wins.

A server is one more adapter. For Convex, `load` and `subscribe` are a query
subscription and `save` is a mutation.

A new user means a new Run. It reads that user's record and leaves the last
user's record alone. With no storage, switching users loses the last user's
progress, as a reload does.

### Definitions

`defineWalkthrough` takes one object. `id` is required and must not change
between releases, since it is the walkthrough's key in the saved record. With
storage and problem handlers on the Run, there is one kind of walkthrough, and
a task takes the same object a standalone tour does.

A definition can be written anywhere. It reaches the Run when something uses
it: `run.start`, an ⓘ button when it mounts, a checklist for its tasks.
Handing over a different definition under an id already taken throws in
development.

Progress restored for a walkthrough whose definition hasn't arrived waits as
data. It shows no beacon and doesn't count as open, so a `requestStart` can go
meanwhile. When the definition arrives, usually because its page has mounted,
a walkthrough that was open opens again if nothing else is. Otherwise it is set
aside as its `dismiss` says, as if it had been interrupted: a tour waits
collapsed, and a hint with `dismiss: "exit"` exits. So a hint that isn't open
is never part way through, and its ⓘ always starts it at step 1.

### Checklists

`defineChecklists({ tasks, checklists })` describes the tasks and the
checklists that list them, as `defineWalkthrough` describes a walkthrough. It
holds no state. The statuses, todo, done or skipped, live in the Run's record,
and `<Checklist>` and `useChecklist` find the Run through context. Completion
conditions read the `context` prop on `<WaymarkRoot>`, so the app's facts flow
in as a prop and the conditions check again when it changes. That replaces
`onboarding.update(context)`. Checklist events, such as `taskStarted` and
`checklistComplete`, come through the root's `onEvent` with the walkthroughs'.

A task's Start calls `run.start` with the task's walkthrough. The checklist
reads its tasks' progress from the Run's snapshots. Subscribing no longer
switches anything on, so `MOVES` goes, and there is one save rule, the Run's.
`bindUi`, `waymarkPadding` and `subscribeActive` go. So does the stop rule:
`<WaymarkRoot>` is mounted for the app's life, so a task's tour can no longer
lose its renderer.

The open task is the task whose walkthrough is open. A task whose walkthrough
is collapsed is in progress. Starting a task collapses the open walkthrough
instead of exiting it, so several tasks can be in progress at once, and each
shows its beacon once nothing is open.

### The walkthrough button

[walkthrough-button.md](walkthrough-button.md) is updated to match. A click
calls `run.start` and `active` calls `run.requestStart`, with or without
storage. The button takes a definition, `walkthrough={filtersHelp}`, or an
`id` and `steps` inline, from which it builds a definition once, with
`dismiss: "exit"`. Its own `storage` prop goes.

## Why

- `subscribe` does what every store's `subscribe` does. Following a tour no
  longer changes it.
- Two tours can't fight, because one renderer draws at most one open
  walkthrough.
- One kind of walkthrough, one save rule and one route from renderer to Run
  replace review problems 4, 3 and 2.
- Clicks and app code follow one rule for who goes first.
- No walkthrough can miss a reset, and nothing needs disposing.
- Interrupted tours come back as beacons, which users already know mean "click
  to continue", and which tour is open is worked out, never stored.
- A React app never builds the Run, and its setup reads much as it does today.

## Costs

- Most of the public interface changes: `defineWalkthrough`, `createChecklists`,
  which becomes `defineChecklists`, and React's `<Walkthrough>`, whose drawing
  moves to `<WaymarkRoot>`. Both packages are at 0.0.0.
- Every walkthrough needs an id that stays put.
- A restored walkthrough waits until something that uses it has mounted.
- The frame loop measures one waymark per visible beacon, not just the open
  walkthrough's.
- Several tasks can be in progress at once, where today starting one exits the
  other.
- A Svelte or plain-JavaScript app writes its own root, and today
  `placement.ts` lives in the React package.
- Core tests subscribe to make a Run watch the page (`watch` in `run.test.ts`).
  They attach instead.

## Alternatives

- Document the trap beside `subscribe`. Every app that adds analytics still
  finds it.
- A flag, `subscribe(listener, { watch: false })`. Svelte's `$run` can't pass
  it, so the harmful default stays.
- Split `subscribe` from `attach` on each walkthrough's own Run, and keep one
  open with a page-wide slot (`claimPage` in the button design). It fixes the
  analytics trap but keeps a global, with the server, test and two-copies
  problems above.
- Runs that tell each other through DOM events. No shared object, but nothing
  can remember who was set aside.
- Let the root renderer decide which Run to draw. The rule would live in React,
  and every other framework would write it again.
- A live Run per walkthrough. Each needs disposing, an idle one can miss a
  reset, and something has to track which are attached.
- Two public objects, a map and the open Run it hands out. Every listener
  re-follows each time another walkthrough opens.
- A stored interrupted state and a stack, bringing back the newest when the
  open walkthrough ends. More state to keep in step, and only one tour could
  come back at a time.
- An interrupted walkthrough that stays hidden until the app offers to resume
  it, or a built-in "Resume?" prompt. The first loses the tour in an app that
  builds nothing. The second is a new component with copy to translate, and
  the beacon already does its job.
- For beacons with no waymark on the page: none at the bottom of the screen,
  every one stacked there side by side, or one grouped beacon with a count.
  The first can leave the tour just left with no way back, the second fills the
  screen, and the third is new UI.
- Declare every walkthrough where the Run is made, or have `defineWalkthrough`
  add itself to a module-level list. The first rules out defining a walkthrough
  beside the code it explains; the second is a global, and tests and hot reload
  would define the same id twice.
- `<WaymarkRoot>` taking a Run the app made, and `createChecklists(run, …)`.
  A React app would build both per user in a wrapper of its own and pass the
  controller down through its own context.
- Find the tour's elements by attribute, so `attach` takes no elements. See
  "Subscribe and attach".
- One `renderPopover`, on the root only. It can't type a step's `meta`.

## Later

- Move `placement.ts` from the React package into core, so every framework
  shares popover placement. It is an experiment and a separate change, since
  it isn't yet clear it works well there.

## Code changes

- `run/run.ts`: `createRun` takes options, not a walkthrough. It keeps the
  definitions, progress, waiting list and attachments, and gains `start`,
  `requestStart`, `reset` and `attach`. `subscribe` only adds the listener and
  calls it. `onReset` goes.
- `run/state.ts`, `run/rules.ts`: `mounted` becomes `attached`. The state is
  the open walkthrough's, and the frame loop also measures visible beacons'
  waymarks.
- `run/types.ts`: the new `Run`. `RunOptions` loses `ui`, `startAt`,
  `collapsed` and `resumed`, and gains `storage`, `problemHandlers` and
  `context`.
- `walkthrough/`: `defineWalkthrough` takes one object with an `id`.
  `UnstoredWalkthrough`, `UnstoredWalkthroughOptions`, the extra forms,
  `isSteps` and the walkthrough's own `reset` go. `storageOf` moves to the Run.
- `storage/`: one record per Run.
- `checklists/`: `createChecklists` becomes `defineChecklists`, which holds no
  state. `bindUi`, `boundUi`, `NO_UI`, `waymarkPadding`, `subscribeActive`,
  `MOVES`, the controller's storage options and its two throws go. `initial`
  and `onChange` move to the Run.
- `problems.ts`: `record` changes, as there is one record.
- React: `<WaymarkRoot>` and `useRun()` are new. `<WaymarkRoot>` draws through
  `RunView`, which attaches. `<Walkthrough walkthrough>` calls `requestStart` on
  mount. `<Walkthrough checklists>`, `useOwnedRun`,
  `ActiveWalkthrough`, `ChecklistGuidance` and `holders` go. `definition.ts`
  keeps one form of `defineWalkthrough`, which can carry `renderPopover` and
  `renderBeacon`. `<Checklist>` and `useChecklist` read the Run from context.
- e2e: each fixture makes one Run, `checklist.ts` attaches in `drawRun`, and
  `WatchLog`'s note goes.
- `CONTEXT.md`: rewrite Run, add walkthrough progress, open walkthrough and
  attached, and replace the checklist controller with the checklist
  definition.
- README: the walkthrough, checklist and storage sections.

## Tests

- Subscribing alone adds no listeners, frames or aria.
- `start` fires on the first attach, once per walkthrough.
- `start` over an open walkthrough collapses it, or exits it with
  `dismiss: "exit"`, and fires `interrupt` naming the newcomer.
- No beacon shows while a walkthrough is open. Once none is, every collapsed
  walkthrough's beacon shows where its waymark is, and only the most recently
  collapsed one falls back to the bottom of the screen.
- `requestStart` waits while a walkthrough is open, goes before the beacons
  show, and does nothing for a finished or exited walkthrough.
- `start` restarts a finished or exited walkthrough at step 1.
- At most one walkthrough is ever running and not collapsed.
- `reset` reaches a walkthrough that isn't open.
- Restored progress waits for its definition, doesn't hold off `requestStart`,
  and opens again on arrival if nothing else is open. If something is, a tour
  waits collapsed and a hint exits.
- Commands made while the record loads run in order once it is in.
- A failed save keeps the step and reports `storageFailed`.
- A change from elsewhere updates checklist statuses but not the open
  walkthrough's place.
- Changing `<WaymarkRoot>`'s `context` re-checks completion conditions.
- Mounting `<Walkthrough walkthrough>` requests the walkthrough, and draws
  nothing of its own.
- A definition's `renderPopover` wins over the root's for that walkthrough.
- The StrictMode and handoff tests in `Walkthrough.test.tsx` pass against
  `<WaymarkRoot>`.
