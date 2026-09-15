# Waymark

Waymark describes and runs guided walkthroughs over a browser interface. A walkthrough says what the user should do; a run records what is happening while one user moves through it. Each step may point the user at a waymark: an element in the page marked out for them.

## Language

**Walkthrough**:
An ordered definition of the guidance shown to a user. A walkthrough can be run more than once.
_Avoid_: Tutorial, guide, tour, flow

**Run**:
One live execution of a walkthrough, including its current step and whether advancement is available.
_Avoid_: Store, walkthrough instance

**Step**:
One instruction in a walkthrough. A step may point at a waymark and may state an advance condition.
_Avoid_: Screen, stage

**Waymark**:
The element in the page that a step directs the user toward, marked with `data-waymark`. A step without a waymark gives general guidance.
_Avoid_: Target, highlight, selector

**Location**:
Where a run currently believes a step's waymark is: absent (the step has none), searching (not yet seen), found (with its position), or lost (seen, then gone). Once found, a waymark is never searching again.
_Avoid_: Target state, sighting, reading

**Advance condition**:
A user action or application state that permits or causes a run to move to its next step. A step that states one cannot be skipped past.
_Avoid_: Trigger, auto-advance

**Advance gate**:
The rule that keeps manual advancement locked until the step's advance condition has been met. Meeting the condition either advances the run or unlocks the gate, as the step says.
_Avoid_: Ready state, gate-next, allow-manual

**Collapsed run**:
A run whose step popover is hidden and represented by a beacon while the run remains resumable.
_Avoid_: Unfocused run

**UI**:
The walkthrough's own elements in the page — the dialog and the beacon — which a click on does not count as clicking away. Any element can opt in with `data-waymark-ui`.
_Avoid_: View

**Checklists**:
A group of named checklists sharing one user's task completion and at most one active walkthrough run. Separate groups have independent completion records.
_Avoid_: Onboarding, checklist definition, registry

**Task**:
One thing the user should accomplish. A task has a stable id, may offer a description, application action, walkthrough, and completion condition, and may appear in several checklists that share its completion.
_Avoid_: Item, milestone, goal, step

**Checklist**:
A named, ordered view of tasks and their shared completion. The same task can appear in several checklists without needing to be accomplished again.
_Avoid_: Progress, session, checklist instance

**Context**:
Application information used to check whether checklist tasks are complete, even when their walkthroughs never ran. It describes the application, not the checklist's completion record.
_Avoid_: Facts, state, input

**Completion condition**:
A check of application context that determines whether a task is done, whether or not its walkthrough ever ran. A task that states one cannot be ticked off by finishing its walkthrough alone; a task that states none is done when its walkthrough finishes or the application says so.
_Avoid_: Trigger, auto-complete, detection

**Active task**:
The task whose walkthrough is currently running as a run. At most one task is active across a group of checklists at a time.
_Avoid_: Guiding, current walkthrough, open task
