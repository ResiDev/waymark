# Storage

Status: built. Where the build settled a detail this design left open, or
changed one, "As built" at the end says so. Replaces two todos: "Persist the active run across
reloads" and "Async storage".

## Problem

- `createChecklists` calls `StoredRecord.load()` once, synchronously, at
  creation. Task statuses can't come from a server or follow a user across
  devices.
- Only task statuses are stored. A reload drops the active task, its step and
  whether it was collapsed.
- A walkthrough used without checklists stores nothing, so it can't remember
  that the user finished or exited it.
- Validation and the version envelope live in the localStorage adapter. A custom
  adapter has to copy them or trust its backend, and `createProgress` takes
  whatever it is given.
- Each save writes the whole record. A tab holding an older record overwrites
  changes another tab made.

## Two records

What is stored splits into two records that behave differently:

|              | Tasks record                 | Walkthrough record                      |
| ------------ | ---------------------------- | --------------------------------------- |
| Holds        | each task's status           | the running walkthrough: step, collapsed |
| Lives        | weeks                        | until the run ends, or a day at most    |
| Changes      | when a task's status changes | every step, collapse and resume         |
| Natural home | a server, following the user | this device                             |
| Used by      | checklists                   | checklists and standalone walkthroughs  |

Each record has its own adapter, so an app can keep task statuses on its server
and the walkthrough record in localStorage.

Users see the word "walkthrough" for the second record, not "run". In the
glossary it holds the state of a run; the option is named for what users know.

### Shapes

Plain, readable types. Core owns the version and validation.

```ts
type StoredTasks = Readonly<{
  version: 3;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
}>;

/** A checklist's active task and where its walkthrough is. `null` when no task is active. */
type StoredChecklistWalkthrough = Readonly<{
  version: 1;
  task: string;
  /** The checklist whose `start` began it, so its skip events name it. */
  from?: string;
  step: number;
  stepCount: number;
  collapsed: boolean;
  /** Epoch ms. */
  savedAt: number;
}>;

/** A standalone walkthrough. `null` when it has never started. */
type StoredWalkthrough =
  | Readonly<{
      version: 1;
      phase: "running";
      step: number;
      stepCount: number;
      collapsed: boolean;
      savedAt: number;
    }>
  | Readonly<{ version: 1; phase: "completed" | "exited" }>;
```

Keys are `string`, not task ids. Stored statuses outlive the task map. A task
renamed or removed in a deploy is still in storage. `clear()` already drops
unknown ids for this reason.

A checklist's walkthrough record never needs `completed` or `exited`; whether a
task finished is in its status. A standalone walkthrough has no statuses, so its
record carries the ended phase. That is what stops a finished tour showing
again.

`reopened` is visible to adapters. It is stored like the other statuses.

The tasks record starts at version 3 so the current localStorage envelope,
`{ version: 2, record }`, can be read and migrated. Core does the migration, so
`load` may hand back a version 2 value whatever its type says.

## Adapters

```ts
type StorageAdapter<T> = Readonly<{
  load: () => T | null | Promise<T | null>;
  /** `null` clears. Core does not wait for it. */
  save: (value: T | null) => void | Promise<void>;
  /** Changes made elsewhere: another tab, another device. Optional. */
  subscribe?: (listener: (value: T | null) => void) => () => void;
}>;
```

`load` returns either a value or a promise, so localStorage needs no loading
state and draws its first frame with what it has.

Core ships one adapter, `localStorageAdapter(name)`. It replaces
`createLocalStorageRecord`. Any other backend is a plain `{ load, save }` object
the app writes.

### Options

```ts
// createChecklists
storage?: Readonly<{
  tasks?: StorageAdapter<StoredTasks>;
  walkthrough?: StorageAdapter<StoredChecklistWalkthrough>;
  /** In ms. A walkthrough record older than this is not restored. Default a day. */
  maxAge?: number;
}>;
/** Task statuses to start from, such as ones fetched during server rendering. */
initial?: StoredTasks;
onStorageError?: (error: unknown, record: "tasks" | "walkthrough") => void;

// createRun, and React's <Walkthrough>
storage?: Readonly<{
  walkthrough?: StorageAdapter<StoredWalkthrough>;
  maxAge?: number;
}>;
onStorageError?: (error: unknown) => void;
```

A record with no adapter is not stored, as today. `initial` replaces today's
`stored` option.

