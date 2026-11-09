---- MODULE MCAdvanceGate ----
EXTENDS AdvanceGate

\* Every definition of a step, once: a step without a condition has no then or delay.
EveryStep == {c \in StepConfigs : c.kind = "none" => (c.then = "advance" /\ c.delay = 0)}

\* A click or an event with no waymark to click or fire it could never be met.
\* checkedWalkthrough in packages/core/src/walkthrough/walkthrough.ts rejects these steps.
Unmeetable(c) == c.kind \in {"click", "event"} /\ ~c.waymark

MeetableSteps == {c \in EveryStep : ~Unmeetable(c)}

\* A second step whose gate shows: a stale message that met it would unlock Next.
GatedSecond == {[kind |-> k, waymark |-> TRUE, then |-> "unlock", delay |-> 0] : k \in {"click", "event"}}
====
