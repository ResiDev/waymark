---- MODULE ConformanceLifecycle ----
EXTENDS Lifecycle

\* Two walkthroughs at a time, so each state graph conformance.test.ts walks stays small.
\* First has FirstSteps steps here and FirstElse in another tab's release; Second has one step.
CONSTANTS First, Second, FirstSteps, FirstElse, SecondHint

CW == {First, Second}
COrder == <<First, Second>>
CSteps == [w \in CW |-> IF w = First THEN FirstSteps ELSE 1]
CElseSteps == [w \in CW |-> IF w = First THEN FirstElse ELSE 1]
CHint == [w \in CW |-> w = Second /\ SecondHint]
====
