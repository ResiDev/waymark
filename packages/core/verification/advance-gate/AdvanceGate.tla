---------------------------- MODULE AdvanceGate ----------------------------
(***************************************************************************)
(* The advance gate and the Location of one open walkthrough of two steps. *)
(* packages/core/src/run/rules.ts holds the rules this module copies;       *)
(* packages/core/src/run/walkthroughs.ts opens, collapses and resumes; the  *)
(* page (packages/core/src/run/page.ts) and the user are the environment.   *)
(* One action is one Msg through update() in packages/core/src/run/update.ts.*)
(* Time is in ticks of 250ms, the TickMs of conformance.test.ts.            *)
(***************************************************************************)
EXTENDS Integers, Sequences

CONSTANTS FirstSteps, SecondSteps

LostAfter    == 1   \* LOST_AFTER, 200ms
WaitingAfter == 2   \* WAITING_AFTER, 500ms
MissingAfter == 3   \* the steps' missingAfterMs, 750ms
TimeCap      == 3
DelayCap     == 1

Kinds == {"none", "click", "event", "state"}
StepConfigs == [kind : Kinds, waymark : BOOLEAN, then : {"advance", "unlock"}, delay : 0..DelayCap]
Locations == {"absent", "searching", "waiting", "found", "lost", "missing"}
Gates == {"locked", "holding", "met", "unlocked"}
PageStates == {"none", "hidden", "shown"}

VARIABLES
  cfg,         \* <<first step, second step>>: the walkthrough's definition
  page,        \* page[i]: step i-1's waymark element is not in the page, has an empty box, or shows
  holds,       \* what a state check returns now
  attached,
  status,      \* "running" | "finished"
  step,        \* the step index, from 0
  collapsed,
  start,       \* StepState.start
  looked,      \* StepState.looked
  gate,        \* StepState.gate._tag
  gateAge,     \* ticks since gate.since, while holding or met
  location,    \* StepState.waymark.location.status
  unseenFor,   \* ticks since waymark.unseenSince; -1 while it is undefined
  seen,        \* StepState.waymark.element is not null
  inbox,       \* <<>> or one click or event, sent from a callback, waiting in the queue
  met,         \* history: a message or read from this showing met the condition
  left         \* history: the last forward move from a step, and whether it was earned

vars == <<cfg, page, holds, attached, status, step, collapsed, start, looked, gate, gateAge,
          location, unseenFor, seen, inbox, met, left>>

Cfg == cfg[step + 1]
Open == status = "running" /\ ~collapsed
Gone == location \in {"lost", "missing"}
Gated == Cfg.kind # "none"
Min(a, b) == IF a < b THEN a ELSE b

\* rules.ts canAdvance
CanAdvance == gate = "unlocked" \/ Gone

