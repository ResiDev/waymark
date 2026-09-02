# Waymark

Waymark describes and runs guided tutorials over a browser interface. A tutorial says what the user should do; a run records what is happening while one user moves through it. Each step may point the user at a waymark: an element in the page marked out for them.

## Language

**Tutorial**:
An ordered definition of the guidance shown to a user. A tutorial can be run more than once.
_Avoid_: Tour, flow

**Run**:
One live execution of a tutorial, including its current step and whether advancement is available.
_Avoid_: Store, tutorial instance

**Step**:
One instruction in a tutorial. A step may point at a waymark and may state an advance condition.
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
The tutorial's own elements in the page — the dialog and the beacon — which a click on does not count as clicking away. Any element can opt in with `data-waymark-ui`.
_Avoid_: View

**Checklist**:
An unordered set of tasks that together make up a user's onboarding. A checklist can be followed by many users. It is to a progress what a tutorial is to a run.
_Avoid_: Journey, onboarding flow, tour

**Task**:
One thing the user should accomplish. A task has a stable id, may carry a tutorial that shows how, may state a completion condition, and may name tasks that must be done first.
_Avoid_: Item, milestone, goal, step

**Progress**:
One user's live record of a checklist: which tasks are done, and which one is being guided right now. Done-ness is what gets stored; guiding is not.
_Avoid_: Session, state, checklist instance

**Completion condition**:
Application state that marks a task done, whether or not its tutorial ever ran. A task that states one cannot be ticked off by finishing its tutorial alone; a task that states none is done when its tutorial finishes or the application says so.
_Avoid_: Trigger, auto-complete, detection

**Guiding**:
A task whose tutorial is currently running as a run. At most one task is guided at a time.
_Avoid_: Active task, current tutorial
