# Events and problems

## Events and analytics

`onEvent` on `<WaymarkRoot>` hears every walkthrough's and every checklist's events, in order:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon, defaultPopover } from "react-waymark";

declare const analytics: { track: (name: string, properties: object) => void };

export function Guidance({ children }: { children: ReactNode }) {
  return (
    <WaymarkRoot
      renderPopover={defaultPopover}
      renderBeacon={defaultBeacon}
      onEvent={(event) => {
        if ("walkthrough" in event) {
          analytics.track(`Walkthrough ${event.type}`, { walkthrough: event.walkthrough, step: event.stepIndex + 1 });
        } else {
          analytics.track(event.type, event.type === "checklistComplete" ? { checklist: event.checklist } : { task: event.task.id });
        }
      }}
    >
      {children}
    </WaymarkRoot>
  );
}
```

A walkthrough event's `walkthrough` is its id, and its `type` is one of:

- `start`: shown for the first time, or again after the user finished or exited it.
- `advance` and `previous`: moved a step. Completing the last step fires `advance` and then `finish`.
- `finish`: the last step is done.
- `collapse` and `resume`: put aside as a beacon, and brought back.
- `exit`: exited, whichever way: the × button, a custom beacon's `exit`, `run.act("exit")`, skipping its task, or clicking away or Escape with `dismiss: "exit"`.
- `interrupt`: put aside or exited because another walkthrough started, in place of `collapse` or `exit`. `interruptedBy` names the other one.
- `reset`: an open walkthrough went back to step 1. Resetting one that isn't open fires no walkthrough event.

Each carries the `step` and `stepIndex` it happened on, and a `snapshot` of the walkthrough after it. Moving from step 1 to step 2 fires `advance` with `stepIndex` `0` and `snapshot.stepIndex` `1`.

A checklist event has the `task`, and its `type` is one of:

- `taskStarted`: its walkthrough started from step 1.
- `taskComplete`: it was ticked, by the user, its condition or its walkthrough finishing.
- `taskReopened`: a done task went back to todo. `taskUnskipped`: a skipped one did.
- `taskSkipped`: the user skipped it.
- `taskStopped`: its walkthrough ended, with a `reason` of `"finished"`, `"skipped"` or `"stopped"` (exited, or reset while put aside).
- `checklistComplete`: every task in a checklist became done or skipped, by a change that was announced (see below). Has the `checklist` name and its `snapshot`, and no `task`.

Some ticks aren't announced. A condition that already holds when the user's record loads, or when its checklist is first used, ticks its task silently: no `taskComplete`, and no `checklistComplete` if that completes the list. Statuses already in the record aren't announced either. `onChange` hears every status change, silent ones included, as the whole record: to count completions from it, compare each record's `tasks` with the last one you saw.

The fields of each are in the [reference](api.md#event-fields).

## Handle problems

Waymark reports what goes wrong to `problemHandlers` on `<WaymarkRoot>`. Give a function for each type of problem you want to handle, and the rest keep Waymark's default:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon, defaultPopover } from "react-waymark";

declare const toast: (message: string) => void;
declare const analytics: { track: (name: string, properties: object) => void };
declare const Sentry: { captureException: (error: unknown) => void };

export function Guidance({ children }: { children: ReactNode }) {
  return (
    <WaymarkRoot
      renderPopover={defaultPopover}
      renderBeacon={defaultBeacon}
      problemHandlers={{
        storageFailed: () => toast("Your progress won't be saved on this device"),
        waymarkMissing: (problem) =>
          analytics.track("Walkthrough waymark missing", { walkthrough: problem.walkthrough, step: problem.stepIndex + 1 }),
        callbackThrew: (problem) => Sentry.captureException(problem.error),
      }}
    >
      {children}
    </WaymarkRoot>
  );
}
```

Each handler hears only its own type, so it reads that problem's fields without checking `type` first:

- `waymarkMissing`: a step's waymark wasn't found within `missingAfterMs`. Reported once per step. Has `walkthrough` (its id), `step` and `stepIndex`. Default: nothing.
- `waymarkLost`: a step's waymark was found, then left the page. Same fields. Default: nothing.
- `storageFailed`: your storage threw or rejected. Has `error`. Default: logged with `console.error`, so a failed save never breaks the click that caused it.
- `recordUnreadable`: the stored progress wasn't written by Waymark, or a newer version wrote it. The user starts fresh, and saves leave the stored record alone. Has `error`, `stored` (what was there), and `replace(record)` to write a record in its place, or `null` for none. Default: logged.
- `recordDropped`: one stored entry was dropped. Has `walkthrough` or `task` (its id), and a `reason`: `"expired"` (left part way for longer than its `maxAge`), `"stepsChanged"` (part way through a walkthrough whose number of steps has changed) or `"unreadable"`. Default: nothing.
- `callbackThrew`: one of your own functions threw. Has `error`, and `callback` naming which: `"stateCheck"`, `"isComplete"`, `"onEvent"`, `"onChange"` or `"subscriber"`. With a handler, Waymark carries on. Default: thrown.

To send every type to one function, wrap it in `everyProblem`. It replaces all the defaults, so rethrow `callbackThrew` errors if you still want them thrown:

```tsx
import { everyProblem } from "react-waymark";

declare const logger: { warn: (...values: unknown[]) => void };

export const problemHandlers = everyProblem((problem) => {
  logger.warn("waymark", problem);
  if (problem.type === "callbackThrew") throw problem.error;
});
```
