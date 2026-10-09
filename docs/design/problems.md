# Problems

Status: built. Replaces the todo "One error channel".

## Problem

Problems reached an app three ways. Storage failures went to `onStorageError`,
on a walkthrough's definition or on a checklist controller. A waymark that was
lost or missing was a run event, beside `start` and `finish`. An error from the
app's own code, such as a subscriber or a step's `state` check, was thrown once
the other callbacks had run. A stored walkthrough dropped as too old, because
its steps changed or because its task was no longer todo went unreported.

## Handlers by type

`problemHandlers` holds a handler for each type of problem the app wants to
hear, and each handler gets the problem of its type from this union:

```ts
type WaymarkProblem<TStep> =
  | { type: "storageFailed"; record: "tasks" | "walkthrough"; error: unknown }
  | { type: "recordUnreadable"; record: "tasks" | "walkthrough"; error: Error }
  | { type: "recordDropped"; record: "walkthrough"; reason: "expired" | "stepsChanged" | "taskNotTodo" | "unknownTask" }
  | { type: "waymarkLost"; step: TStep; stepIndex: number }
  | { type: "waymarkMissing"; step: TStep; stepIndex: number }
  | { type: "callbackThrew"; callback: CallbackName; error: unknown };
```

```ts
problemHandlers: {
  storageFailed: (problem) => toast(…),
  waymarkMissing: (problem) => analytics.track(…, { step: problem.stepIndex }),
}
```

It replaces `onStorageError`. `lost` and `missing` leave `RunEvent`: a page
that does not match its walkthrough is a problem, and is reported once, in one place.

## Where it goes

- A standalone walkthrough takes it on its definition, with or without
  storage, so its Runs and its `reset` share its handlers. `maxAge` still needs
  storage.
- A controller takes it beside its other options, and hands it to the Runs it
  starts. A Task's walkthrough cannot have its own `problemHandlers`, as it
  cannot have its own storage: the controller reports its Runs' problems, and
  two sets of handlers for one Run would leave it unclear which hears what. The
  types forbid it, since `defineWalkthrough` with `problemHandlers` returns a
  walkthrough a Task does not take, and `createChecklists` throws for an app
  without them.

## Who decides

Each type decides on its own. A problem goes to the handler for its type, and
a type without one gets the default. So an app that handles `waymarkMissing`
for analytics still has its own errors thrown.

The first version took one function for every problem, `onProblem`, and
passing it switched every default off. An app that handled three types in a
`switch` stopped seeing its unreadable records logged, and one that left out
`callbackThrew` dropped its own errors without knowing. Once it held a handler
per type it became `problemHandlers`: an option named `on…` is one function,
as `onEvent` and `onChange` are.

An error from the app's code goes to a `callbackThrew` handler and is not
thrown. An app that wants it thrown rethrows it. What a handler throws is
thrown, never handed back.

The defaults change nothing from plain JavaScript:

| Problem | Default |
| --- | --- |
| `callbackThrew` | thrown, as before |
| `storageFailed`, `recordUnreadable` | logged |
| `recordDropped`, `waymarkLost`, `waymarkMissing` | nothing |

Storage failures are logged rather than thrown: they come from the user's
browser, not a bug, and a save throwing would break whatever click caused it.

`everyProblem(handle)` gives one function every type, in place of all the
defaults. An app that handles every type itself can check its handlers with
`satisfies Required<ProblemHandlers>` and hear from TypeScript when a type is
added. No alias is exported for that.

A `state` check runs every frame, so a broken one would throw, or reach
`callbackThrew`, sixty times a second. Each distinct error, by name and message, goes
once per step.

## As built

- `problems.ts` holds the defaults in one table, one entry per type.
  `problemReporter` looks up the app's handler for a problem's type, or the
  default. Each controller, and each standalone walkthrough, makes one reporter
  and hands it to its queue and its Runs.
- Each handler in `ProblemHandlers` is declared as a method. As a plain
  function, a walkthrough of particular steps would no longer fit where any
  walkthrough does. Its `this` is `void`: the reporter calls each handler on
  its own, so a method that used `this` would type-check and then throw.
- Inside `createChecklists` or `defineWalkthrough`, TypeScript cannot learn
  the steps for `everyProblem`, and from a half-inferred controller it guesses
  `never`. `NoInfer` on its return type stops the guess, so its problems carry
  any Step. React's `everyProblem` defaults to React's steps instead, and
  still takes a handler typed with narrower ones.
- The queue reports what it runs with `callApp(callback, work)`; what it runs
  with `invoke(work)`, its own work and calls to a handler, is thrown once
  the drain is over, never reported.
- A condition that throws in `update` still records nothing, with a
  `callbackThrew` handler or without.
