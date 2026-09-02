# Checklist design

Working document. Terms are in CONTEXT.md. **Decided** is settled; **Open** is
for back-and-forth.

## Goal

Replace one long click-through tutorial with a checklist of tasks, each with a
short tutorial. Tasks tick off when the user is guided through them, or by
themselves when application state says the thing is done.

## Shape

```
Checklist ──defines──▶ Progress ──owns at most one──▶ Run (unchanged)
                          ▲
                          │ update(facts)  start(id)  markDone(id)  skip(id)  reset(id?)
                       the app
```

- Run is untouched. A Task's tutorial is an ordinary Tutorial.
- Progress has no loop. It is told about state via `update`.
- The app owns storage. Progress takes a Stored record in, hands it out on change.

## Types

```ts
// Facts: the plain object of values the app hands to `update`, which `done`
// predicates judge by, e.g. { projects: 3, invited: false }. TFacts is its
// type. Predicates are written before any facts exist, so it is declared:
// defineChecklist<Facts>([...]).
type Task<TFacts, TStep extends Step = Step> = Readonly<{
  id: string;                          // stable: this is what gets stored
  tutorial?: Tutorial<TStep>;          // how to do it; none = plain checkbox
  done?: (facts: TFacts) => boolean;   // completion condition
  after?: readonly string[];           // must be done first (Open 3)
}>;

type Checklist<TFacts, TTask extends Task<TFacts>> = Readonly<{ tasks: readonly TTask[] }>;
function defineChecklist<TFacts, const TTask extends Task<TFacts>>(tasks: readonly TTask[]): Checklist<TFacts, TTask>;
// checks: unique ids, `after` names real ids, no cycles

// `const` keeps the id literals, so ids are a union, not string:
type TaskId<C> = C extends Checklist<any, infer T> ? T["id"] : never;
// TaskId<typeof onboarding> = "create-project" | "invite-teammate"
// Every command takes a TaskId. Stored stays string[]: it crosses the storage
// boundary, and unknown ids are validated away there, once.

type TaskStatus = "locked" | "todo" | "active" | "done" | "skipped";

/** What the app stores. Whole record in, whole record out. */
type Stored = Readonly<{ done: readonly string[]; skipped: readonly string[] }>;

type ProgressSnapshot<TFacts, TStep> = Readonly<{
  tasks: readonly Readonly<{ task: Task<TFacts, TStep>; status: TaskStatus }>[];
  doneCount: number;
  taskCount: number;
  complete: boolean; // every Task is done or skipped
  active: Readonly<{ task: Task<TFacts, TStep>; run: Run<TStep> }> | null; // subscribe to run separately
}>;

// Named after the command or moment, as Run events are. Shallower than Run's:
// what happens inside a tutorial stays on the Run's own onEvent.
type ProgressEvent<TFacts, TStep> = Readonly<{
  type:
    | "taskStarted"        // a Run began for this Task (the Run's own `start` follows)
    | "taskStopped"        // the Run ended without the Task completing (exit, or finish with `done` unmet)
    | "taskComplete"       // this Task ticked off: by update, by finish, or by markDone
    | "taskSkipped"        // the user dismissed it without doing it
    | "taskReset"          // done or skipped was cleared
    | "checklistComplete"; // the last Task ticked off or was skipped; fires right after
  task: Task<TFacts, TStep>;
  snapshot: ProgressSnapshot<TFacts, TStep>;
}>;

type ProgressOptions<TFacts, TStep> = Readonly<{
  stored?: Stored;                          // the record as it stands now
  onChange?: (stored: Stored) => void;      // the record should become this
  onEvent?: (event: ProgressEvent<TFacts, TStep>) => void;
  run?: RunOptions<TStep>;                  // passed to every createRun
}>;

type Progress<TFacts, TStep, TId extends string> = Readonly<{
  start: (id: TId) => void;          // run the Task's tutorial; ends any active Run
  markDone: (id: TId) => void;       // the app says it is done
  skip: (id: TId) => void;           // dismiss without doing
  reset: (id?: TId) => void;         // clear one Task, or all
  update: (facts: TFacts) => void;   // re-evaluate every undone Task's `done`
  load: (stored: Stored) => void;    // the record changed elsewhere; replaces, last write wins
  next: () => Task<TFacts, TStep> | null; // first todo in definition order
  getSnapshot: () => ProgressSnapshot<TFacts, TStep>;
  subscribe: (listener: () => void) => () => void;
}>;

function createProgress<TFacts, TStep extends Step>(checklist, options?): Progress<TFacts, TStep>;
```

Tasks carry no content; adapters extend them. Core never reads facts; it only
passes them to predicates.

Commands refuse quietly, as the Run does, rather than throw:

| Command | No-op when |
|---|---|
| `start` | no tutorial, locked, already active. Allowed on done: "show me again" changes nothing. |
| `markDone`, `skip` | already done or skipped |
| `reset` | nothing to clear |

## Persistence

The record is durable and shared (other devices, the server), so unlike the
Run it is **controlled**: the app owns it, Progress derives from it.

- **Whole record in, whole record out.** `stored` at creation, `load(stored)`
  whenever it changes elsewhere; each replaces the record, last write wins.
  Every local change fires `onChange` once with the full `Stored`, after the
  snapshot is rebuilt. No deltas, so nothing can drift.
