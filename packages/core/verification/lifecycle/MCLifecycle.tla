---- MODULE MCLifecycle ----
EXTENDS Lifecycle

\* Two tours and a hint. Another tab runs a release where "tour" has a third step.
MCW == {"tour", "other", "hint"}
MCOrder == <<"tour", "other", "hint">>
MCSteps == [w \in MCW |-> IF w = "tour" THEN 2 ELSE 1]
MCElseSteps == [w \in MCW |-> IF w = "tour" THEN 3 ELSE 1]
MCHint == [w \in MCW |-> w = "hint"]
====
