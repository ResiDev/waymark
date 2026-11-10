---- MODULE MCTasks ----
EXTENDS Tasks

\* a on w1 with no condition, b on w2 with a condition.
Apart == [t \in Tasks |-> IF t = "a" THEN "w1" ELSE "w2"]
OnlyB == {"b"}

\* Thread 8: a and b share w1, and neither has a condition, so finishing w1 ticks both.
Shared == [t \in Tasks |-> "w1"]
NoTasks == {}
====
