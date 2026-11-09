---- MODULE ConformanceAdvanceGate ----
EXTENDS AdvanceGate

\* One definition of the two steps, so each state graph conformance.test.ts walks stays small.
CONSTANTS FirstKind, FirstWaymark, FirstThen, FirstDelay, SecondKind

OneFirst == {[kind |-> FirstKind, waymark |-> FirstWaymark, then |-> FirstThen, delay |-> FirstDelay]}
OneSecond == {[kind |-> SecondKind, waymark |-> TRUE, then |-> "unlock", delay |-> 0]}
====