```ts
// Both in the browser
createChecklists({
  tasks,
  storage: {
    tasks: localStorageAdapter("app-tasks"),
    walkthrough: localStorageAdapter("app-walkthrough"),
  },
});

// Task statuses on the server, the walkthrough in the browser
createChecklists({
  tasks,
  storage: {
    tasks: { load: () => api.get("/tasks"), save: (value) => api.put("/tasks", value) },
    walkthrough: localStorageAdapter("app-walkthrough"),
  },
});

// A walkthrough alone
createRun(walkthrough, { storage: { walkthrough: localStorageAdapter("onboarding-tour") } });
```

### Users

Users of one browser keep apart by putting their id in the name:
`localStorageAdapter(`app-tasks-${user.id}`)`. A server adapter already knows
the user from its own auth.

To switch users without a reload, create a new owner. In React, put
`key={user.id}` on whatever creates it.

### One adapter per record

There is no single adapter covering both records. It would save a few lines for
an app with one endpoint, but every step change would send the task statuses
again, and most apps will keep the walkthrough record local anyway.

## Rules

### Loading

1. The tasks record loads first. While a promise is pending, the snapshots say
   `status: "loading"` and nothing is saved, so the first command can't
   overwrite the server copy with an empty record.
2. The walkthrough record is restored once the tasks record is in, even when
   its own load is synchronous. Task statuses win: if the stored task is no
   longer todo, the walkthrough record is wiped.
3. Arriving records emit no events, like the initial condition check today. A
   reload must not announce what storage already had.
4. Conditions are checked again once the tasks record arrives, against the
   latest context passed to `update()`, not only `config.context`.
5. Core restores a walkthrough as it was saved, on the same step, collapsed or
   not.

The owner has `ready: Promise<void>`, resolved once the tasks record is in. With
localStorage it has already resolved. It resolves on failure too, which is
reported through the snapshot and `onStorageError`, so awaiting it never throws.
It is mainly for tests, and for code that would rather wait than show a loading
state.

### Commands while loading

App code can call `markDone`, `markTodo`, `skip`, `toggle`, `start`, `stop` and
`clear` before the tasks record arrives. Core holds these calls in a list and,
once the record is in, runs them on it in order.

Applying them to the empty record and merging the result afterwards would be
wrong, because some depend on a task's current status:

| Stored     | Called while loading | Merging the result     | Running the call later |
| ---------- | -------------------- | ---------------------- | ---------------------- |
| A done     | `skip(A)`            | A skipped, done lost   | A stays done           |
| B done     | `markTodo(B)`        | B done, the call lost  | B taken back to todo   |

Nothing changes on screen until the record arrives; the UI shows loading.
Events fire once, when the calls run, and describe what really changed. A
`start` waits too, so a tour started on page load is only shown if its task is
still todo. Held calls run before the walkthrough record is restored, and a
record is only restored if no walkthrough has been started or stopped since
the owner was made, so a held `start` wins, and so does a `stop`.

`update(context)` is not held. Only the latest context matters, and rule 4
checks it.

### Snapshots

`ChecklistSnapshot` and `ChecklistsSnapshot` both gain
`status: "loading" | "ready" | "error"`, so a single checklist view can show
loading or a failed load without reaching for the owner.

### Validation

Core validates every record, whichever adapter it came from.

Tasks record:

- `null`: start empty.
- An older version: migrate.
- A bad shape or a newer version: report it, start empty, and save nothing
  until the user changes something. A newer version usually means a rolled-back
  deploy, and an adapter bug should not wipe the server copy.

Core wipes the walkthrough record on any mismatch. It exists to survive a reload
or a browser restart, not an app update, so losing it costs little. A mismatch
is any of:

- a bad shape or a different version
- an unknown task, or a task that is not todo
- a `stepCount` different from the walkthrough's
- a `savedAt` older than `maxAge`

The `stepCount` and age checks apply only while running. A standalone
walkthrough's `completed` or `exited` survives changes to its steps and never
expires; otherwise every user would see the tour again after a deploy.

Every failure goes to `onStorageError`, naming the record. Without a handler it
goes to `console.error` instead.

### Saving

- The tasks record saves after each change, as today.
- The walkthrough record saves on start and stop, each step change, and
  collapse and resume. Restoring it saves nothing.
- Core calls `save` without waiting and catches a rejected promise. Ordering,
  retries and debouncing belong to the adapter. A server adapter for the
  walkthrough record should debounce.

