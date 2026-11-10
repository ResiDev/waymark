----------------------------- MODULE Lifecycle -----------------------------
(***************************************************************************)
(* Which walkthrough is open when several start, wait for their turn,      *)
(* interrupt each other, and come back from storage.                       *)
(*                                                                         *)
(* packages/core/src/run/walkthroughs.ts holds the rules this module       *)
(* copies: verifyOne, open, interrupt, begin, start, request, act, reset   *)
(* and settle. packages/core/src/run/record.ts holds loaded and heard.     *)
(* One action is one Msg through update() in packages/core/src/run/        *)
(* update.ts, except Heard, which is the two run.ts sends: heard, then     *)
(* arrived. The app, the user and storage are the environment.             *)
(*                                                                         *)
(* Left out: the page and the advance gate (AdvanceGate.tla checks those;  *)
(* here every step has no condition, so Next always moves), events,        *)
(* beacon placement, maxAge (a stale entry stands for both reasons         *)
(* staleness gives, which verifyOne and heard drop one for), checklists,   *)
(* and act() with no walkthrough.                                          *)
(*                                                                         *)
(* A change that throws leaves the Run as it was (run.ts assigns the       *)
(* model only after update returns), so the model keeps every variable     *)
(* but `defined` and sets `threw`.                                         *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
  W,          \* the walkthrough ids
  Order,      \* W as a sequence: the order of walkthroughsById, which verifyAll follows
  Steps,      \* Steps[w]: how many steps w has in this release
  ElseSteps,  \* ElseSteps[w]: the most steps w has in the release another tab runs
  Hint,       \* Hint[w]: w has dismiss "exit"
  MaxHeld,    \* how many commands the app gives while the record loads
  Recording   \* TRUE: `input` names each move's parameters, for conformance.test.ts

Actions == {"advance", "previous", "collapse", "resume", "exit"}

\* A WalkthroughProgress, or none. fresh: its stepCount is this release's,
\* so staleness passes it. An ended entry's step and stepCount are never read here,
\* so the model keeps them at 0 and TRUE.
None == [status |-> "none", step |-> 0, collapsed |-> FALSE, fresh |-> TRUE]
Run(s, c, f) == [status |-> "running", step |-> s, collapsed |-> c, fresh |-> f]
Ended(st) == [status |-> st, step |-> 0, collapsed |-> FALSE, fresh |-> TRUE]

\* What storage can give for w: entries this release wrote, and stale ones,
\* which verifyOne drops.
LoadEntries(w) ==
  {None, Ended("finished"), Ended("exited")}
  \cup {Run(s, c, TRUE) : s \in 0..Steps[w] - 1, c \in BOOLEAN}
  \cup {Run(0, c, FALSE) : c \in BOOLEAN}

\* What another tab can save for w: also entries from a release where w has
\* ElseSteps[w] steps, so a step this release does not have. heard drops
\* those when w is defined here, and keeps them unverified when not.
HeardEntries(w) ==
  {None, Ended("finished"), Ended("exited")}
  \cup {Run(s, c, TRUE) : s \in 0..Steps[w] - 1, c \in BOOLEAN}
  \cup {Run(s, c, FALSE) : s \in 0..ElseSteps[w] - 1, c \in BOOLEAN}

NoRecord == [w \in W |-> None]

VARIABLES
  defined,      \* Given.walkthroughsById has w: `take` wrote it, outside update
  loading,      \* storageStatus is "loading"
  held,         \* Model.held: commands given while loading, oldest first
  progress,     \* userRecord.walkthroughProgressById
  unverified,   \* isUnverified(userRecord, w)
  open,         \* live.openStep's walkthrough, or "none"
  waiting,      \* startRequests.waitingToStart
  \* History, not in the code:
  heardOpen,    \* w is collapsed because it was heard running and not collapsed: open in another tab
  appCollapsed, \* w is collapsed by act("collapse"), here or in the tab that saved it
  restoredOpen, \* w was loaded running and not collapsed, and nothing but an echo of that has changed it since
  threw,        \* the last change threw
  missed,       \* the last change verified a walkthrough restored open, with nothing else open, and did not open it
  input         \* the last move's parameters, while Recording

vars == <<defined, loading, held, progress, unverified, open, waiting, heardOpen, appCollapsed, restoredOpen, threw, missed, input>>

----------------------------------------------------------------------------
\* The Run state, as one record, so one rule can hand it to the next as the
\* code's Work does. bad: a stepAt on the way would throw a RangeError.

Cur == [p |-> progress, u |-> unverified, open |-> open, wait |-> waiting,
        ho |-> heardOpen, ac |-> appCollapsed, ro |-> restoredOpen, bad |-> FALSE, missed |-> FALSE]

IsUnv(R, w) == R.u[w] /\ R.p[w].status # "none"
RecOpen(R, w) == R.p[w].status = "running" /\ ~R.p[w].collapsed

\* walkthroughs.ts openId
OpenId(R) == IF R.open # "none" /\ RecOpen(R, R.open) THEN R.open ELSE "none"

\* record.ts put, with place: the same place keeps the same object.
\* A new object is no longer the one unverifiedWalkthroughProgressById holds.
Put(R, w, e) ==
  IF R.p[w] = e THEN R
  ELSE [R EXCEPT !.p[w] = e, !.u[w] = FALSE, !.ho[w] = FALSE, !.ac[w] = FALSE, !.ro[w] = FALSE]

InRange(w, s) == s < Steps[w]
Flag(R, b) == [R EXCEPT !.bad = R.bad \/ b]

\* walkthroughs.ts open: where it was if running, else step 0. enter calls stepAt.
OpenW(R, w) ==
  LET saved == R.p[w]
      s == IF saved.status = "running" THEN saved.step ELSE 0
  IN Flag([Put(R, w, Run(s, FALSE, TRUE)) EXCEPT !.open = w], ~InRange(w, s))

\* walkthroughs.ts interrupt: the open one is set aside as its dismiss says.
Interrupt(R) ==
  LET on == OpenId(R) IN
  IF on = "none" THEN R
  ELSE IF Hint[on] THEN [Put(R, on, Ended("exited")) EXCEPT !.open = "none"]
  ELSE Put(R, on, [R.p[on] EXCEPT !.collapsed = TRUE])

\* walkthroughs.ts verifyOne
VerifyOne(R, w) ==
  LET e == R.p[w] IN
  IF ~IsUnv(R, w) THEN R
  ELSE LET R1 == [R EXCEPT !.u[w] = FALSE, !.ro[w] = FALSE] IN
    IF e.status = "running" /\ ~e.fresh THEN Put(R1, w, None)
    ELSE IF e.status # "running" \/ e.collapsed THEN R1
    ELSE IF OpenId(R1) = "none" THEN OpenW(R1, w)
    ELSE Put(R1, w, IF Hint[w] THEN Ended("exited") ELSE [e EXCEPT !.collapsed = TRUE])

\* verifyOne as a definition arrives with no command on it (verifyAll), or by
\* requestStart, as <Walkthrough> calls it on mount. One restored open, with
\* nothing else open, should be open after it (run.md:381): `missed` says not.
Arrives(R, w) ==
  LET R2 == VerifyOne(R, w) IN
  IF R.ro[w] /\ IsUnv(R, w) /\ OpenId(R) = "none" /\ OpenId(R2) # w THEN [R2 EXCEPT !.missed = TRUE] ELSE R2

\* walkthroughs.ts verifyAll, in the order of walkthroughsById
RECURSIVE VerifyFrom(_, _, _)
VerifyFrom(R, D, i) ==
  IF i > Len(Order) THEN R
  ELSE VerifyFrom(IF D[Order[i]] THEN Arrives(R, Order[i]) ELSE R, D, i + 1)
VerifyAll(R, D) == VerifyFrom(R, D, 1)

Unwait(R, w) == [R EXCEPT !.wait = SelectSeq(R.wait, LAMBDA v : v # w)]
Waits(seq, w) == IF \E i \in 1..Len(seq) : seq[i] = w THEN seq ELSE Append(seq, w)

\* rules.ts act, on the open walkthrough, followed: every step has no condition.
Apply(R, on, a) ==
  LET e == R.p[on] IN
  CASE a = "reset"    -> Put(R, on, Run(0, FALSE, TRUE))
    [] a = "advance"  -> IF e.step + 1 < Steps[on] THEN Put(R, on, Run(e.step + 1, FALSE, TRUE))
                         ELSE [Put(R, on, Ended("finished")) EXCEPT !.open = "none"]
    [] a = "previous" -> IF e.step = 0 THEN R ELSE Put(R, on, Run(e.step - 1, FALSE, TRUE))
    [] a = "collapse" -> [Put(R, on, [e EXCEPT !.collapsed = TRUE]) EXCEPT !.ac[on] = TRUE]
    [] a = "resume"   -> R
    [] a = "exit"     -> [Put(R, on, Ended("exited")) EXCEPT !.open = "none"]

\* walkthroughs.ts begin, start, request, act, reset
Begin(R, w) ==
  LET R1 == Unwait(R, w) IN
  IF OpenId(R1) = w THEN R1 ELSE OpenW(Interrupt(R1), w)

StartW(R, w) == Begin(VerifyOne(R, w), w)

RequestW(R, w) ==
  LET R1 == Arrives(R, w) IN
  IF R1.p[w].status = "none" THEN R1 ELSE Unwait(R1, w)

ResetW(R, w) == IF OpenId(R) = w THEN Apply(R, w, "reset") ELSE Put(R, w, None)

\* An exit of one not open names its step, through about and stepAt.
ActW(R, a, w) ==
  LET R1 == VerifyOne(R, w) IN
  IF OpenId(R1) = w THEN Apply(R1, w, a)
  ELSE IF a = "resume" THEN Begin(R1, w)
  ELSE IF a # "exit" \/ R1.p[w].status # "running" THEN R1
  ELSE Flag(Put(R1, w, Ended("exited")), ~InRange(w, R1.p[w].step))

RunCmd(R, c) ==
  CASE c.kind = "start"   -> StartW(R, c.w)
    [] c.kind = "request" -> RequestW(R, c.w)
    [] c.kind = "act"     -> ActW(R, c.a, c.w)
    [] c.kind = "reset"   -> ResetW(R, c.w)

RECURSIVE RunAll(_, _)
RunAll(R, cs) == IF cs = <<>> THEN R ELSE RunAll(RunCmd(R, Head(cs)), Tail(cs))

\* record.ts heardWalkthroughProgress for one walkthrough. mode: how theirs.changedAt
\* compares with ours: "newer", "older", or "same" for an entry that echoes ours.
\* An echo is the same write heard again, so what this tab made of it stands:
\* the code keeps ours when theirs, or theirs collapsed, is in our place, and
\* an echo here is always ours as it is.
\* An entry heard for a walkthrough defined here is checked as verifyOne
\* checks a restored one: a stale one is dropped from this tab's record (not
\* from storage, which keeps it).
HeardEntry(R, D, w, theirs, mode, openHere) ==
  LET ours == R.p[w]
      keep == [p |-> ours, u |-> R.u[w], ho |-> R.ho[w], ac |-> R.ac[w], ro |-> R.ro[w]]
      gone == [p |-> None, u |-> FALSE, ho |-> FALSE, ac |-> FALSE, ro |-> FALSE]
      closed == IF theirs.status = "running" /\ ~theirs.collapsed THEN [theirs EXCEPT !.collapsed = TRUE] ELSE theirs
  IN
  IF w = openHere THEN keep
  \* None heard is another tab's reset, newer than this tab's entry (record.ts heardWalkthroughProgress).
  ELSE IF theirs.status = "none" THEN (IF ours.status = "none" THEN keep ELSE gone)
  ELSE IF ours.status # "none" /\ mode = "older" THEN keep
  ELSE IF ours.status # "none" /\ mode = "same" /\ (theirs = ours \/ closed = ours) THEN keep
  ELSE IF D[w] /\ closed.status = "running" /\ ~closed.fresh THEN gone
  ELSE [p |-> closed,
        u |-> ~D[w],
        ho |-> closed # theirs,
        ac |-> theirs.status = "running" /\ theirs.collapsed,
        ro |-> FALSE]

\* record.ts heard: another tab's record, the same as ours but for w's entry.
HeardAll(R, D, w, e, newer) ==
  LET oh == OpenId(R)
      h(v) == IF v = w THEN HeardEntry(R, D, v, e, IF newer THEN "newer" ELSE "older", oh)
              ELSE HeardEntry(R, D, v, R.p[v], "same", oh)
  IN [R EXCEPT !.p = [v \in W |-> h(v).p], !.u = [v \in W |-> h(v).u],
               !.ho = [v \in W |-> h(v).ho], !.ac = [v \in W |-> h(v).ac], !.ro = [v \in W |-> h(v).ro]]

\* walkthroughs.ts settle: dropClosedStepState, then openRequest. Never while loading.
FirstFree(R) ==
  LET is == {i \in 1..Len(R.wait) : R.p[R.wait[i]].status = "none"}
  IN IF is = {} THEN 0 ELSE CHOOSE i \in is : \A j \in is : i <= j

DropClosed(R) == IF R.open # "none" /\ OpenId(R) = "none" THEN [R EXCEPT !.open = "none"] ELSE R

OpenRequest(R) ==
  IF R.open # "none" \/ R.wait = <<>> THEN R
  ELSE LET i == FirstFree(R) IN
       IF i = 0 THEN [R EXCEPT !.wait = <<>>]
       ELSE OpenW([R EXCEPT !.wait = SubSeq(R.wait, i + 1, Len(R.wait))], R.wait[i])

Settle(R) == OpenRequest(DropClosed(R))

\* views.ts beaconsShown calls stepAt, through waymarkStateOf, for every
\* beacon candidate: running, collapsed, defined and verified, with nothing open.
BeaconCrash(R, D) ==
  /\ OpenId(R) = "none"
  /\ \E w \in W : D[w] /\ R.p[w].status = "running" /\ R.p[w].collapsed /\ ~IsUnv(R, w) /\ ~InRange(w, R.p[w].step)

Throws(R, D) == R.bad \/ BeaconCrash(R, D)

----------------------------------------------------------------------------
\* Changes

Done(R, failed) ==
  /\ progress' = R.p /\ unverified' = R.u /\ open' = R.open /\ waiting' = R.wait
  /\ heardOpen' = R.ho /\ appCollapsed' = R.ac /\ restoredOpen' = R.ro /\ missed' = R.missed /\ threw' = failed

\* update.ts change: the phases, then settle. One that throws leaves the Run as it was.
Kept ==
  /\ threw' = TRUE /\ missed' = FALSE
  /\ UNCHANGED <<loading, held, progress, unverified, open, waiting, heardOpen, appCollapsed, restoredOpen>>

Commit(R, D) ==
  LET S == Settle(R) IN
  IF Throws(S, D) THEN Kept ELSE Done(S, FALSE) /\ UNCHANGED <<loading, held>>

NoInput == [kind |-> "none", w |-> "none", a |-> "none", rec |-> NoRecord, e |-> None, newer |-> FALSE]
Note(x) == input' = IF Recording THEN x ELSE "none"

Take(w) == defined' = [defined EXCEPT ![w] = TRUE]

Cmd(kind, w, a) == [kind |-> kind, w |-> w, a |-> a]

\* update.ts command: held while loading, else a change of its own.
Command(c) ==
  /\ Take(c.w)
  /\ Note([NoInput EXCEPT !.kind = c.kind, !.w = c.w, !.a = c.a])
  /\ IF loading
     THEN /\ Len(held) < MaxHeld
          /\ held' = Append(held, c)
          /\ threw' = FALSE /\ missed' = FALSE
          /\ UNCHANGED <<loading, progress, unverified, open, waiting, heardOpen, appCollapsed, restoredOpen>>
     ELSE Commit(RunCmd(Cur, c), defined')

\* The app or the user, through the public Run: each call takes the definition first.
Start(w) == Command(Cmd("start", w, "none"))
Act(a, w) == Command(Cmd("act", w, a))
Reset(w) == Command(Cmd("reset", w, "none"))

\* requestStart: on the waiting list at once, even while loading; then the request.
RequestStart(w) ==
  /\ Take(w)
  /\ Note([NoInput EXCEPT !.kind = "requestStart", !.w = w])
  /\ LET R == [Cur EXCEPT !.wait = Waits(waiting, w)] IN
     IF loading
     THEN /\ Len(held) < MaxHeld
          /\ held' = Append(held, Cmd("request", w, "none"))
          /\ waiting' = R.wait
          /\ threw' = FALSE /\ missed' = FALSE
          /\ UNCHANGED <<loading, progress, unverified, open, heardOpen, appCollapsed, restoredOpen>>
     ELSE Commit(RequestW(R, w), defined')

\* The function requestStart returned: off the list, no change.
Withdraw(w) ==
  /\ \E i \in 1..Len(waiting) : waiting[i] = w
  /\ waiting' = SelectSeq(waiting, LAMBDA v : v # w)
  /\ threw' = FALSE /\ missed' = FALSE
  /\ Note([NoInput EXCEPT !.kind = "withdraw", !.w = w])
  /\ UNCHANGED <<defined, loading, held, progress, unverified, open, heardOpen, appCollapsed, restoredOpen>>

\* A definition reaches the Run with no command, as a checklist's tasks do: arrived.
Arrive(w) ==
  /\ ~defined[w]
  /\ Take(w)
  /\ Note([NoInput EXCEPT !.kind = "arrive", !.w = w])
  /\ IF loading
     THEN threw' = FALSE /\ missed' = FALSE /\ UNCHANGED <<loading, held, progress, unverified, open, waiting, heardOpen, appCollapsed, restoredOpen>>
     ELSE Commit(VerifyAll(Cur, defined'), defined')

\* Storage answers the first load: the record, verifyAll, then the held commands, as one change.
Loaded ==
  /\ loading
  /\ \E rec \in [W -> UNION {LoadEntries(w) : w \in W}] :
       /\ \A w \in W : rec[w] \in LoadEntries(w)
       /\ Note([NoInput EXCEPT !.kind = "loaded", !.rec = rec])
       /\ LET R0 == [Cur EXCEPT !.p = rec,
                                !.u = [w \in W |-> rec[w].status # "none"],
                                !.ac = [w \in W |-> rec[w].status = "running" /\ rec[w].collapsed],
                                !.ro = [w \in W |-> rec[w].status = "running" /\ ~rec[w].collapsed /\ rec[w].fresh]]
              S == Settle(RunAll(VerifyAll(R0, defined), held))
          IN IF Throws(S, defined) THEN Kept
             ELSE Done(S, FALSE) /\ loading' = FALSE /\ held' = <<>>
  /\ UNCHANGED defined

\* Another tab saves: heard, then arrived, as run.ts sends them. A heard that
\* throws stops the arrived; an arrived that throws keeps the heard.
Heard ==
  /\ ~loading
  /\ \E w \in W : \E e \in HeardEntries(w), newer \in BOOLEAN :
       /\ progress[w].status = "none" => newer
       /\ Note([NoInput EXCEPT !.kind = "heard", !.w = w, !.e = e, !.newer = newer])
       /\ LET S1 == Settle(HeardAll(Cur, defined, w, e, newer))
              S2 == Settle(VerifyAll(S1, defined))
          IN IF Throws(S1, defined) THEN Kept
             ELSE IF Throws(S2, defined) THEN Done(S1, TRUE)
             ELSE Done(S2, FALSE)
  /\ UNCHANGED <<defined, loading, held>>

Init ==
  /\ defined = [w \in W |-> FALSE]
  /\ loading = TRUE /\ held = <<>>
  /\ progress = NoRecord /\ unverified = [w \in W |-> FALSE]
  /\ open = "none" /\ waiting = <<>>
  /\ heardOpen = [w \in W |-> FALSE] /\ appCollapsed = [w \in W |-> FALSE] /\ restoredOpen = [w \in W |-> FALSE]
  /\ threw = FALSE /\ missed = FALSE
  /\ input = IF Recording THEN NoInput ELSE "none"

UserOpens(w) == Start(w) \/ Act("resume", w)

Next ==
  \/ \E w \in W : Start(w) \/ RequestStart(w) \/ Withdraw(w) \/ Reset(w) \/ Arrive(w)
  \/ \E a \in Actions, w \in W : Act(a, w)
  \/ Loaded
  \/ Heard

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* The rules

TypeOK ==
  /\ defined \in [W -> BOOLEAN] /\ loading \in BOOLEAN
  /\ progress \in [W -> UNION {HeardEntries(w) : w \in W}]
  /\ open \in W \cup {"none"}
  /\ Len(waiting) <= Cardinality(W)

Verified(w) == defined[w] /\ ~(unverified[w] /\ progress[w].status # "none")
VOpen(w) == Verified(w) /\ progress[w].status = "running" /\ ~progress[w].collapsed

\* run.md:140, counting only progress whose definition has arrived (thread 5, option a).
AtMostOneOpen == \A v, w \in W : VOpen(v) /\ VOpen(w) => v = w

\* The record and the screen agree: the one the record counts open is the one shown.
OpenIsShown == \A w \in W : VOpen(w) <=> open = w

\* run.md:309: a request waits only while one is open or the record loads.
RequestsWaitOnlyBehindOpen == waiting # <<>> => (open # "none" \/ loading)

\* Thread 1, guessed: every verified running entry's step exists in its definition.
StepInRange == \A w \in W : Verified(w) /\ progress[w].status = "running" => InRange(w, progress[w].step)

\* No change throws.
ChangesNeverThrow == ~threw

\* run.md:383: a hint is part way through only while it is open, here or in
\* another tab, or once the app collapses it with act("collapse") (open.test.ts:367).
\* Never because it was interrupted, restored, or echoed back.
HintNeverPartWay ==
  \A w \in W : Hint[w] /\ Verified(w) /\ progress[w].status = "running" /\ progress[w].collapsed => heardOpen[w] \/ appCollapsed[w]

\* run.md:381: a walkthrough restored open opens again once its definition
\* arrives, if nothing else is open.
RestoredReopens == ~missed

\* run/types.ts:182, run.md:285 and thread 5: the open walkthrough stops being
\* open only by a click that opens another (start, or a beacon's resume), or by
\* a call on it (Next, exit, collapse). A request never interrupts, and a
\* restored walkthrough waits until the open one is done.
OnlyAClickInterrupts ==
  [][open # "none" /\ open' # open =>
       \/ \E w \in W : UserOpens(w)
       \/ \E a \in Actions : Act(a, open)]_vars

\* run/types.ts:182: the app never brings back one the user finished or exited.
RequestNeverRevives ==
  [][\A w \in W : progress[w].status \in {"finished", "exited"} /\ open' = w => UserOpens(w)]_vars

\* run.md:285: a click always shows something, when the change does not throw.
StartShows == [][\A w \in W : Start(w) /\ ~loading /\ ~threw' => open' = w]_vars

\* The same, throw or not: what the user sees.
StartAlwaysShows == [][\A w \in W : Start(w) /\ ~loading => open' = w]_vars

\* Thread 1, decision 3: hearing never moves the walkthrough open here, even
\* one finished in another tab: the most recent change wins, and this tab's is.
HeardKeepsOpen == [][Heard /\ open # "none" => open' = open /\ progress'[open] = progress[open]]_vars

=============================================================================