- **Local echo.** A change Progress emits shows immediately; the next `load`
  from the app always wins. So a slow server write never shows a just-completed
  Task as undone.
- **Control is optional, in the adapter.** `useProgress` with no `stored` and
  no `onChange` keeps the record in localStorage under a key from the
  checklist. Pass both and the app owns it (a query cache is two lines). Core
  has one code path; only the adapter makes it optional.
- **Conflicts are mostly unions.** Done and skipped latch, so two devices
  completing different Tasks merge. `reset` is the one subtractive command;
  there last write wins, documented rather than solved.
- **Unknown ids are kept.** A stored id no longer in the checklist (a Task
  removed in a release) is ignored, not dropped: if the Task returns, the user
  is still done.
- **Nothing else is stored.** Not the active Task, not the Run's step, not
  whether a tutorial has been shown. A reload restarts a tutorial at step one.
  "Show me again" needs no flag because re-running changes no record.

## Tasks and tutorials are many to many

Two Tasks may reference the same Tutorial, and a Task with `done` completes
from facts however the user got there. The one rule that assumed one to one
is generalised: **on `finish`, every Task whose `tutorial` is the finished one
and has no `done` becomes done.** `active` is still the Task the user clicked,
since that is what the panel highlights. Anything stranger is the app's
`onEvent` on the Run plus `markDone`.

## Lifecycle

1. **Load**: `createProgress(checklist, { done, onChange })`. Nothing live.
2. **App reports facts**: `update(facts)`. Undone Tasks whose `done` holds
   become done; `onChange` fires; `checklistComplete` if it was the last.
3. **User picks a Task**: `start(id)`. Progress creates the Run and exposes it
   as `snapshot.active`. The panel renders it as today.
4. **Run ends**: on `finish`, every Task on that tutorial with no `done`
   becomes done; one with `done` waits for `update`, so `taskStopped` fires
   for it instead. On `finish` or `exit`, `active` becomes null.
5. **Done latches.** A predicate turning false later changes nothing.

## Completion: how `done` fires

Nothing in core fires on its own. `update(facts)` is the moment predicates
are asked, and calling it is the adapter's job:

```tsx
// the app builds one object of primitives; no memo, no effect, no deps
useProgress(onboarding, { facts: { projects: projects.length, invited: team.length > 1 } });

// the hook shallow-compares values and calls update only when one changed
const last = useRef<TFacts>();
useEffect(() => {
  if (last.current && shallowEqual(last.current, facts)) return;
  last.current = facts;
  progress.update(facts);
});
```

```ts
// core
update(facts) {
  for each undone task with `done`: if done(facts) → mark, announce taskComplete
  if any changed → rebuild snapshot, onChange(stored), notify, maybe checklistComplete
}
```

Non-React: call `update` wherever the store emits. Event-shaped completions
("exported a file") use `markDone`.

**Why not poll.** The Run polls once a frame because the DOM has no events and
the loop already exists for the highlight. App state changes only when the
app changes it, so it can say so. A Progress frame loop would run for the life
of the page (~1.6 µs per frame to register) to ask every 16 ms for what it
could be told once. If a condition has no events to push from, an optional
`poll: ms` interval covers it (Open 6).

**Start triggers.** Not in core. `next()` suggests; the app calls `start`. If
wanted later: `start: (facts) => boolean` on the Task, evaluated by the same
`update`, plus a stored "seen" set so it fires once.

## Decided

- Run untouched; Progress is a layer above.
- Push via `update`; no loop in Progress.
- Done latches. A Task with `done` is not done by finishing its tutorial.
- The record is controlled: in via `stored`/`load`, out via `onChange`, whole
  each time. Optional in the adapter (localStorage default), not in core.
- Only done and skipped ids are stored. A reload restarts a tutorial at step
  one. Re-running a done tutorial is allowed and stores nothing.
- Ids are typed as a literal union via `const` in `defineChecklist`.
- Tasks and tutorials are many to many; `finish` completes every `done`-less
  Task on that tutorial.
- Start triggers stay in the app.
- Tasks carry no content.
- Adapter owns the effect; the user builds one object of primitive facts.
- Commands refuse quietly. Unknown stored ids are kept, not dropped.
- `skip` and `reset` exist, with `taskSkipped`, `taskReset`, `taskStopped` events.

## Open

1. `active` inside the snapshot (one subscription, but a live object in plain
   data) or a separate `getRun()`? Lean: in the snapshot.
2. Active Task's `done` turns true mid-Run: continue or end the Run? Lean:
   continue; the tutorial's steps decide.
3. Ship `after` / `locked` in v1? Lean: no, until a checklist needs it.
4. Debounce `update`? Lean: no, it is cheap; the app may call it freely.
5. One Progress per page? Lean: not enforced; React provides one via context.
6. Ship `poll` in v1? Needs the adapter to hold `app` in a ref. Lean: no.
7. Does `complete` count skipped Tasks as finished? Lean: yes, the checklist
   is over for this user; `doneCount` still counts only done.
8. `subscribe` passing the snapshot to listeners would satisfy Svelte's store
   contract for free. Touches Run's public type, so decide in v8.