\* rules.ts needsAdvanceRead
NeedsAdvanceRead(asLooked) ==
  (looked \/ asLooked) /\ start = "started" /\ (gate = "met" \/ (gate # "unlocked" /\ Cfg.kind = "state"))

\* rules.ts liveWatchers, while open
FrameOn == attached /\ Open /\ looked /\ (Cfg.waymark \/ NeedsAdvanceRead(FALSE))
InputOn == attached /\ Open /\ looked
EventsOn == InputOn /\ seen /\ gate # "unlocked" /\ Cfg.kind = "event"

\* rules.ts enter and unseenWaymark: a step's gate and Location as it shows.
Fresh(c) == [gate |-> IF c.kind = "none" THEN "unlocked" ELSE "locked",
             location |-> IF c.waymark THEN "searching" ELSE "absent"]

\* The step state of a showing, as a record, so one rule can hand it to the next.
Now == [start |-> start, looked |-> looked, gate |-> gate, gateAge |-> gateAge,
        location |-> location, unseenFor |-> unseenFor, seen |-> seen]

\* rules.ts seeWaymark, for a step that has a waymark, given what the page shows now.
SeeWaymark(s, shows) ==
  IF shows = "shown" THEN [s EXCEPT !.location = "found", !.unseenFor = -1, !.seen = TRUE]
  ELSE LET el == shows = "hidden" IN
    IF s.location \in {"lost", "missing"} THEN [s EXCEPT !.unseenFor = -1, !.seen = el]
    ELSE LET since == IF s.unseenFor = -1 THEN 0 ELSE s.unseenFor IN
      IF s.location = "found" THEN
        IF since < LostAfter THEN [s EXCEPT !.unseenFor = since, !.seen = el]
        ELSE [s EXCEPT !.location = "lost", !.unseenFor = -1, !.seen = el]
      ELSE IF since >= MissingAfter THEN [s EXCEPT !.location = "missing", !.unseenFor = -1, !.seen = el]
      ELSE [s EXCEPT !.location = IF since < WaitingAfter THEN s.location ELSE "waiting", !.unseenFor = since, !.seen = el]

\* rules.ts checked
Checked(g, h) == IF g = "holding" THEN (IF h THEN "holding" ELSE "locked")
                 ELSE IF g = "locked" /\ h THEN "holding" ELSE g

\* The walkthrough after a rule: either still on this step, with step state s, or moved on.
\* box: what waits in the queue after the rule, if the showing stays.
Stay(s, m, box) ==
  /\ start' = s.start /\ looked' = s.looked /\ gate' = s.gate
  /\ gateAge' = IF s.gate \in {"holding", "met"} THEN s.gateAge ELSE 0
  /\ location' = s.location /\ unseenFor' = s.unseenFor /\ seen' = s.seen
  /\ met' = m /\ inbox' = box
  /\ UNCHANGED <<status, step, collapsed, left>>

Stale(box) == [i \in DOMAIN box |-> [box[i] EXCEPT !.fresh = FALSE]]

\* rules.ts enter: a new showing, with a new showingId, carrying start and looked.
Enter(to, s, box) ==
  LET f == Fresh(cfg[to + 1]) IN
  /\ step' = to
  /\ start' = s.start /\ looked' = s.looked /\ gate' = f.gate /\ gateAge' = 0
  /\ location' = f.location /\ unseenFor' = -1 /\ seen' = FALSE
  /\ met' = FALSE
  /\ inbox' = Stale(box)

\* rules.ts advanceStep. earned: the step had no condition, met it, or lost its waymark.
AdvanceStep(s, m, how, box) ==
  /\ left' = [how |-> how, earned |-> ~Gated \/ m \/ s.location \in {"lost", "missing"}]
  /\ collapsed' = FALSE
  /\ IF step + 1 < Len(cfg)
     THEN status' = "running" /\ Enter(step + 1, s, box)
     ELSE /\ status' = "finished"
          /\ start' = "pending" /\ looked' = FALSE /\ gate' = "locked" /\ gateAge' = 0
          /\ location' = "absent" /\ unseenFor' = -1 /\ seen' = FALSE /\ met' = FALSE
          /\ inbox' = Stale(box) /\ UNCHANGED step

\* rules.ts whenDue, with age the ticks since gate.since as the rule reads it.
WhenDue(s, m, age, box) ==
  IF s.gate \in {"locked", "unlocked"} \/ age < Cfg.delay THEN Stay(s, m, box)
  ELSE IF Cfg.then = "advance" THEN AdvanceStep(s, m, "by itself", box)
  ELSE Stay([s EXCEPT !.gate = "unlocked"], m, box)

\* rules.ts observeAdvance
ObserveAdvance(s, h, m) ==
  IF s.start # "started" \/ s.gate = "unlocked" THEN Stay(s, m, inbox)
  ELSE LET g == Checked(s.gate, h)
           t == IF g = s.gate THEN s ELSE [s EXCEPT !.gate = g, !.gateAge = 0]
       IN WhenDue(t, m, t.gateAge, inbox)

\* rules.ts observe, on one read of the page: the waymark if the step has one, the check if it is needed.
Observe(s, asLooked) ==
  LET seenNow == IF Cfg.waymark THEN SeeWaymark(s, page[step + 1]) ELSE s
      reads == NeedsAdvanceRead(asLooked)
      h == reads /\ Cfg.kind = "state" /\ holds
      m == met \/ (h /\ s.start = "started")
  IN IF reads THEN ObserveAdvance(seenNow, h, m) ELSE Stay(seenNow, m, inbox)

\* rules.ts satisfy. Time does not pass while a message waits, so it is sent now.
\* fresh: the message was sent during this showing, so it meets the condition.
Satisfy(box, fresh) ==
  IF start # "started" THEN Stay(Now, met, box)
  ELSE IF gate = "locked" THEN WhenDue([Now EXCEPT !.gate = "met", !.gateAge = 0], met \/ fresh, 0, box)
  ELSE WhenDue(Now, met \/ fresh, gateAge, box)

Env == UNCHANGED <<cfg, page, holds, attached>>
Calm == inbox = <<>>

----------------------------------------------------------------------------
\* The Run reads the page.

\* page.ts look, the first read of a showing once attached
Look ==
  /\ attached /\ Open /\ ~looked
  /\ LET s == [Now EXCEPT !.looked = TRUE] IN
     Observe([s EXCEPT !.start = "started"], TRUE)
  /\ Env

\* page.ts openFrame: a frame's read
Frame ==
  /\ Calm /\ FrameOn
  /\ Observe(Now, FALSE)
  /\ Env

Tick ==
  /\ Calm
  /\ unseenFor' = IF unseenFor = -1 THEN -1 ELSE Min(unseenFor + 1, TimeCap)
  /\ gateAge' = IF gate \in {"holding", "met"} THEN Min(gateAge + 1, DelayCap) ELSE gateAge
  /\ UNCHANGED <<cfg, page, holds, attached, status, step, collapsed, start, looked, gate, location, seen, inbox, met, left>>

----------------------------------------------------------------------------
\* The page and the app.

PageChanges ==
  /\ Calm
  /\ \E i \in 1..Len(cfg), v \in PageStates :
       /\ v # page[i]
       /\ page' = [page EXCEPT ![i] = v]
  /\ UNCHANGED <<cfg, holds, attached, status, step, collapsed, start, looked, gate, gateAge, location, unseenFor, seen, inbox, met, left>>

AppStateFlips ==
  /\ Calm
  /\ holds' = ~holds
  /\ UNCHANGED <<cfg, page, attached, status, step, collapsed, start, looked, gate, gateAge, location, unseenFor, seen, inbox, met, left>>

Attach ==
  /\ Calm /\ ~attached /\ attached' = TRUE
  /\ UNCHANGED <<cfg, page, holds, status, step, collapsed, start, looked, gate, gateAge, location, unseenFor, seen, inbox, met, left>>

\* rules.ts detach
Detach ==
  /\ attached /\ attached' = FALSE
  /\ IF Open
     THEN Stay([Now EXCEPT !.looked = FALSE, !.unseenFor = -1, !.gate = IF gate = "holding" THEN "locked" ELSE gate], met, inbox)
     ELSE UNCHANGED <<status, step, collapsed, start, looked, gate, gateAge, location, unseenFor, seen, inbox, met, left>>
  /\ UNCHANGED <<cfg, page, holds>>

----------------------------------------------------------------------------
\* The user. A pointer click on the waymark counts as one once the Run holds its
\* element, or inside the rect a found waymark keeps (input.ts whereClicked).
\* Before either, it is a click away.

ClickOnWaymark == [type |-> "click", hit |-> IF seen \/ location = "found" THEN "waymark" ELSE "away", fresh |-> TRUE]
CanClickWaymark == Calm /\ InputOn /\ page[step + 1] = "shown"
CanFire == Calm /\ EventsOn /\ page[step + 1] # "none"

\* walkthroughs.ts follow on a collapse: settle drops the open step state.
Collapse(box) ==
  /\ collapsed' = TRUE
  /\ start' = "pending" /\ looked' = FALSE /\ gate' = "locked" /\ gateAge' = 0
  /\ location' = "absent" /\ unseenFor' = -1 /\ seen' = FALSE /\ met' = FALSE
  /\ inbox' = Stale(box)
  /\ UNCHANGED <<status, step, left>>

\* rules.ts apply, for a click or an event that is fresh when it arrives or comes from an earlier showing.
Arrive(msg, box) ==
  IF msg.type = "click" /\ msg.hit = "away" THEN Collapse(box)
  ELSE IF ~msg.fresh THEN Stay(Now, met, box)
  ELSE IF msg.type = "click" THEN (IF Cfg.kind = "click" THEN Satisfy(box, msg.fresh) ELSE Stay(Now, met, box))
  ELSE IF Cfg.kind = "event" THEN Satisfy(box, msg.fresh) ELSE Stay(Now, met, box)

UserClicksWaymark == CanClickWaymark /\ Arrive(ClickOnWaymark, inbox) /\ Env

WaymarkFires == CanFire /\ Satisfy(inbox, TRUE) /\ Env

UserClicksWaymarkQueued == CanClickWaymark /\ Stay(Now, met, <<ClickOnWaymark>>) /\ Env

WaymarkFiresQueued == CanFire /\ Stay(Now, met, <<[type |-> "event", hit |-> "none", fresh |-> TRUE]>>) /\ Env

QueuedArrives ==
  /\ inbox # <<>>
  /\ LET msg == Head(inbox) IN
     IF Open THEN Arrive(msg, Tail(inbox))
     ELSE /\ inbox' = Tail(inbox)
          /\ UNCHANGED <<status, step, collapsed, start, looked, gate, gateAge, location, unseenFor, seen, met, left>>
  /\ Env

UserNext ==
  /\ Open
  /\ IF CanAdvance THEN AdvanceStep(Now, met, "on Next", inbox) ELSE Stay(Now, met, inbox)
  /\ Env

UserBack ==
  /\ Open /\ step > 0
  /\ Enter(step - 1, Now, inbox)
  /\ UNCHANGED <<status, collapsed, left>>
  /\ Env

\* Escape, or a click away, with the default dismiss
UserCollapses == Open /\ Collapse(inbox) /\ Env

\* walkthroughs.ts open, from a beacon: a new showing that has not looked or started
UserResumes ==
  /\ status = "running" /\ collapsed
  /\ collapsed' = FALSE
  /\ Enter(step, [start |-> "resuming", looked |-> FALSE], inbox)
  /\ UNCHANGED <<status, left>>
  /\ Env

UserStartsAgain ==
  /\ status = "finished"
  /\ status' = "running" /\ collapsed' = FALSE
  /\ Enter(0, [start |-> "pending", looked |-> FALSE], inbox)
  /\ UNCHANGED left
  /\ Env

Init ==
  /\ cfg \in {<<a, b>> : a \in FirstSteps, b \in SecondSteps}
  /\ page \in [1..2 -> PageStates]
  /\ holds = FALSE
  /\ attached = FALSE
  /\ status = "running" /\ step = 0 /\ collapsed = FALSE
  /\ LET f == Fresh(cfg[1]) IN
     /\ start = "pending" /\ looked = FALSE /\ gate = f.gate /\ gateAge = 0
     /\ location = f.location /\ unseenFor = -1 /\ seen = FALSE
  /\ inbox = <<>>
  /\ met = FALSE
  /\ left = [how |-> "none", earned |-> TRUE]

Next ==
  \/ Look \/ Frame \/ Tick
  \/ PageChanges \/ AppStateFlips \/ Attach \/ Detach
  \/ UserClicksWaymark \/ WaymarkFires \/ UserClicksWaymarkQueued \/ WaymarkFiresQueued \/ QueuedArrives
  \/ UserNext \/ UserBack \/ UserCollapses \/ UserResumes \/ UserStartsAgain

\* What the Run does by itself: its frames, its first look, time, and the queue.
RunActs == Look \/ Frame \/ Tick \/ QueuedArrives

Spec == Init /\ [][Next]_vars /\ WF_vars(Look) /\ WF_vars(Frame) /\ WF_vars(Tick) /\ WF_vars(QueuedArrives)

----------------------------------------------------------------------------
\* The rules.

TypeOK ==
  /\ cfg \in StepConfigs \X StepConfigs
  /\ page \in [1..2 -> PageStates]
  /\ status \in {"running", "finished"} /\ step \in 0..1
  /\ gate \in Gates /\ location \in Locations
  /\ unseenFor \in -1..TimeCap /\ gateAge \in 0..DelayCap

\* The open snapshot's canAdvance: Next shows as enabled.
NextEnabled == Open /\ CanAdvance

\* Next shows as enabled on a step with an advance condition only once this
\* showing met the condition, or while its waymark is lost or missing.
NextOnlyWhenEarned == NextEnabled => (~Gated \/ met \/ Gone)

\* The walkthrough leaves a step with a condition, on Next or by itself, only
\* once this showing met the condition, or its waymark was lost or missing.
LeavesOnlyWhenEarned == left.earned

\* The waymark the condition needs is not on the page: a click or an event
\* needs one shown, and a step that points at one needs it shown.
CannotBeMet ==
  /\ Open /\ attached /\ Gated
  /\ IF Cfg.waymark THEN page[step + 1] # "shown" ELSE Cfg.kind \in {"click", "event"}

\* Once the user, the page and the app wait, and only the Run acts: while the
\* condition cannot be met, Next unlocks in time.
NeverStuck == <>[][RunActs]_vars => (CannotBeMet ~> (NextEnabled \/ ~CannotBeMet))

=============================================================================
