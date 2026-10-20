// Sketch for packages/core/src/run/run.ts, about 270 lines.
//
// Owns: RunShell. The four values, the commands held while the record loads,
// the Run's listeners and the checklist handles. It is the only place that
// assigns the four values: `commit` assigns Recorded, Asked and Live once per
// change; a call assigns Given when it hands something over, and Asked when
// a request joins or leaves the waiting list. Every other module is pure, or
// owns its own handles on the outside world (page.ts, link.ts, queue.ts).
//
// ─── commit(phases), the change pipeline ───────────────────────────────────
//
// Today's eleven steps (grounding.md), in the same order, with what each
// becomes:
//
//  1. `before` is the four values as they are; `now` is `Date.now()`. Today's
//     accumulators are not reset: change.ts makes a sink per change.
//  2-5. `runChange(before, phases, now, verdicts)`: the works, `finish` after
//     each (today's steps 4 and 5), `settle` once (step 3). Then Recorded,
//     Asked and Live are assigned, and a Waymark a rule asked for is scrolled
//     to. For a still frame, which moved nothing and told nothing, steps 6
//     and 8 to 11 are skipped: every view would hand back the same object,
//     and there is nothing to save or say.
//  6. Every view evaluated, the Run's and each checklist's, before any
//     callback runs, so a callback that reads another snapshot sees this
//     change too.
//  7. `page.afterChange(after)`: hookups opened or closed, and the first look
//     queued when due. Always, even for a still frame.
//  8. The Run's listeners if its snapshot is a new object, then each
//     checklist's whose snapshot is.
//  9. The save, from where change.ts says, then `onChange`.
// 10. Problems, `recordUnreadable` first when storage turned unreadable,
//     after notify so a handler sees a renderer that has redrawn.
// 11. `onEvent`: run events, then checklist events, then `checklistComplete`
//     for each checklist that was not complete at the baseline and is now.
//
// Steps 8 to 11 go through the queue, as today, so work a callback queues runs
// after them. `commit` runs inside `queue.run`, except the first look's.
//
// ─── What each call does ───────────────────────────────────────────────────
//
// While storage is `loading`, a command's work is held, in order; the change
// that takes the record in runs them all. Otherwise it is committed at once.
//
// - `start(w)`: `take(w)` into Given; `{ commands: [start(w)] }`.
// - `requestStart(w)`: `take(w)`; `wait` at the call, loading or not;
//   `{ commands: [request(w)] }`. Its withdraw calls `unwait`, at the call.
// - `act(action, w?)`: `take(w)` if given; with no `w` and not loading, the
//   open one at the call, and nothing when none is, as today; while loading,
//   the work finds the open one when it runs.
// - `reset(w)`: `take(w)`; `{ commands: [reset(w)] }`.
// - `skipTask(id)`: `{ commands: [skip(id, undefined)] }`.
// - `setContext(c)`: assigns Given's context; `{ commands: [conditions] }`
//   unless loading, when the load's arrival asks the conditions.
// - `checklist(definition)`: a handle made once per definition. Its group
//   joins Given, with its walkthroughs taken, the first time one of its
//   checklists is used; then `{ arrival: true }` unless loading. Its commands
//   join first and are held while loading, as `start` is.
// - `attach`, `connect`: page.ts and link.ts.
// - storage's answer: `{ storage: loaded(read), arrival: true, commands: held }`.
// - a record heard: `{ storage: heard(...) }`, then `{ arrival: true }`, two
//   changes as today.
// - a save refused as unreadable: `{ storage: refused(error) }`.
// - `replace` from `recordUnreadable`:
//   `{ storage: replaced(record), arrival: true, whole: true }`.
//
// The server snapshots are worked out from the facts as the Run was made,
// after an `initial` record is taken in, so an unreadable `initial` shows
// `unreadable` on the server too.

import type { Walkthrough } from "../../../../packages/core/src/walkthrough/types";
import type { Run, RunOptions } from "../../../../packages/core/src/run/types";

export function createRun<TWalkthrough extends Walkthrough = Walkthrough>(
  options?: RunOptions<TWalkthrough>,
): Run<TWalkthrough>;
export function createRun(options: RunOptions = {}): Run {
  throw new Error("not implemented");
}
