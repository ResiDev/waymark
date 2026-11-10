---- MODULE ConformanceTasks ----
EXTENDS MCTasks

\* The two graphs conformance.test.ts walks through update(). The whole spec
\* has too many moves to walk in JavaScript, so each walks a part.

\* Tab B alone: every command, the checklist mounting, and reloads.
OneTabSpec == Init /\ [][BCommand \/ Join \/ Reload]_vars

\* Tab B hearing tab A: B's commands that move a walkthrough or a status that
\* hearing touches, every write of A's, and at most one write unheard at a time.
TwoTabSpec ==
  Init /\ [][\/ StartW1 \/ StartW2 \/ CollapseW1 \/ CollapseW2 \/ FinishW1 \/ FinishW2
             \/ MarkDoneA \/ MarkDoneB \/ MarkTodoA \/ MarkTodoB \/ ContextFlipsB
             \/ Join \/ Hear \/ AActs]_vars
OneWriteUnheard == Cardinality(unheard) <= 1
====
