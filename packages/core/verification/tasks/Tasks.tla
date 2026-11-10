------------------------------- MODULE Tasks -------------------------------
(***************************************************************************)
(* Task statuses in one tab, B, as the Run writes them, and what B saves   *)
(* and announces. Another tab, A, shares B's storage: A's writes are the   *)
(* environment, and B hears them later.                                    *)
(*                                                                         *)
(* The code this copies: packages/core/src/run/tasks.ts (commands, finish, *)
(* conditions, eventsBetween), change.ts (runChange: what is saved and     *)
(* announced), update.ts (checklistEvents, the save), record.ts (heard,    *)
(* loaded). One action is one Msg, or the two Msgs that always go together *)
(* (heard then arrived), through update() in packages/core/src/run/update.ts.*)
(*                                                                         *)
(* Cut down: each walkthrough has one step, so it is none, running (open   *)
(* in B), collapsed, finished or exited. One group of tasks a and b, with  *)
(* checklists home (a, b) and side (a). Both walkthroughs are handed to B  *)
(* from the start. The rules at the bottom are what the user decided, not  *)
(* what the code does.                                                     *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  WalkOf,     \* each task's walkthrough
  Cond        \* the tasks with a completion condition

Tasks == {"a", "b"}
Walks == {"w1", "w2"}
Lists == {"home", "side"}
ListTasks(c) == IF c = "home" THEN {"a", "b"} ELSE {"a"}
NoCond == Tasks \ Cond
TasksOf(w) == {t \in Tasks : WalkOf[t] = w}

Progs == {"none", "running", "collapsed", "finished", "exited"}
Statuses == {"absent", "done", "skipped", "reopened"}
Running == {"running", "collapsed"}   \* status "running" in the record

VARIABLES
  prog,      \* B's progress by walkthrough; "running" is open in B
  mem,       \* B's taskStatusById, as stored: "absent" is no entry
  joined,    \* B's group is mounted (in checklistDefinitions)
  verdict,   \* what each task's isComplete answers now
  sprog,     \* stored progress; "running" is open in some tab
  stasks,    \* stored statuses
  unheard,   \* the walkthroughs and tasks A wrote since B last heard
  said,      \* the checklist events B's last change announced
  owed,      \* history: the task's walkthrough finished, and nobody ticked or handled the task since
  blocked    \* history: taken back from done by hand, and its condition has held ever since

vars == <<prog, mem, joined, verdict, sprog, stasks, unheard, said, owed, blocked>>

\* checklists/record.ts statusIn
S(x) == IF x \in {"done", "skipped"} THEN x ELSE "todo"

\* tasks.ts isComplete
Complete(c, m) == \A t \in ListTasks(c) : S(m[t]) # "todo"

\* tasks.ts finish: a task with no condition, of a group mounted, is done once
\* its walkthrough goes from running to finished inside one piece of work, and
\* is no longer reopened once its walkthrough starts again.
Ticked(j, pb, pa, m) == [t \in Tasks |->
  IF ~j \/ t \notin NoCond THEN m[t]
  ELSE IF pb[WalkOf[t]] \in Running /\ pa[WalkOf[t]] = "finished" THEN "done"
  ELSE IF pb[WalkOf[t]] \notin Running /\ pa[WalkOf[t]] \in Running /\ m[t] = "reopened" THEN "absent"
  ELSE m[t]]

\* tasks.ts tickFinished: a task with no condition and no status, whose walkthrough is finished.
TickFinished(j, p, m) == [t \in Tasks |->
  IF j /\ t \in NoCond /\ m[t] = "absent" /\ p[WalkOf[t]] = "finished" THEN "done" ELSE m[t]]

\* tasks.ts conditions
Checked(j, m, v) == [t \in Tasks |->
  IF ~j \/ t \notin Cond \/ m[t] = "done" THEN m[t]
  ELSE IF m[t] # "reopened" THEN (IF v[t] THEN "done" ELSE m[t])
  ELSE IF v[t] THEN m[t] ELSE "absent"]

\* tasks.ts statusEvent
Event(t, was, now) ==
  IF now = "done" THEN <<"taskComplete", t>>
  ELSE IF now = "skipped" THEN <<"taskSkipped", t>>
  ELSE IF was = "done" THEN <<"taskReopened", t>>
  ELSE <<"taskUnskipped", t>>

\* update.ts checklistEvents, for a change with commands: from the state before it.
Announced(j, m0, m1) ==
  IF ~j THEN {}
  ELSE {Event(t, S(m0[t]), S(m1[t])) : t \in {u \in Tasks : S(m0[u]) # S(m1[u])}}
       \cup {<<"checklistComplete", c>> : c \in {d \in Lists : ~Complete(d, m0) /\ Complete(d, m1)}}

\* update.ts saved, through a savePartial adapter: each entry that moved between the two.
Saved(old, m0, m1) == [k \in DOMAIN old |-> IF m1[k] # m0[k] THEN m1[k] ELSE old[k]]

\* The history, carried through a step.
Credit(o, m) == [t \in Tasks |-> o[t] /\ m[t] # "done"]
Unblock(b, m) == [t \in Tasks |-> b[t] /\ m[t] \notin {"done", "skipped"}]
\* What B does itself unblocks nothing A wrote that B has not heard.
UnblockHere(b, m) == [t \in Tasks |-> b[t] /\ (m[t] \notin {"done", "skipped"} \/ t \in unheard)]
Clear(o, ts) == [t \in Tasks |-> o[t] /\ t \notin ts]
\* A finish stops being owed once B's memory no longer shows the walkthrough finished.
Left(o, p0, p1) == Clear(o, {t \in Tasks : p0[WalkOf[t]] = "finished" /\ p1[WalkOf[t]] # "finished"})
\* A finish owes a tick to each of its tasks with no status. Not to one the user
\* took back: reopened stays so when its walkthrough restarted with no checklist of it in use.
Owe(o, w, m) == [t \in Tasks |-> IF t \in TasksOf(w) \cap NoCond THEN m[t] = "absent" ELSE o[t]]
\* B's statuses, with what A wrote that B has not heard yet: what is true, not what B knows.
Latest(m) == [t \in Tasks |-> IF t \in unheard THEN stasks[t] ELSE m[t]]

----------------------------------------------------------------------------
\* Tab B: one command, as change.ts runChange runs it, saved and announced from the state before.

Command(p1, m1, v1, o1, b1) ==
  /\ prog' = p1 /\ mem' = m1 /\ verdict' = v1
  /\ sprog' = Saved(sprog, prog, p1) /\ stasks' = Saved(stasks, mem, m1)
  /\ said' = Announced(joined, mem, m1)
  /\ owed' = Credit(o1, m1) /\ blocked' = UnblockHere(b1, m1)
  /\ UNCHANGED <<joined, unheard>>

\* walkthroughs.ts begin: the one open collapses (the default dismiss), and w opens.
Opened(w) == [v \in Walks |-> IF v = w THEN "running" ELSE IF prog[v] = "running" THEN "collapsed" ELSE prog[v]]

Start(w) == prog[w] # "running" /\ Command(Opened(w), Ticked(joined, prog, Opened(w), mem), verdict, Left(owed, prog, Opened(w)), blocked)

Resume(w) == prog[w] = "collapsed" /\ Command(Opened(w), mem, verdict, owed, blocked)

Collapse(w) == prog[w] = "running" /\ Command([prog EXCEPT ![w] = "collapsed"], mem, verdict, owed, blocked)

Finish(w) ==
  /\ prog[w] = "running"
  /\ LET p1 == [prog EXCEPT ![w] = "finished"]
         m1 == Ticked(joined, prog, p1, mem)
     IN Command(p1, m1, verdict, Owe(owed, w, Latest(m1)), blocked)

Exit(w) == prog[w] \in Running /\ Command([prog EXCEPT ![w] = "exited"], mem, verdict, owed, blocked)

\* An open one-step walkthrough reset stays where it is, so only a closed one is reset.
Reset(w) == prog[w] \in {"collapsed", "finished", "exited"} /\ Command([prog EXCEPT ![w] = "none"], mem, verdict, Left(owed, prog, [prog EXCEPT ![w] = "none"]), blocked)

\* tasks.ts reopen: back to todo as reopened, except a skipped task with a condition, which has no status again.
Reopen(t) == IF S(mem[t]) = "todo" THEN mem[t] ELSE IF mem[t] = "skipped" /\ t \in Cond THEN "absent" ELSE "reopened"
TakenBack(t) == [blocked EXCEPT ![t] = IF mem[t] = "done" /\ t \in Cond THEN verdict[t] ELSE @]

MarkDone(t) == joined /\ Command(prog, [mem EXCEPT ![t] = "done"], verdict, owed, blocked)

\* An untick or a skip asks the conditions after it.
MarkTodo(t) ==
  /\ joined
  /\ Command(prog, Checked(TRUE, [mem EXCEPT ![t] = Reopen(t)], verdict), verdict, IF S(mem[t]) = "todo" THEN owed ELSE Clear(owed, {t}), TakenBack(t))

Toggle(t) ==
  /\ joined
  /\ IF S(mem[t]) = "todo" THEN Command(prog, [mem EXCEPT ![t] = "done"], verdict, owed, blocked)
     ELSE Command(prog, Checked(TRUE, [mem EXCEPT ![t] = Reopen(t)], verdict), verdict, Clear(owed, {t}), TakenBack(t))

\* tasks.ts skip: only from todo, and exits the task's walkthrough if it is running.
Skip(t) ==
  /\ joined
  /\ IF S(mem[t]) # "todo" THEN Command(prog, mem, verdict, owed, blocked)
     ELSE LET w == WalkOf[t]
              p1 == IF prog[w] \in Running THEN [prog EXCEPT ![w] = "exited"] ELSE prog
          IN Command(p1, Checked(TRUE, [mem EXCEPT ![t] = "skipped"], verdict), verdict, Clear(owed, {t}), blocked)

\* setContext, which asks the conditions as a command.
ContextFlips(t) ==
  /\ t \in Cond
  /\ LET v1 == [verdict EXCEPT ![t] = ~@]
     \* The condition false ends a take-back only where it is asked: in B with a
     \* checklist of it in use, for a take-back B has heard of.
     IN Command(prog, Checked(joined, mem, v1), v1, owed, IF v1[t] THEN blocked ELSE [blocked EXCEPT ![t] = @ /\ (t \in unheard \/ ~joined)])

\* The checklist mounts: run.ts join sends arrived, which asks the conditions
\* silently, then ticks each task whose walkthrough finished before, and announces that.
Join ==
  /\ ~joined
  /\ LET m0 == Checked(TRUE, mem, verdict)
         m1 == TickFinished(TRUE, prog, m0)
     IN /\ joined' = TRUE /\ mem' = m1 /\ stasks' = Saved(stasks, mem, m1)
        /\ said' = Announced(TRUE, m0, m1)
        /\ owed' = Credit(owed, m1) /\ blocked' = UnblockHere(blocked, m1)
  /\ UNCHANGED <<prog, verdict, sprog, unheard>>

\* B hears what A saved: heard, whose finish and tickFinished run in the storage
\* phase, then arrived. Both silent. record.ts heard keeps the one open here,
\* sets aside one running elsewhere, and takes the stored statuses whole.
Hear ==
  /\ unheard # {}
  /\ LET p1 == [w \in Walks |-> IF prog[w] = "running" THEN "running" ELSE IF sprog[w] = "running" THEN "collapsed" ELSE sprog[w]]
         m1 == TickFinished(joined, p1, Ticked(joined, prog, p1, stasks))
         m2 == Checked(joined, m1, verdict)
     IN /\ prog' = p1 /\ mem' = m2
        \* The save runs from what heard took (savedFrom is heard's record, before
        \* finish), so what finish ticks on hearing is saved, and what arrived moves.
        /\ stasks' = Saved(stasks, stasks, m2)
        /\ owed' = Credit(Left(owed, prog, p1), m2) /\ blocked' = Unblock(blocked, m2)
  /\ unheard' = {} /\ said' = {}
  /\ UNCHANGED <<joined, verdict, sprog>>

\* B reloads: a new Run loads what is stored, with no checklist mounted yet.
\* verifyAll opens the first walkthrough stored as open, and sets aside a second.
Reload ==
  /\ LET p1 == [w \in Walks |-> IF w = "w2" /\ sprog["w1"] = "running" /\ sprog["w2"] = "running" THEN "collapsed" ELSE sprog[w]]
     IN /\ prog' = p1 /\ sprog' = p1
        /\ owed' = Credit(Left(owed, prog, p1), stasks)
  /\ mem' = stasks /\ joined' = FALSE /\ unheard' = {} /\ said' = {}
  /\ blocked' = Unblock(blocked, stasks)
  /\ UNCHANGED <<verdict, stasks>>

----------------------------------------------------------------------------
\* Tab A writes the shared storage. B does not know until it hears.

AWrites(sp, st, o, b) ==
  /\ sprog' = sp /\ stasks' = st /\ owed' = o /\ blocked' = b
  /\ unheard' = unheard \cup {w \in Walks : sp[w] # sprog[w]} \cup {t \in Tasks : st[t] # stasks[t]}
  /\ said' = {}
  /\ UNCHANGED <<prog, mem, joined, verdict>>

AStarts(w) ==
  /\ sprog[w] \in {"none", "finished", "exited"}
  /\ AWrites([sprog EXCEPT ![w] = "running"], stasks, owed, blocked)

\* A finishes w: with no checklist mounted, so it ticks nothing, or with one, so it ticks w's tasks with no condition.
AFinishes(w, ticks) ==
  /\ sprog[w] \in Running
  /\ LET st == [t \in Tasks |-> IF ticks /\ t \in TasksOf(w) \cap NoCond THEN "done" ELSE stasks[t]]
     IN AWrites([sprog EXCEPT ![w] = "finished"], st, Owe(owed, w, st), blocked)

\* blocked stays: it is about B's memory, which still shows the task taken back until B hears.
ATicks(t) == stasks[t] # "done" /\ AWrites(sprog, [stasks EXCEPT ![t] = "done"], Clear(owed, {t}), blocked)

\* A asks the conditions after it, as B does: taken back while its condition is false, it has no status.
AUnticks(t) ==
  /\ stasks[t] = "done"
  /\ AWrites(sprog, [stasks EXCEPT ![t] = IF t \in Cond /\ ~verdict[t] THEN "absent" ELSE "reopened"], Clear(owed, {t}),
             [blocked EXCEPT ![t] = t \in Cond /\ verdict[t]])

----------------------------------------------------------------------------
\* One name per action and argument, so conformance.test.ts knows which it is.
\* "TRUE /\" keeps TLC from naming the step after the operator inside.

StartW1 == TRUE /\ Start("w1")
StartW2 == TRUE /\ Start("w2")
ResumeW1 == TRUE /\ Resume("w1")
ResumeW2 == TRUE /\ Resume("w2")
CollapseW1 == TRUE /\ Collapse("w1")
CollapseW2 == TRUE /\ Collapse("w2")
FinishW1 == TRUE /\ Finish("w1")
FinishW2 == TRUE /\ Finish("w2")
ExitW1 == TRUE /\ Exit("w1")
ExitW2 == TRUE /\ Exit("w2")
ResetW1 == TRUE /\ Reset("w1")
ResetW2 == TRUE /\ Reset("w2")
MarkDoneA == TRUE /\ MarkDone("a")
MarkDoneB == TRUE /\ MarkDone("b")
MarkTodoA == TRUE /\ MarkTodo("a")
MarkTodoB == TRUE /\ MarkTodo("b")
ToggleA == TRUE /\ Toggle("a")
ToggleB == TRUE /\ Toggle("b")
SkipA == TRUE /\ Skip("a")
SkipB == TRUE /\ Skip("b")
ContextFlipsA == TRUE /\ ContextFlips("a")
ContextFlipsB == TRUE /\ ContextFlips("b")
AStartsW1 == TRUE /\ AStarts("w1")
AStartsW2 == TRUE /\ AStarts("w2")
AFinishesW1 == TRUE /\ AFinishes("w1", FALSE)
AFinishesW2 == TRUE /\ AFinishes("w2", FALSE)
AFinishesTickingW1 == TRUE /\ AFinishes("w1", TRUE)
AFinishesTickingW2 == TRUE /\ AFinishes("w2", TRUE)
ATicksA == TRUE /\ ATicks("a")
ATicksB == TRUE /\ ATicks("b")
AUnticksA == TRUE /\ AUnticks("a")
AUnticksB == TRUE /\ AUnticks("b")

BCommand ==
  \/ StartW1 \/ StartW2 \/ ResumeW1 \/ ResumeW2 \/ CollapseW1 \/ CollapseW2
  \/ FinishW1 \/ FinishW2 \/ ExitW1 \/ ExitW2 \/ ResetW1 \/ ResetW2
  \/ MarkDoneA \/ MarkDoneB \/ MarkTodoA \/ MarkTodoB \/ ToggleA \/ ToggleB
  \/ SkipA \/ SkipB \/ ContextFlipsA \/ ContextFlipsB

AActs ==
  \/ AStartsW1 \/ AStartsW2 \/ AFinishesW1 \/ AFinishesW2 \/ AFinishesTickingW1 \/ AFinishesTickingW2
  \/ ATicksA \/ ATicksB \/ AUnticksA \/ AUnticksB

Init ==
  /\ prog = [w \in Walks |-> "none"]
  /\ mem = [t \in Tasks |-> "absent"]
  /\ joined = FALSE
  /\ verdict \in {v \in [Tasks -> BOOLEAN] : \A t \in NoCond : ~v[t]}
  /\ sprog = prog /\ stasks = mem
  /\ unheard = {} /\ said = {}
  /\ owed = [t \in Tasks |-> FALSE] /\ blocked = [t \in Tasks |-> FALSE]

Next == BCommand \/ Join \/ Hear \/ Reload \/ AActs

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* The rules: thread 2 of .threads/what-else-to-model-in-tla.json, as the user
\* decided them in threads 7, 8 and 9.

TypeOK ==
  /\ prog \in [Walks -> Progs] /\ sprog \in [Walks -> Progs]
  /\ mem \in [Tasks -> Statuses] /\ stasks \in [Tasks -> Statuses]
  /\ joined \in BOOLEAN /\ verdict \in [Tasks -> BOOLEAN]
  /\ unheard \subseteq Walks \cup Tasks
  /\ owed \in [Tasks -> BOOLEAN] /\ blocked \in [Tasks -> BOOLEAN]

\* At most one walkthrough is open, so every open row has the same walkthrough (thread 8).
AtMostOneOpen == Cardinality({w \in Walks : prog[w] = "running"}) <= 1
OpenRows == IF joined THEN {t \in Tasks : prog[WalkOf[t]] = "running"} ELSE {}
OpenRowsShareWalkthrough == \A t1, t2 \in OpenRows : WalkOf[t1] = WalkOf[t2]

\* Every status in B's memory is saved, except where A wrote since and B has not heard.
SavedMatchesMemory == \A t \in Tasks \ unheard : stasks[t] = mem[t]

\* A task with no condition is done once its walkthrough finishes, also when a
\* checklist listing it mounts only later (thread 7), and also when another
\* tab finished it: no mounted checklist shows it todo with its walkthrough finished.
DoneOnFinish == joined => \A t \in NoCond : ~(owed[t] /\ prog[WalkOf[t]] = "finished" /\ WalkOf[t] \notin unheard)

\* GLOSSARY.md "Reopened task": stays todo only until its condition has been
\* false. So a task whose condition holds is todo only while it was taken
\* back by hand and the condition has held ever since.
\* Not for a task A wrote that B has not heard yet: B's memory of it is stale.
ConditionTicks == joined => \A t \in Cond \ unheard : (verdict[t] /\ S(mem[t]) = "todo") => blocked[t]

\* GLOSSARY.md "Skipped task": becomes done if its condition later holds.
\* As safety: no skipped task's condition holds once the Run knows it.
SkippedBecomesDone == joined => \A t \in Cond : verdict[t] => mem[t] # "skipped"

\* GLOSSARY.md "Completion condition": finishing its walkthrough alone never
\* makes a task with a condition done.
ConditionNotMetByWalkthrough ==
  [][\A t \in Cond : (mem[t] # "done" /\ mem'[t] = "done") => (verdict'[t] \/ MarkDone(t) \/ Toggle(t) \/ Hear \/ Reload)]_vars

\* Done turns into something else only by untick or toggle here, or by
\* hearing or loading what A wrote to that task.
DoneLeavesOnlyByHand ==
  [][\A t \in Tasks : (mem[t] = "done" /\ mem'[t] # "done") => (MarkTodo(t) \/ Toggle(t) \/ ((Hear \/ Reload) /\ t \in unheard))]_vars

\* checklists/types.ts skip: "Only from todo. Exits the Task's walkthrough if it is running."
SkipOnlyFromTodo == [][\A t \in Tasks : (mem[t] # "skipped" /\ mem'[t] = "skipped") => (S(mem[t]) = "todo" \/ Hear \/ Reload)]_vars
SkipStopsWalkthrough ==
  [][\A t \in Tasks : (mem[t] # "skipped" /\ mem'[t] = "skipped" /\ ~(Hear \/ Reload)) => prog'[WalkOf[t]] \notin Running]_vars

\* Thread 9: checklistComplete goes out exactly once for each command that
\* takes a checklist from not complete to complete. Hearing and loading say nothing.
CompleteAnnouncedOnEachMove ==
  [][BCommand => \A c \in Lists : (<<"checklistComplete", c>> \in said') <=> (~Complete(c, mem) /\ Complete(c, mem'))]_vars
HearingIsSilent == [][(Hear \/ Reload) => said' = {}]_vars

\* Thread 7: a mount announces taskComplete for each task with no condition it
\* ticks, since its walkthrough finished, and for no task it ticks by its condition.
\* TodoLeavesOnlyByCause says why each such tick is owed.
MountAnnouncesOwedTicks ==
  [][Join => \A t \in Tasks : (<<"taskComplete", t>> \in said') <=> (t \in NoCond /\ mem[t] # "done" /\ mem'[t] = "done")]_vars

\* A task with no condition turns from todo to done only by a tick here, its
\* walkthrough finishing here, a finish nobody credited yet, or A ticking it.
\* Or a mount in B before B heard what A did to the task: B ticks from what it
\* knows, a finish of its own, and saves that over A's untick.
TodoLeavesOnlyByCause ==
  [][\A t \in NoCond : (S(mem[t]) = "todo" /\ mem'[t] = "done") =>
       (MarkDone(t) \/ Toggle(t) \/ (prog[WalkOf[t]] \in Running /\ prog'[WalkOf[t]] = "finished")
        \/ owed[t] \/ (t \in unheard /\ stasks[t] = "done") \/ (Join /\ t \in unheard))]_vars

=============================================================================