### Tabs and devices

When an adapter has `subscribe`, core loads each value it reports the way the
owner's `load()` does, silently and without saving. A tab or device with an
older record can then no longer write it over a newer one.

`localStorageAdapter` implements `subscribe` with the browser's `storage`
event, which fires in every other tab when one writes. Core subscribes to the
tasks record only. The walkthrough record is read at creation; tabs share it,
and the last to write wins, so after a reload two tabs may restore the same
walkthrough.

A server adapter without `subscribe` can still have tabs and devices overwrite
each other. Document it.

### Clearing

The owner's `clear()` keeps doing what it does. Task statuses go back to todo
and are saved, and the active run carries on. The walkthrough record follows the
active run, so it needs no clearing of its own.

Runs get no `clear()`. To show a finished standalone walkthrough again, call
`act("reset")`. It already restarts a completed or exited run, and saving the
new running state replaces the stored `completed`.

### Server rendering

The server has no localStorage. If it rendered nothing stored and the client's
first render read localStorage, React would report a hydration mismatch.

- With localStorage, the server renders the loading state and so does the
  client's first render; localStorage is read straight after. Each checklist
  and the owner have `getServerSnapshot`, the snapshot from before storage was
  read, which the React adapter gives `useSyncExternalStore`. The cost is one
  frame of loading state on server-rendered pages only.
- An app that fetches task statuses on the server passes them as `initial`.
  Server and client render the same statuses, with no loading state.

## Code changes

- `checklists/storage.ts`: `StoredRecord` becomes `StorageAdapter<T>`, and
  `createLocalStorageRecord` becomes `localStorageAdapter`, which only reads,
  writes and subscribes. `parse` and `isStored` move into core next to
  `createProgress`.
- `checklists/types.ts`: the `Persistence` union becomes `storage`, `initial`
  and `onStorageError`. Its "Loaded once at creation" comment goes. Both
  snapshots gain `status`, and the owner gains `ready`.
- `checklists/checklists.ts`: handle a promise from `load` at line 98, guard
  `storage?.save` at line 140 while loading, hold commands while loading, keep
  the last context, restore the walkthrough record, and subscribe.
- `run/run.ts` and `run/state.ts`: `createRun` takes `storage` and
  `onStorageError`, and can start collapsed or already ended. `enter()`
  hard-codes `collapsed: false`.
- React: `<Walkthrough>` takes `storage` and passes it to `createRun`. The
  `useSyncExternalStore` calls get a server snapshot that shows loading.
- e2e: `e2e/fixtures/react/guidance.tsx:114` and `e2e/fixtures/checklist.ts:132`
  call `load()` directly and assume it is synchronous.

A restored step skips whatever setup earlier steps did, such as opening a form,
so its Waymark may never appear. The missing Waymark handling covers this. The
step shows centred and Next unlocks.

## As built

- A standalone Run has a `loading` phase, `{ phase: "loading", stepCount }`,
  while an async load is pending. `Snapshot` is now `Running | Ended | Loading`,
  so reading `stepIndex` takes a phase check. Its actions wait like the
  owner's commands.
- A restored `completed` Run sits on the last step, and a restored `exited` Run
  on the first: the record keeps no step for an ended Run, and `reset` needs one
  for its event.
- `initial` replaces loading `storage.tasks`, rather than coming first. The
  adapter is still saved to and subscribed to.
- `onChange`, `initial` and the owner's `load()` all use `StoredTasks`.
  `load()` checks its value like a loaded one; one it cannot read is reported
  and changes nothing.
- A walkthrough record that cannot be read, or picked up, is wiped by saving
  `null`.
- `createRun` takes `collapsed` beside `startAt`.
- `localStorageAdapter()` stores nothing outside a browser. Its type parameter
  defaults to `never`, and `StorageAdapter` declares `save` and `subscribe` as
  methods, so an adapter made on its own line fits either record.
- Both snapshots call it `storageStatus`, not `status`: each task row already
  has a `status`.
- A Run picked up from storage does not send `start` again; it began on an
  earlier page. `createRun` takes `resumed` for an app that stores the Run
  itself.
- React's `<Walkthrough>` draws nothing on the server or while React hydrates,
  and draws once hydrated. A standalone Run so needs no server snapshot.
- React's `<Walkthrough>` reads `storage` once, as it mounts. A new object on
  each render would otherwise make a new Run and read storage again.
