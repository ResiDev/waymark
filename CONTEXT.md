# Waymark

Waymark describes and runs guided walkthroughs over a browser interface. A walkthrough says what the user should do; a run records what is happening while one user moves through it. Each step may point the user at a waymark: an element in the page marked out for them. Checklists track which tasks a user has done, and can guide them through each one with a walkthrough.

## Language

### Walkthroughs

**Walkthrough**:
An ordered definition of the guidance shown to a user. A walkthrough can be run more than once.
_Avoid_: Tutorial, guide, tour, flow

**Step**:
One instruction in a walkthrough. A step may point at a waymark and may state an advance condition.
_Avoid_: Screen, stage

**Waymark**:
The element in the page that a step directs the user toward, marked with `data-waymark`, or found by a selector when it cannot be marked. A step without a waymark gives general guidance.
_Avoid_: Target, highlight

**Advance condition**:
What must happen before a run may leave a step: a click on the waymark, an event the waymark fires, or application state that holds. It may have to hold for a set time without a break, and a step that states one cannot be skipped past while its waymark can be found.
_Avoid_: Trigger, auto-advance

**Advance gate**:
The rule that keeps manual advancement locked until the step's advance condition has been met. Meeting the condition either advances the run or unlocks the gate, as the step says. The gate also opens while the step's waymark is lost or missing, so the user is never stuck behind a condition that cannot be met.
_Avoid_: Ready state, gate-next, allow-manual

### Runs

**Run**:
One live execution of a walkthrough, including its current step and whether advancement is available.
_Avoid_: Store, walkthrough instance

**Action**:
One of the six things a run can be asked to do: advance, previous, collapse, resume, reset or exit. A run may refuse one, such as advancing while the gate is locked.

**Location**:
Where a run currently believes a step's waymark is: absent (the step has none), searching (not yet seen), waiting (searched for half a second: the step shows without it while the page catches up), found (with its position), lost (seen, then gone for 200ms), or missing (searched for three seconds, or the step's `missingAfterMs`, while mounted, without being found). Once found, a waymark is never searching again. An element with an empty box, such as one hidden with `display: none`, counts as gone.
_Avoid_: Target state, sighting, reading

**Collapsed run**:
A run whose step popover is hidden and represented by a beacon while the run remains resumable. Clicking away from a run collapses it.
_Avoid_: Unfocused run

**UI**:
The walkthrough's own elements in the page, its dialog and beacon, which a click on does not count as clicking away. Any element can opt in with `data-waymark-ui`.
_Avoid_: View

**Snapshot**:
Everything needed to draw a run or a checklist at one moment. A new snapshot appears only when something in it has changed.

**Run event**:
Something a run did or saw: starting, each action it took, its waymark becoming lost or missing, or finishing. It belongs to the step it happened on.

### Checklists

**Checklists**:
The owner of one user's named checklists. It holds each task's status, shared by every checklist, and at most one active run; separate owners keep separate records.
_Avoid_: Onboarding, checklist definition, registry, group

**Checklist**:
A named, ordered view of tasks and their statuses. It is complete when every task in it is done or skipped.
_Avoid_: Progress, session, checklist instance

**Task**:
One thing the user should accomplish. A task has a stable id, may offer a description, application action, walkthrough, and completion condition, and may appear in several checklists that share its status.
_Avoid_: Item, milestone, goal, step

**Task status**:
Whether a task is todo, done or skipped. A task has one status, the same in every checklist it appears in.
_Avoid_: Completion

**Skipped task**:
A task the user chose not to do. It counts toward finishing its checklists, and becomes done if its completion condition later holds.

**Reopened task**:
A task taken back from done to todo. If it has a completion condition, it stays todo until that condition has been false, so a condition that still holds does not tick it straight back.

**Context**:
Application information used to check whether checklist tasks are complete, even when their walkthroughs never ran. It describes the application, not the task statuses.
_Avoid_: Facts, state, input

**Completion condition**:
A check of application context that determines whether a task is done, whether or not its walkthrough ever ran. A task that states one cannot be ticked off by finishing its walkthrough alone; a task that states none is done when its walkthrough finishes or the application says so.
_Avoid_: Trigger, auto-complete, detection

**Active task**:
The task whose walkthrough is currently running as a run. At most one task is active across one owner's checklists at a time.
_Avoid_: Guiding, current walkthrough, open task
