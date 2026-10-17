# Waymark

Waymark describes and runs guided walkthroughs over a browser interface. A walkthrough says what the user should do; the Run keeps how far one user is through every walkthrough, and shows one at a time. Each step may point the user at a waymark: an element in the page marked out for them. Checklists track which tasks a user has done, and can guide them through each one with a walkthrough.

## Language

### Walkthroughs

**Walkthrough**:
An ordered definition of the guidance shown to a user. It keeps one id across releases, and can be run more than once.
_Avoid_: Tutorial, guide, tour, flow

**Step**:
One instruction in a walkthrough. A step may point at a waymark and may state an advance condition.
_Avoid_: Screen, stage

**Waymark**:
The element in the page that a step directs the user toward, marked with `data-waymark`, or found by a selector when it cannot be marked. A step without a waymark gives general guidance.
_Avoid_: Target, highlight

**Advance condition**:
What must happen before a walkthrough may leave a step: a click on the waymark, an event the waymark fires, or application state that holds. It may have to hold for a set time without a break, and a step that states one cannot be skipped past while its waymark can be found.
_Avoid_: Trigger, auto-advance

**Advance gate**:
The rule that keeps manual advancement locked until the step's advance condition has been met. Meeting the condition either advances the walkthrough or unlocks the gate, as the step says. The gate also opens while the step's waymark is lost or missing, so the user is never stuck behind a condition that cannot be met.
_Avoid_: Ready state, gate-next, allow-manual

**Dismiss**:
What a click away, Escape and being interrupted do to a walkthrough: collapse it, the default, or exit it. It does not change what an explicit collapse or exit does.
_Avoid_: Close behaviour, on-blur

### Runs

**Run**:
The machinery that runs one user's walkthroughs: how far they are through each, and which one is open. There is one Run per user.
_Avoid_: Store, controller, walkthrough instance

**Walkthrough progress**:
How far one user is through one walkthrough: its step, whether it is collapsed, and whether it is running, finished or exited. A walkthrough with no progress has not started.
_Avoid_: Run, session, state

**Open walkthrough**:
The walkthrough whose popover shows. At most one is open; starting another interrupts it, and sets it aside as its dismiss says.
_Avoid_: Active walkthrough, current walkthrough, running walkthrough

**Collapsed walkthrough**:
A running walkthrough whose popover is hidden behind a beacon, keeping its step, so the user can go back to it. A click away, Escape or being interrupted collapses it, unless its dismiss says to exit. While no walkthrough is open, every collapsed one shows its beacon.
_Avoid_: Collapsed run, unfocused run, paused

**Attached**:
A Run is attached while a renderer draws it. Only an attached Run reacts to the page, so following a Run without drawing it, as analytics does, changes nothing.
_Avoid_: Mounted, subscribed

**Action**:
One of the six things a walkthrough can be asked to do: advance, previous, collapse, resume, reset or exit. The Run may refuse one, such as advancing while the gate is locked.

**Location**:
Where the Run currently believes a step's waymark is: absent (the step has none), searching (not yet seen), waiting (searched for half a second: the step shows without it while the page catches up), found (with its position), lost (seen, then gone for 200ms), or missing (searched for three seconds, or the step's `missingAfterMs`, while attached, without being found). Once found, a waymark is never searching again. An element with an empty box, such as one hidden with `display: none`, counts as gone.
_Avoid_: Target state, sighting, reading

**UI**:
The open walkthrough's own element in the page, its dialog, which a click on does not count as clicking away. Any element can opt in with `data-waymark-ui`.
_Avoid_: View

**Snapshot**:
Everything needed to draw the Run, one walkthrough, or a checklist at one moment. A new snapshot appears only when something in it has changed.

**Run event**:
Something a walkthrough did: starting, each action it took, being interrupted, or finishing. It names its walkthrough and belongs to the step it happened on.

**Problem**:
Something that went wrong, reported to the app's handler for its type: storage that failed or held a record Waymark cannot read, a walkthrough's stored progress dropped, a waymark lost or missing, or an error thrown by the app's own code. A type with no handler gets Waymark's default, which throws the app's errors and logs storage problems.
_Avoid_: Error, since most problems are not thrown; issue

### Checklists

**Checklist definition**:
A description of a set of tasks and the checklists that list them. It holds no state; each task's status belongs to the user's Run.
_Avoid_: Checklist controller, owner, Checklists, manager, Onboarding, registry

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

**Open task**:
The task whose walkthrough is open. At most one task is open at a time, since at most one walkthrough is.
_Avoid_: Active task, guiding, current walkthrough

**Task in progress**:
A task whose walkthrough is collapsed part way, waiting behind its beacon for the user to go back to it. Several tasks can be in progress at once.
_Avoid_: Paused task, started task
