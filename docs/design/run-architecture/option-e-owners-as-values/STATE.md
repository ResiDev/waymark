# Option E: every piece of state

Today `run.ts` declares about 35 variables, each on its own, all in one
closure that any of its 1,007 lines can write. Nothing says which belong
together. Option E puts each one in one of five places:

| Where | What | Mutable? | Written by |
| --- | --- | --- | --- |
| `RunState` | The facts the snapshot, the save and the rules are drawn from | No: one value, replaced once per change | `commit` alone |
| `run.ts` | What has been published, held commands, context | Yes, 7 names | `run.ts` alone |
| `storage/link.ts` | The connection to storage | Yes, one private object | `link.ts` alone |
| `run/page.ts` | The DOM: renderers, listeners, reported throws | Yes, one private object | `page.ts` alone |
| `queue.ts` | Work waiting to run | Yes, unchanged from today | `queue.ts` alone |

The `Change` holds one change's events, problems, credits and scrolls, and is
thrown away when the change ends.

## What goes in `RunState`

A piece of state goes in `RunState` when all three hold:

1. **It is an input.** The snapshot, the save or a rule's decision is drawn
   from it.
2. **A change needs it before and after**, to see what changed and announce it.
3. **It is plain data**: no functions, DOM handles or live subscriptions, so
   comparing by identity means something.

## `RunState`

```ts
type RunState = Readonly<{
  walkthroughs: Readonly<{
    definitions: ReadonlyMap<string, Walkthrough>;               // id → the definition handed to start/act/…
    progress: Readonly<Record<string, Readonly<{                  // the saved half, id → entry
      status: "running" | "finished" | "exited";
      step: number; stepCount: number; collapsed: boolean; changedAt: number;
    }>>>;
    restored: ReadonlySet<string>;                                // loaded ids whose definition hasn't arrived
    open: Readonly<{                                              // the walkthrough on screen; only `seat` writes it
      walkthrough: Walkthrough;
      state: State;            // rules.ts's machine: snapshot, stepGeneration, started, resumed, attached,
                               // element, satisfied, unlocked, scrolled, heldSince, unseenSince
      looked: boolean;         // its first look has gone out
    }> | undefined;
    waiting: readonly Walkthrough[];                              // requestStart queue, oldest first
    lastGeneration: number;                                       // the next walkthrough's steps follow it
  }>;
  checklists: Readonly<{
    statuses: Readonly<Record<string, "done" | "skipped" | "reopened">>;  // todo = absent
    tasks: ReadonlyMap<string, DefinedTask>;                      // id → { id, task, walkthrough, isComplete }
    groups: ReadonlySet<ChecklistGroup>;
    startedFrom: ReadonlyMap<string, string>;                     // walkthrough id → the checklist that started it
  }>;
  sightings: ReadonlyMap<string, Readonly<{                       // walkthrough id → where its beacon's Waymark was seen
    stepIndex: number; waymark: Location; unseenSince: number | undefined; element: Element | null;
  }>>;
  storageStatus: "loading" | "ready" | "error";
}>;
```

| Today | In `RunState` | Changed by |
| --- | --- | --- |
| `definitions` | `walkthroughs.definitions` | the first use of a walkthrough |
| `progress` | `walkthroughs.progress` | a step, phase or collapse changing; load; hear; replace |
| `restored` | `walkthroughs.restored` | load, hear, replace; emptied as definitions arrive |
| `machine` | `walkthroughs.open.state` | clicks, keys, and frames where the Waymark moved |
| `looked` | `walkthroughs.open.looked` | the first look after it opens or attaches |
| `waiting` | `walkthroughs.waiting` | requestStart, withdraw, settle |
| `lastGeneration` | `walkthroughs.lastGeneration` | a walkthrough closing |
| `statuses` | `checklists.statuses` | mark, skip, conditions, finished Tasks; load; hear; replace |
| `tasks` + `taskById` | `checklists.tasks`, one Map | the first use of a checklist |
| `groups` | `checklists.groups` | the first use of a checklist |
| `startedFrom` | `checklists.startedFrom` | a checklist's Start; cleared when its walkthrough stops |
| `sightings` | `sightings` | frames while beacons show |
| `storageStatus` | `storageStatus` | load, replace |

### Every frame

Each function hands back the object it was given when nothing changed, as
`rules.apply` already does. So "did anything change?" is `next === before`, one
comparison, not a deep compare.

- **Still frame.** `commit` sees `next === before` and nothing said, asks for
  the next frame, and does nothing else. Nothing is allocated. Today the same
  frame rebuilds the snapshot, refreshes every checklist view, and diffs the
  record and the statuses.
- **The Waymark moved.** `rules` makes a new `State`, as today. Option E adds
  three small shallow copies: `open` (3 fields), `walkthroughs` (6) and
  `RunState` (4). `progress` is untouched, so nothing is saved, and no
  checklist is looked at.

## `run.ts`

```ts
/** What the Run and each checklist last published. The same shape for both. */
type Published<T> = {
  snapshot: T;
  readonly serverSnapshot: T;
  readonly listeners: Set<(snapshot: T) => void>;
};

let state: RunState;
/** The state a server render sees: before storage was read. Every server snapshot is selected from it. */
const server: RunState;
const run: Published<RunSnapshot>;
/** Each checklist the app asked for, with the object `run.checklist(definition)` hands back, made once. */
const checklists: Map<ChecklistDefinition<AnyTask>, Published<ChecklistSnapshot<AnyTask>> & { readonly checklist: Checklist<AnyTask> }>;
/** Commands given while the record loads, run in order once it is in. */
const held: (() => void)[];
/** The app's facts, which completion conditions read. Asked here, so no app code runs inside a change. */
let context: unknown;
/** A record Waymark cannot read has been reported, which it is once, until one it can read comes. */
let unreadable = false;
```

