# Problems

Status: built. Replaces the todo "One error channel".

## Problem

Problems reached an app three ways. Storage failures went to `onStorageError`,
on a walkthrough's definition or on an owner. A waymark that was lost or
missing was a run event, beside `start` and `finish`. An error from the app's
own code, such as a subscriber or a step's `state` check, was thrown once the
other callbacks had run. A stored walkthrough dropped as too old, because its
steps changed or because its task was no longer todo went unreported.

## One handler

`onProblem` takes a typed union:

```ts
type WaymarkProblem<TStep> =
  | { type: "storageFailed"; record: "tasks" | "walkthrough"; error: unknown }
  | { type: "recordUnreadable"; record: "tasks" | "walkthrough"; error: Error }
  | { type: "recordDropped"; record: "walkthrough"; reason: "expired" | "stepsChanged" | "taskNotTodo" | "unknownTask" }
  | { type: "waymarkLost"; step: TStep; stepIndex: number }
  | { type: "waymarkMissing"; step: TStep; stepIndex: number }
  | { type: "callbackThrew"; callback: CallbackName; error: unknown };
```

It replaces `onStorageError`. `lost` and `missing` leave `RunEvent`: a page
that does not match its walkthrough is a problem, and is reported once, in one place.

## Where it goes

- A standalone walkthrough takes it on its definition, with or without
  storage, so its Runs and its `reset` share one handler. `maxAge` still needs
  storage.
- An owner takes it beside its other options, and hands it to the Runs it
  starts. A Task's walkthrough cannot have its own `onProblem`, as it cannot
  have its own storage: the owner reports its Runs' problems, and two handlers
  for one Run would leave it unclear which hears what. The types forbid it,
  since `defineWalkthrough` with `onProblem` returns a walkthrough a Task does
  not take, and `createChecklists` throws for an app without them.

## Who decides

Passing `onProblem` means the app handles every problem. An error from its own
code goes to the handler and is not thrown; an app that wants it thrown
rethrows it. What the handler throws is thrown, never handed back.

Without a handler nothing changes from plain JavaScript:

| Problem | No handler |
| --- | --- |
| `callbackThrew` | thrown, as before |
| `storageFailed`, `recordUnreadable` | logged |
| `recordDropped`, `waymarkLost`, `waymarkMissing` | nothing |

Storage failures are logged rather than thrown even then: they come from the
user's browser, not a bug, and a save throwing would break whatever click
caused it.

A `state` check runs every frame, so a broken one would throw, or reach the
handler, sixty times a second. Each distinct error, by name and message, goes
once per step.

## As built

- `problemReporter` in `problems.ts` holds the defaults, including throwing
  `callbackThrew`. Each owner, and each standalone walkthrough, makes one
  reporter and hands it to its queue and its Runs.
- The queue reports what it runs with `callApp(callback, work)`; what it runs
  with `invoke(work)`, its own work and calls to the handler, is thrown once
  the drain is over, never reported.
- A condition that throws in `update` still records nothing, with a handler or
  without.
