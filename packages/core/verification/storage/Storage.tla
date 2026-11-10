------------------------------ MODULE Storage ------------------------------
(***************************************************************************)
(* Two tabs share one stored record, through an adapter that answers loads *)
(* and saves later, in any order. The record holds one walkthrough, a      *)
(* one-step hint, and one task.                                            *)
(*                                                                         *)
(* Each tab is a Run: its memory (UserRecord in packages/core/src/state.ts),*)
(* worked by update() in src/run/update.ts and the merges in               *)
(* src/run/record.ts; and its link (src/storage/link.ts), the closure that *)
(* loads, saves and listens. The store, its answers, another device and    *)
(* the clock are the environment.                                          *)
(*                                                                         *)
(* The Runs know the hint's definition from the start, as a component that *)
(* renders it hands it over. The clock counts in whole ticks, for          *)
(* changedAt.                                                              *)
(***************************************************************************)
EXTENDS Integers, Sequences

CONSTANTS
  Adapter,        \* "partial": savePartial, applied whole on the server; "whole": save, after a load
  Async,          \* loads and saves answer later; otherwise within the call, as localStorage does
  InOrder,        \* a tab's savePartial calls reach the store in the order sent
  TellsOwnWrites, \* a tab hears its own writes too; localStorage's storage event does not
  HearCurrent,    \* a tab told of a write reads what is stored then, as localStorageAdapter does;
                  \* otherwise it hears each record as written, in order
  Failures,       \* loads and saves may fail
  Unmounts,       \* a tab may disconnect and connect again
  MaxClock,
  MaxCmds,        \* user commands and replaces, across both tabs
  MaxDevice,      \* writes from another device
  DeviceValues,   \* what another device may write
  InitialStored,  \* what may be stored at the start
  Commands

Tabs == 1..2
\* Each tab of both, as a tuple: TLC mishandles an EXCEPT of two paths on a function built as [t \in Tabs |-> ...].
EachTab(F(_)) == <<F(1), F(2)>>
Device == 0
\* Sentinels are records of the same shape as the values they stand beside: TLC compares only like with like.
None == [s |-> "none", c |-> FALSE, at |-> 0]
Keep == [s |-> "keep", c |-> FALSE, at |-> 0]
Unreadable == [w |-> None, task |-> "unreadable"]
Failed == [w |-> None, task |-> "failed"]

Running(collapsed, time) == [s |-> "running", c |-> collapsed, at |-> time]
Finished(time) == [s |-> "finished", c |-> FALSE, at |-> time]
Entries == {None} \cup {Running(b, n) : b \in BOOLEAN, n \in 0..MaxClock} \cup {Finished(n) : n \in 0..MaxClock}
\* A record Waymark can read. Empty stands for null too: parseRecord reads both as no entries.
\* task "reopened" is a tick taken back (tasks.ts reopen): todo, and stored.
Records == [w : Entries, task : {"todo", "done", "reopened"}]
Empty == [w |-> None, task |-> "todo"]
StoredValues == Records \cup {Unreadable}
\* RecordChanges: None as w removes the entry; a task's "todo" removes its status.
Changes == [w : Entries \cup {Keep}, task : {"keep", "todo", "done", "reopened"}, replace : BOOLEAN]
NoChange == [w |-> Keep, task |-> "keep", replace |-> FALSE]

Statuses == {"loading", "ready", "error", "unreadable"}
Loads == {"idle", "asked", "answered", "done"}
Phases == {"idle", "loading", "storing"}

VARIABLES
  stored,   \* what the store holds
  writer,   \* who wrote it last: a tab, or Device
  version,  \* how many writes changed it
  tabs,     \* each tab's Run and link, below
  hist,     \* what has happened, for the rules
  clock,
  cmds,
  device

vars == <<stored, writer, version, tabs, hist, clock, cmds, device>>

(* One tab:
   status, mem, held          the Run's storageStatus, its record, the commands held while loading
   connected, subscribed,     the link's connections > 0, unsubscribe set, everConnected,
   everConnected, load,       and its load at connect: asked of the store, answered by it,
   loadValue, loadVersion     then delivered with loadValue, read at write loadVersion
   pending, phase, sending,   a save adapter's changes not yet saved, the save under way
   storeValue                 (loading what is stored, or storing storeValue) and its changes
   sent, sentLater            savePartial calls not yet answered, and for each the entries ("w", "task") a
                              call sent after it set: newer, so not sent again if it fails
   retry                      a savePartial's changes that failed, sent with the next save, under it
   toHear, notified           records the store told this tab of, each with its write's number, not yet heard
   heldRecord                 the latest record heard while loading, with its write's number, taken in after
                              the load: link.ts's held, empty or one
   seen                       the number of the last write this tab loaded or heard, or knows it made
   owed                       history: a write while connected, since its load was read, not yet heard
   reported, finishedHere,    history: recordUnreadable reported since the last readable record;
   reshown                    this tab finished the hint since starting it; and showed it again *)
TabInit == [status |-> "loading", mem |-> Empty, held |-> <<>>,
            connected |-> FALSE, subscribed |-> FALSE, everConnected |-> FALSE,
            load |-> "idle", loadValue |-> Empty, loadVersion |-> 0,
            pending |-> NoChange, phase |-> "idle", sending |-> NoChange, storeValue |-> Empty,
            sent |-> <<>>, sentLater |-> <<>>, retry |-> NoChange, toHear |-> <<>>, notified |-> FALSE, heldRecord |-> <<>>, seen |-> -1, owed |-> FALSE,
            reported |-> FALSE, finishedHere |-> FALSE, reshown |-> FALSE]

TypeOK ==
  /\ stored \in StoredValues
  /\ writer \in Tabs \cup {Device}
  /\ clock \in 0..MaxClock
  /\ \A t \in Tabs :
       /\ tabs[t].status \in Statuses
       /\ tabs[t].mem \in Records
       /\ tabs[t].load \in Loads
       /\ tabs[t].phase \in Phases
       /\ tabs[t].pending \in Changes
       /\ tabs[t].sending \in Changes
       /\ tabs[t].retry \in Changes
       /\ Len(tabs[t].sentLater) = Len(tabs[t].sent)

------------------------------------------------------------------------------
(* The merges, as src/storage/records.ts makes them. *)

\* merge: changes made to what is stored; a replace starts from nothing. The stored entry stays
\* when it changed later than the one set, so an older save landing last does not undo a newer one;
\* at the same time the set one wins. A removal has no time, and always goes through.
Merge(base, c) ==
  LET b == IF c.replace THEN Empty ELSE base
      newerStored == c.w # Keep /\ c.w # None /\ b.w # None /\ b.w.at > c.w.at
  IN [w |-> IF c.w = Keep \/ newerStored THEN b.w ELSE c.w, task |-> IF c.task = "keep" THEN b.task ELSE c.task]

\* combine: two saves' changes as one, the later's over the earlier's.
Combine(e, l) ==
  IF l.replace THEN l
  ELSE [w |-> IF l.w = Keep THEN e.w ELSE l.w, task |-> IF l.task = "keep" THEN e.task ELSE l.task, replace |-> e.replace]

\* The entries changes set or remove.
Keys(c) == {k \in {"w", "task"} : c.replace \/ (k = "w" /\ c.w # Keep) \/ (k = "task" /\ c.task # "keep")}

\* records.ts without: changes but for the entries in ks. A replace stays whole.
Without(c, ks) ==
  IF c.replace THEN c
  ELSE [w |-> IF "w" \in ks THEN Keep ELSE c.w, task |-> IF "task" \in ks THEN "keep" ELSE c.task, replace |-> FALSE]

\* changesBetween, from the record before a change to the one after it.
Diff(b, a) == [w |-> IF b.w = a.w THEN Keep ELSE a.w, task |-> IF b.task = a.task THEN "keep" ELSE a.task, replace |-> FALSE]

(* The Run, as src/run/walkthroughs.ts, tasks.ts and record.ts work it. *)

\* The hint is open here: running and not collapsed. A loaded entry like that opens on arrival.
IsOpen(r) == r.w # None /\ r.w.s = "running" /\ ~r.w.c

\* One command on the record, at time now.
Do(cmd, r, now) ==
  CASE cmd = "start"   -> IF IsOpen(r) THEN r ELSE [r EXCEPT !.w = Running(FALSE, now)]
    \* requestStart opens only a walkthrough with no progress (openRequest).
    [] cmd = "request" -> IF r.w = None THEN [r EXCEPT !.w = Running(FALSE, now)] ELSE r
    \* act("advance") on the hint's one step.
    [] cmd = "finish"  -> IF IsOpen(r) THEN [r EXCEPT !.w = Finished(now)] ELSE r
    \* reset: back to step 0 when open, which for a one-step hint changes nothing; otherwise the entry goes.
    [] cmd = "reset"   -> IF IsOpen(r) THEN r ELSE [r EXCEPT !.w = None]
    [] cmd = "tick"    -> [r EXCEPT !.task = IF r.task = "done" THEN "reopened" ELSE "done"]

\* heardWalkthroughProgress, record.ts:53-63.
HeardW(ours, theirs, openHere) ==
  IF openHere THEN ours
  ELSE IF theirs = None THEN None
  ELSE IF ours # None /\ ours.at > theirs.at THEN ours
  ELSE IF theirs.s = "running" THEN [theirs EXCEPT !.c = TRUE] ELSE theirs

------------------------------------------------------------------------------
(* Steps on the whole world W = [stored, writer, version, tabs, hist].      *)
(* Those that may go more than one way give the set of worlds they may     *)
(* lead to.                                                                *)

World == [stored |-> stored, writer |-> writer, version |-> version, tabs |-> tabs, hist |-> hist]

Become(W) == /\ stored' = W.stored /\ writer' = W.writer /\ version' = W.version /\ tabs' = W.tabs /\ hist' = W.hist

\* Two records show the same, collapsed or not.
SameEntry(a, b) == IF a = None \/ b = None THEN a = b ELSE a.s = b.s /\ a.at = b.at
SameRecord(r, v) == v \in Records /\ r.task = v.task /\ SameEntry(r.w, v.w)

\* The store takes v, and tells every tab listening that it changed.
Write(W, by, v) ==
  LET n == IF v # W.stored THEN W.version + 1 ELSE W.version
      changed(listener) == (listener # by \/ TellsOwnWrites) /\ v # W.stored
      told(tb) == IF HearCurrent THEN [tb EXCEPT !.notified = TRUE]
                  ELSE [tb EXCEPT !.toHear = Append(tb.toHear, [record |-> v, version |-> n])]
      owe(tb) == [tb EXCEPT !.owed = tb.owed \/ (tb.connected /\ tb.load # "idle")]
      \* A tab not told of its own write knows it, if it knew every write before and shows what it wrote.
      knows(tb) == IF tb.seen = W.version /\ SameRecord(tb.mem, v) THEN [tb EXCEPT !.seen = n] ELSE tb
      after(listener) ==
        IF listener = by /\ ~TellsOwnWrites THEN knows(W.tabs[listener])
        ELSE IF ~changed(listener) THEN W.tabs[listener]
        ELSE IF W.tabs[listener].subscribed THEN told(owe(W.tabs[listener])) ELSE owe(W.tabs[listener])
  IN [W EXCEPT !.stored = v, !.writer = by, !.version = n, !.tabs = EachTab(after)]

\* A tab's save of changes c lands as v.
TabWrite(W, t, v, c) ==
  LET old == W.stored
      both == old \in Records /\ v \in Records
      h == [W.hist EXCEPT
              !.overwrote = W.hist.overwrote \/ (old = Unreadable /\ ~c.replace),
              !.clobbered = W.hist.clobbered \/ (both /\ ~c.replace /\ ((c.w = Keep /\ v.w # old.w) \/ (c.task = "keep" /\ v.task # old.task))),
              !.reverted  = W.hist.reverted \/ (both /\ ~c.replace /\ old.w # None /\ v.w # None /\ v.w.at < old.w.at)]
  IN Write([W EXCEPT !.hist = h], t, v)

\* The Run hears RecordUnreadableError: unreadable, reported on the change into it (turnedUnreadable).
Refuse(W, t) ==
  IF W.tabs[t].status = "unreadable" THEN W
  ELSE [W EXCEPT !.tabs[t].status = "unreadable", !.tabs[t].reported = TRUE,
                 !.hist.double = W.hist.double \/ W.tabs[t].reported]

\* A save adapter's save failed: its changes wait for the next, under any made since.
FailSave(W, t, unreadable) ==
  LET tabFailSave == W.tabs[t]
      WFailSave == [W EXCEPT !.tabs[t].pending = Combine(tabFailSave.sending, tabFailSave.pending), !.tabs[t].phase = "idle",
                      !.tabs[t].sending = NoChange]
  IN IF unreadable THEN Refuse(WFailSave, t) ELSE WFailSave

\* A save adapter's save is stored.
StoreDone(W, t, v) ==
  TabWrite([W EXCEPT !.tabs[t].phase = "idle", !.tabs[t].sending = NoChange], t, v, W.tabs[t].sending)

\* flush, link.ts:116: one save at a time, only once connected.
Flush(W, t) ==
  LET tabFlush == W.tabs[t] IN
  IF tabFlush.phase # "idle" \/ tabFlush.pending = NoChange \/ ~tabFlush.everConnected THEN {W}
  ELSE LET out == tabFlush.pending
           WFlush == [W EXCEPT !.tabs[t].pending = NoChange, !.tabs[t].sending = out]
       IN IF Async
          THEN {IF out.replace THEN [WFlush EXCEPT !.tabs[t].phase = "storing", !.tabs[t].storeValue = Merge(Empty, out)]
                ELSE [WFlush EXCEPT !.tabs[t].phase = "loading"]}
          ELSE {IF out.replace THEN StoreDone(WFlush, t, Merge(Empty, out))
                ELSE IF WFlush.stored = Unreadable THEN FailSave(WFlush, t, TRUE)
                ELSE StoreDone(WFlush, t, Merge(WFlush.stored, out))}
               \cup (IF Failures THEN {FailSave(WFlush, t, FALSE)} ELSE {})

\* link.ts sendPartial: a savePartial call that failed keeps its changes for the next, less what a
\* call sent after it set, under any kept already.
PartialFail(W, t, c, later) == [W EXCEPT !.tabs[t].retry = Combine(Without(c, later), W.tabs[t].retry)]

\* applyChanges on the server: it refuses to save over a record it cannot read, unless replacing.
PartialApply(W, t, c, later) ==
  IF W.stored = Unreadable /\ ~c.replace THEN PartialFail(Refuse(W, t), t, c, later)
  ELSE TabWrite(W, t, Merge(IF W.stored = Unreadable THEN Empty ELSE W.stored, c), c)

\* link.save: a savePartial goes with what failed before, under it.
Save(W, t, c) ==
  IF Adapter = "partial"
  THEN LET tabSave == W.tabs[t]
           out == Combine(tabSave.retry, c)
           WSave == [W EXCEPT !.tabs[t].retry = NoChange]
       IN IF Async
          THEN {[WSave EXCEPT !.tabs[t].sent = Append(tabSave.sent, out),
                              !.tabs[t].sentLater = Append([j \in 1..Len(tabSave.sentLater) |-> tabSave.sentLater[j] \cup Keys(out)], {})]}
          ELSE {PartialApply(WSave, t, out, {})} \cup (IF Failures THEN {PartialFail(WSave, t, out, {})} ELSE {})
  ELSE Flush([W EXCEPT !.tabs[t].pending = Combine(W.tabs[t].pending, c)], t)

\* The save effect of a change: what changed since `before`, if anything.
Changed(W, t, before) ==
  LET c == Diff(before, W.tabs[t].mem) IN IF c = NoChange THEN {W} ELSE Save(W, t, c)

\* History of a command, for NoReshowHere.
Track(W, t, cmd, r) ==
  LET finished == cmd = "finish" /\ IsOpen(r)
      reshow == cmd = "request" /\ r.w = None /\ W.tabs[t].finishedHere
      reset == cmd = "reset" /\ ~IsOpen(r) /\ r.w # None
      after(other) ==
        [W.tabs[other] EXCEPT
           !.finishedHere = IF other = t THEN finished \/ (W.tabs[other].finishedHere /\ cmd # "start" /\ ~reset) ELSE W.tabs[other].finishedHere /\ ~reset,
           !.reshown = W.tabs[other].reshown \/ (other = t /\ reshow)]
  IN [W EXCEPT !.tabs = EachTab(after)]

\* One command as one change in tab t.
Run(W, t, cmd) ==
  LET rRun == W.tabs[t].mem
  IN Changed(Track([W EXCEPT !.tabs[t].mem = Do(cmd, rRun, clock)], t, cmd, rRun), t, rRun)

\* listen(), link.ts: from connect, before the load is sent.
Subscribe(W, t) ==
  IF W.tabs[t].connected /\ ~W.tabs[t].subscribed THEN [W EXCEPT !.tabs[t].subscribed = TRUE] ELSE W

\* heard() in record.ts: task statuses whole, walkthrough by changedAt, the open one kept. An entry
\* this tab kept over an older one heard is saved again (change.ts asStored), so storage catches up.
Heard(W, t, v, n) ==
  IF v = Unreadable THEN {[Refuse(W, t) EXCEPT !.tabs[t].seen = n]}
  ELSE LET rHeard == W.tabs[t].mem
           WHeard == [W EXCEPT !.tabs[t].mem = [w |-> HeardW(rHeard.w, v.w, IsOpen(rHeard)), task |-> v.task],
                               !.tabs[t].status = IF W.tabs[t].status = "unreadable" THEN "ready" ELSE W.tabs[t].status,
                               !.tabs[t].reported = FALSE, !.tabs[t].seen = n]
       IN IF rHeard.w # None /\ v.w # None /\ rHeard.w.at > v.w.at
          THEN Save(WHeard, t, [w |-> rHeard.w, task |-> "keep", replace |-> FALSE])
          ELSE {WHeard}

\* The load at connect arrives: loaded() in record.ts with the held commands, then the record heard meanwhile.
Take(W, t, v, n) ==
  LET tabTake == W.tabs[t]
      st == IF v = Failed THEN "error" ELSE IF v = Unreadable THEN "unreadable" ELSE "ready"
      WTake == [W EXCEPT !.tabs[t].status = st, !.tabs[t].mem = IF v \in Records THEN v ELSE tabTake.mem,
                      !.tabs[t].load = "done", !.tabs[t].held = <<>>,
                      !.tabs[t].seen = IF v = Failed THEN tabTake.seen ELSE n,
                      !.tabs[t].reported = (v = Unreadable),
                      !.hist.double = W.hist.double \/ (v = Unreadable /\ tabTake.reported)]
      Ws == IF tabTake.held = <<>> THEN {WTake} ELSE Run(WTake, t, Head(tabTake.held))
      heardAfter(X) ==
        IF tabTake.heldRecord = <<>> THEN {X}
        ELSE Heard([X EXCEPT !.tabs[t].heldRecord = <<>>], t, Head(tabTake.heldRecord).record, Head(tabTake.heldRecord).version)
  IN UNION {heardAfter(X) : X \in Ws}

LoadOutcomes(v) == {v} \cup (IF Failures THEN {Failed} ELSE {})

Remove(s, i) == SubSeq(s, 1, i - 1) \o SubSeq(s, i + 1, Len(s))

------------------------------------------------------------------------------
(* Actions. One action is one call into the Run or its link, or one answer. *)

Init ==
  /\ stored \in InitialStored
  /\ writer = Device
  /\ version = 0
  /\ tabs = <<TabInit, TabInit>>
  /\ hist = [overwrote |-> FALSE, clobbered |-> FALSE, reverted |-> FALSE, double |-> FALSE]
  /\ clock = 0
  /\ cmds = 0
  /\ device = 0

\* The user or the app: start, requestStart, act("advance"), reset or toggle. Held while loading.
Command(t, cmd) ==
  /\ cmds < MaxCmds
  /\ IF tabs[t].status = "loading"
     THEN /\ tabs[t].held = <<>>
          /\ Become([World EXCEPT !.tabs[t].held = <<cmd>>])
     ELSE /\ Do(cmd, tabs[t].mem, clock) # tabs[t].mem
          /\ \E W \in Run(World, t, cmd) : Become(W)
  /\ cmds' = cmds + 1
  /\ UNCHANGED <<clock, device>>

\* The app's replace on the recordUnreadable problem, with nothing of its own: what this tab holds, saved whole.
Replace(t) ==
  /\ cmds < MaxCmds
  /\ tabs[t].status = "unreadable"
  /\ LET rReplace == tabs[t].mem
         WReplace == [World EXCEPT !.tabs[t].status = "ready", !.tabs[t].reported = FALSE]
     IN \E W \in Save(WReplace, t, [w |-> rReplace.w, task |-> rReplace.task, replace |-> TRUE]) : Become(W)
  /\ cmds' = cmds + 1
  /\ UNCHANGED <<clock, device>>

\* run.connect(): every one listens, the first then loads, and a save adapter saves what waits.
Connect(t) ==
  /\ ~tabs[t].connected
  /\ \/ ~Unmounts /\ ~tabs[t].everConnected
     \/ Unmounts
  /\ LET VConnect == Subscribe([World EXCEPT !.tabs[t].connected = TRUE, !.tabs[t].everConnected = TRUE], t)
         Ws1 == IF tabs[t].load # "idle" THEN {VConnect}
                ELSE IF Async THEN {[VConnect EXCEPT !.tabs[t].load = "asked"]}
                ELSE UNION {Take([VConnect EXCEPT !.tabs[t].owed = FALSE], t, v, version) : v \in LoadOutcomes(VConnect.stored)}
         Ws2 == IF Adapter = "whole" THEN UNION {Flush(X, t) : X \in Ws1} ELSE Ws1
     IN \E W \in Ws2 : Become(W)
  /\ UNCHANGED <<clock, cmds, device>>

\* The connection's cleanup: it stops listening, and drops a record held.
Disconnect(t) ==
  /\ Unmounts
  /\ tabs[t].connected
  /\ Become([World EXCEPT !.tabs[t] = [tabs[t] EXCEPT !.connected = FALSE, !.subscribed = FALSE, !.toHear = <<>>, !.notified = FALSE,
                                                      !.heldRecord = <<>>, !.owed = FALSE]])
  /\ UNCHANGED <<clock, cmds, device>>

\* The store reads the record for a tab's load at connect, or fails it.
LoadAnswer(t) ==
  /\ tabs[t].load = "asked"
  /\ \E v \in LoadOutcomes(stored) :
       Become([World EXCEPT !.tabs[t].load = "answered", !.tabs[t].loadValue = v, !.tabs[t].loadVersion = version, !.tabs[t].owed = FALSE])
  /\ UNCHANGED <<clock, cmds, device>>

\* The tab gets that answer.
LoadArrive(t) ==
  /\ tabs[t].load = "answered"
  /\ \E W \in Take(World, t, tabs[t].loadValue, tabs[t].loadVersion) : Become(W)
  /\ UNCHANGED <<clock, cmds, device>>

\* A record heard: taken in, or held while the load at connect is out, in place of any held before.
HeardOrHeld(W, t, v, n) ==
  IF W.tabs[t].status = "loading" THEN {[W EXCEPT !.tabs[t].heldRecord = <<[record |-> v, version |-> n]>>]}
  ELSE Heard(W, t, v, n)

\* The tab hears a record the store told it of.
Hear(t) ==
  /\ tabs[t].subscribed
  /\ \/ /\ HearCurrent /\ tabs[t].notified
        /\ \E W \in HeardOrHeld([World EXCEPT !.tabs[t].notified = FALSE, !.tabs[t].owed = FALSE], t, stored, version) : Become(W)
     \/ /\ ~HearCurrent /\ tabs[t].toHear # <<>>
        /\ \E W \in HeardOrHeld([World EXCEPT !.tabs[t].toHear = Tail(tabs[t].toHear), !.tabs[t].owed = Tail(tabs[t].toHear) # <<>>], t, Head(tabs[t].toHear).record, Head(tabs[t].toHear).version) : Become(W)
  /\ UNCHANGED <<clock, cmds, device>>

\* A save adapter's load before a save answers: it fails, refuses an unreadable record, or the changes are merged in.
WholeLoaded(t) ==
  /\ tabs[t].phase = "loading"
  /\ \E W \in {IF stored = Unreadable THEN FailSave(World, t, TRUE)
               ELSE [World EXCEPT !.tabs[t].phase = "storing", !.tabs[t].storeValue = Merge(stored, tabs[t].sending)]}
              \cup (IF Failures THEN {FailSave(World, t, FALSE)} ELSE {}) : Become(W)
  /\ UNCHANGED <<clock, cmds, device>>

\* A save adapter's save is stored, and the next starts.
WholeStored(t) ==
  /\ tabs[t].phase = "storing"
  /\ \E W \in Flush(StoreDone(World, t, tabs[t].storeValue), t) : Become(W)
  /\ UNCHANGED <<clock, cmds, device>>

WholeStoreFailed(t) ==
  /\ Failures
  /\ tabs[t].phase = "storing"
  /\ Become(FailSave(World, t, FALSE))
  /\ UNCHANGED <<clock, cmds, device>>

\* A savePartial call reaches the store.
PartialLanded(t) ==
  /\ tabs[t].sent # <<>>
  /\ \E i \in (IF InOrder THEN {1} ELSE 1..Len(tabs[t].sent)) :
       Become(PartialApply([World EXCEPT !.tabs[t].sent = Remove(tabs[t].sent, i), !.tabs[t].sentLater = Remove(tabs[t].sentLater, i)],
                           t, tabs[t].sent[i], tabs[t].sentLater[i]))
  /\ UNCHANGED <<clock, cmds, device>>

\* A savePartial call fails, and its changes wait for the next save.
PartialFailed(t) ==
  /\ Failures
  /\ tabs[t].sent # <<>>
  /\ \E i \in (IF InOrder THEN {1} ELSE 1..Len(tabs[t].sent)) :
       Become(PartialFail([World EXCEPT !.tabs[t].sent = Remove(tabs[t].sent, i), !.tabs[t].sentLater = Remove(tabs[t].sentLater, i)],
                          t, tabs[t].sent[i], tabs[t].sentLater[i]))
  /\ UNCHANGED <<clock, cmds, device>>

\* Another device writes.
DeviceWrite ==
  /\ device < MaxDevice
  /\ \E v \in DeviceValues : Become(Write(World, Device, v))
  /\ device' = device + 1
  /\ UNCHANGED <<clock, cmds>>

Tick ==
  /\ clock < MaxClock
  /\ clock' = clock + 1
  /\ UNCHANGED <<stored, writer, version, tabs, hist, cmds, device>>

Next ==
  \/ \E t \in Tabs, cmd \in Commands : Command(t, cmd)
  \/ \E t \in Tabs :
       \/ Replace(t) \/ Connect(t) \/ Disconnect(t) \/ LoadAnswer(t) \/ LoadArrive(t) \/ Hear(t)
       \/ WholeLoaded(t) \/ WholeStored(t) \/ WholeStoreFailed(t) \/ PartialLanded(t) \/ PartialFailed(t)
  \/ DeviceWrite
  \/ Tick

Spec == Init /\ [][Next]_vars

------------------------------------------------------------------------------
(* The rules. *)

\* docs/design/storage.md:178: while loading, nothing is saved.
NoSaveWhileLoading ==
  \A t \in Tabs : tabs[t].status = "loading" => tabs[t].sent = <<>> /\ tabs[t].pending = NoChange /\ tabs[t].phase = "idle"

\* link.ts:55 and commit caeeb05: storage is read only once connected.
NoReadBeforeConnect ==
  \A t \in Tabs : ~tabs[t].everConnected => tabs[t].load = "idle" /\ tabs[t].phase = "idle" /\ ~tabs[t].subscribed

\* commit caeeb05: an unmounted Run stops listening, even when its load answers later.
NoListenAfterUnmount ==
  \A t \in Tabs : ~tabs[t].connected => ~tabs[t].subscribed

\* link.ts: a record heard while loading waits for the load, so it lands on the record, not on none.
\* Only a listening tab holds one.
HoldsHeardWhileLoading ==
  \A t \in Tabs :
    /\ tabs[t].status = "loading" => tabs[t].mem = Empty
    /\ tabs[t].heldRecord # <<>> => tabs[t].status = "loading" /\ tabs[t].subscribed

\* docs/design/storage-saves/README.md:15: no save writes over a record Waymark cannot read.
NeverOverwriteUnreadable == ~hist.overwrote

\* docs/design/storage-saves/README.md:15: a save does not write over entries this Run did not change.
\* Thread 10: so A's tick survives B's write.
SaveKeepsOthersEntries == ~hist.clobbered

\* Thread 11, most recent wins: the store never takes an entry older than the one it holds,
\* but from a replace, which stores the app's record whole, in place of whatever is stored.
MostRecentStored == ~hist.reverted

\* turnedUnreadable: reported again only after a readable record.
UnreadableReportedOnce == ~hist.double

\* A tab that finished the hint does not show it again, unless it was started or reset since.
NoReshowHere == \A t \in Tabs : ~tabs[t].reshown

\* Thread 10, storage wins: once every save has landed and every tab has heard the latest
\* record, every tab shows what is stored, but for the walkthrough open in it (thread 11).
\* A failed savePartial waits for the tab's next save, so a tab is not quiet while one waits.
Quiet ==
  \A t \in Tabs :
    /\ tabs[t].sent = <<>> /\ tabs[t].phase = "idle" /\ tabs[t].pending = NoChange /\ tabs[t].held = <<>>
    /\ tabs[t].toHear = <<>> /\ ~tabs[t].notified /\ tabs[t].seen = version /\ tabs[t].retry = NoChange

QuietTabsAgree ==
  Quiet /\ stored \in Records =>
    \A t \in Tabs : tabs[t].mem.task = stored.task /\ (IsOpen(tabs[t].mem) \/ SameEntry(tabs[t].mem.w, stored.w))

\* src/run/types.ts:216, connect: "while one is open the Run hears changes made elsewhere".
\* A tab listening will hear of every write made while it was connected, since its load
\* read the record; its own aside when the store does not tell it of those. A record held
\* while loading is heard once the load is in.
HearsEveryWrite ==
  \A t \in Tabs : tabs[t].subscribed /\ tabs[t].owed => tabs[t].notified \/ tabs[t].toHear # <<>> \/ tabs[t].heldRecord # <<>>
=============================================================================