Set once and never changed, so wiring rather than state: `report`, `queue`,
`adapter`, `link`, `page`.

## `storage/link.ts`

```ts
export function createStorageLink(adapter: Adapter, on: {
  /** The stored record, read once, on the first connect. */
  record: (read: Parsed<Read> | { failed: unknown }) => void;
  /** A record saved elsewhere, while connected and once the record is in. */
  heard: (value: unknown) => void;
}): Readonly<{ connect: () => () => void }>;

// Private:
type Link = {
  /** How many `connect`s are open. Other tabs are heard while there is one. */
  connections: number;
  /** The record is asked for on the first connect, so a server render never reads it. */
  phase: "unasked" | "asking" | "loaded";
  stopHearing: (() => void) | undefined;
};
```

It starts hearing right after `on.record` returns, so it never reads
`storageStatus`.

## `run/page.ts`

```ts
// Private:
type Page = {
  /** Renderers drawing the Run, newest last. The newest one's elements are used. */
  attachments: Attachment[];
  /** DOM listeners. `sync()` brings them in line with the state after every change. */
  watching: {
    input: Watcher<true>;                    // clicks and keys
    frame: Watcher<true>;                    // the next animation frame
    aria: Watcher<WaymarkAria>;              // aria attributes on the Waymark
    events: Watcher<WaymarkEvents>;          // listeners for "advance on event" steps
  };
  /** A state check's error → the step it was reported on, so a check that throws is reported once a step, not every frame. */
  thrown: Map<string, number>;
};
type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;
type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

// At module level, shared by every Run on the page, for the "two Runs on one page" warning.
const attachedRuns = new WeakMap<Document, number>();
```

## `queue.ts`, unchanged

```ts
const queue: (() => void)[] = [];   // work waiting while a change is announced
let draining = false;
let errors: unknown[] = [];         // what the app's callbacks threw, rethrown once the queue drains
```

## What each piece outside `RunState` is for

Each exists for a behaviour; none is dead. This is where today's names went.

| Today | Why it exists | Option E |
| --- | --- | --- |
| `connections` | Two `WaymarkRoot`s can share one Run, and StrictMode mounts, unmounts and mounts again | `Link.connections`. A boolean would let the first root to unmount stop hearing for both. |
| `asked` | The record is read once, on the first connect | Merged with "loaded" into `Link.phase` |
| `unsubscribe` | Stops hearing other tabs | `Link.stopHearing` |
| `unreadable` | An unreadable record is reported once, not on every save another tab makes | Stays in `run.ts`, beside `load`, `hear` and `replace`, its only readers and writers |
| `attachments` | The newest renderer's elements are used, and the one before takes over when it unmounts | `Page.attachments` |
| `input`, `frame`, `waymarkAria`, `waymarkEvents` | Four DOM hookups, opened and closed at different times | Grouped in `Page.watching` |
| `thrownStep` + `thrownErrors` | A throwing state check would be reported 60 times a second | Merged into `Page.thrown`. Entries from old steps stay: one per distinct message. |
| `attachedRuns` | The development warning for two Runs on one page | Kept. Could be dropped, losing the warning. |
| `snapshot` + `listeners`, `views` + `checklists` | What the Run and each checklist last published, and who listens | `Published<T>`, one shape for both |
| `server` (a `Seen`) | What a server render shows | `server: RunState`, selected with the same selectors as live |
| `openShown`, `beaconsShown` | Keep snapshot parts the same object when they did not change | Gone: the previous snapshot is passed to each selector |
| `held` | A command given while loading acts on the user's progress, not on none | Kept |
| `context` | The app's facts for completion conditions | Kept, outside `RunState`: no transition reads it, only the `Verdicts` asked with it |
| `events`, `problems`, `credits` | Gathered while a change runs, announced after | The `Change`, one per change |

## Counted

| | Today | Option E |
| --- | --- | --- |
| Named mutable variables outside `RunState` | about 22, in one closure | 7 in `run.ts`, one object in `link.ts`, one in `page.ts`, 3 in `queue.ts` |
| Facts that any line can write | 14 | 0: `RunState` is replaced only by `commit` |

## Not done, with what each would cost

- **Merging three of the watchers.** `input`, `aria` and `events` all follow
  the open step, and could be one, rebuilt when the step changes. Fewer names,
  but more DOM churn: aria attributes removed and put back on changes that do
  not need it. Not measured.
- **`unreadable` as a `RunState` field**, "the last record seen was
  unreadable", reported when it flips. No report-once flag, but an unreadable
  record from another tab becomes a change of its own.
- **Grouping costs bytes.** A minifier shortens a local like `connections` to
  one letter but leaves `link.connections` spelled out. Repeated property names
  compress well, so expect tens of bytes. Measure with `pnpm size`.

## Download size

Measured from source with the settings of `pnpm size`, React left out. Brotli
is what a browser downloads.

| Bundle | main | run-redesign-wip |
| --- | --- | --- |
| React, everything | 14.7 KB | 16.4 KB |
| React, walkthroughs only | (no `WaymarkRoot` on main) | 13.6 KB |
| Core, everything | 8.6 KB | 10.2 KB |
| Core, walkthroughs only | 5.5 KB | 9.7 KB |

Most of the walkthrough-only growth is checklist code. `createRun` imports it
now, so an app that uses only walkthroughs ships it too. On main, a bundler
left it out. Option E as sketched keeps the same features and logic, so it
should be about the same size as today. Winning the checklist code back needs
one seam: `run.ts` does not import `checklists.ts`, and `defineChecklists`
hands its functions to the Run when `run.checklist(definition)` is first
called. Not yet decided.
