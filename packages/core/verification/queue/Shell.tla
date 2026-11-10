------------------------------- MODULE Shell -------------------------------
(***************************************************************************)
(* The imperative shell around update(): the queue and its drain           *)
(* (packages/core/src/queue.ts), the order a change's effects run in       *)
(* (perform in src/run/run.ts), subscribers (src/subscribe.ts), attach     *)
(* (src/run/page.ts) and connect (src/storage/link.ts).                    *)
(*                                                                         *)
(* update() is a box (Box below): a Msg gives new facts, whether the       *)
(* snapshot changed, and how many events to tell. It is fitted to the one  *)
(* walkthrough conformance.test.ts drives: many steps, each with a waymark *)
(* on the page and no advance condition, and step 0's selector possibly    *)
(* one that does not parse.                                                *)
(*                                                                         *)
(* JavaScript runs one call at a time, to the end. `todo` is the call      *)
(* stack, flattened: its head runs next, and a call made in place is put   *)
(* in front of what it returns to. Frames that catch or clean up (`drain`, *)
(* `subRet`, `appRet`, `attachRet`, `takeFin`, `rethrow`, `top`) also act  *)
(* when an exception, `exc`, unwinds through them.                         *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
  SyncChoices,     \* the adapter's load answers at once (TRUE) or with a promise
  BadChoices,      \* step 0's selector does not parse, so querySelector throws
  HandlerChoices,  \* "default": callbackThrew throws; "handles": the app's handler takes it
  Scripts1,        \* what listener 1 may do: see Call
  Scripts2,        \* what listener 2 may do
  EventScripts,    \* what onEvent may do
  Budget,          \* how many calls the app and the browser make
  Cap              \* counters only conformance reads stop here

Listeners == {1, 2}
NoExc == [k |-> "none", n |-> 0]
RawExc == [k |-> "raw", n |-> 1]
NoErrors == [n |-> 0, raw |-> FALSE]
NoSub == [done |-> FALSE, threw |-> FALSE, kept |-> FALSE, own |-> FALSE]
Min(a, b) == IF a < b THEN a ELSE b

VARIABLES
  sync, bad, handler, script, onEvent,  \* what the app wired up, fixed for a behaviour
  queue,      \* queue.ts queue: work waiting, oldest first
  draining,   \* queue.ts draining
  errors,     \* queue.ts errors: how many the drain keeps for its end, n, and whether
              \* one is raw, so that a raw one kept alone is thrown as itself
  todo,       \* the call stack: Head runs next
  exc,        \* an exception unwinding the stack, or NoExc
  f,          \* the facts update() keeps: see Box
  version,    \* how many times the Run's snapshot has changed
  stepNo,     \* how many Msgs have run, so each change has a name
  listeners,  \* listeners[l]: l is in subscribe.ts listeners. 1 is always added before 2,
              \* so the Set's order is 1, 2
  calls,      \* calls[l]: how many times listener l was called, up to Cap
  subscribed, \* subscribed[l]: the app or a listener has handed l to subscribe
  pg,         \* page.ts: attachments, the detach functions the app holds, the input listener open
  ln,         \* link.ts: connections, the disconnects the app holds, asked, hearing, a load in flight
  budget,     \* calls the app and the browser may still make
  result,     \* what the app's last call threw: NoExc, RawExc, or n app errors
  evDone,     \* onEvent's "send" has sent
  events,     \* how many times onEvent was called, up to Cap
  handled,    \* how many callbackThrew problems the app's handler took, up to Cap
  \* History, for the properties
  ownThrew,   \* ownThrew[l]: listener l's first call threw
  subResult,  \* subResult[l]: how subscribe(l) returned
  unsurfaced, \* errors raised and not yet thrown to the app or handled
  unprocessed,\* Msgs queued and not yet run
  staleCall,  \* a listener was called with a snapshot other than getSnapshot()
  staleEvent, \* a callback of a change ran after another Msg ran
  lookLate    \* work a change's callback queued ran before the look that change queued

wired == <<sync, bad, handler, script, onEvent>>
vars == <<sync, bad, handler, script, onEvent, queue, draining, errors, todo, exc, f, version,
          stepNo, listeners, calls, subscribed, pg, ln, budget, result, evDone, events, handled,
          ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

(***************************************************************************)
(* Frames of the call stack and items of the queue, as uniform records.    *)
(***************************************************************************)
T(t) == [t |-> t, l |-> 0, s |-> 0, v |-> 0, m |-> "", e |-> NoExc]
Drain == T("drain")
Top == T("top")
Msg(m, by) == [w |-> "msg", m |-> m, l |-> 0, by |-> by]
LookItem(by) == [w |-> "look", m |-> "", l |-> 0, by |-> by]
CallItem(l) == [w |-> "call", m |-> "", l |-> l, by |-> 0]

\* Who queues: a callback of the change running now, or the app from outside a drain.
By == IF draining THEN stepNo ELSE 0

\* queue.ts run: queued; a drain starts unless one runs. Gives the new queue and stack.
Send(item, rest) ==
  [q |-> Append(queue, item),
   todo |-> IF draining THEN rest ELSE <<Drain>> \o rest]

(***************************************************************************)
(* The box: update() for this walkthrough. Checked against the real one by *)
(* conformance.test.ts.                                                    *)
(*   loading  the record is not in; commands wait on `held`                *)
(*   open     the walkthrough is open, at `step`                           *)
(*   looked   the step state was looked at (page.ts look)                  *)
(*   started  the step state told `start`; carried to the next step        *)
(*   found    the step's waymark was found; a new step searches again      *)
(***************************************************************************)
Opened(g) == [g EXCEPT !.open = TRUE, !.step = 0, !.looked = FALSE, !.started = FALSE, !.found = FALSE]
Advanced(g) == [g EXCEPT !.step = @ + 1, !.found = FALSE]

RECURSIVE ApplyHeld(_, _)
ApplyHeld(g, hs) ==
  IF hs = <<>> THEN [f |-> g, ev |-> 0]
  ELSE LET h == Head(hs)
           r == IF h = "start" THEN [f |-> IF g.open THEN g ELSE Opened(g), ev |-> 0]
                ELSE IF g.open THEN [f |-> Advanced(g), ev |-> 1] ELSE [f |-> g, ev |-> 0]
           rest == ApplyHeld(r.f, Tail(hs))
       IN [f |-> rest.f, ev |-> r.ev + rest.ev]

\* effects: FALSE when update hands back NO_EFFECTS, so not even syncPage runs.
Box(m) ==
  CASE m \in {"start", "act"} /\ f.loading ->
         [f |-> [f EXCEPT !.held = Append(@, m)], effects |-> FALSE, changed |-> FALSE, ev |-> 0]
    [] m = "start" ->
         IF f.open THEN [f |-> f, effects |-> TRUE, changed |-> FALSE, ev |-> 0]
         ELSE [f |-> Opened(f), effects |-> TRUE, changed |-> TRUE, ev |-> 0]
    [] m = "act" ->
         IF f.open THEN [f |-> Advanced(f), effects |-> TRUE, changed |-> TRUE, ev |-> 1]
         ELSE [f |-> f, effects |-> TRUE, changed |-> FALSE, ev |-> 0]
    [] m = "look" ->
         [f |-> [f EXCEPT !.looked = TRUE, !.found = TRUE, !.started = TRUE],
          effects |-> TRUE, changed |-> ~f.found, ev |-> IF f.started THEN 0 ELSE 1]
    [] m = "attached" -> [f |-> f, effects |-> TRUE, changed |-> FALSE, ev |-> 0]
    [] m = "detached" -> [f |-> [f EXCEPT !.looked = FALSE], effects |-> TRUE, changed |-> FALSE, ev |-> 0]
    [] m = "loaded" ->
         LET r == ApplyHeld(f, f.held)
         IN [f |-> [r.f EXCEPT !.loading = FALSE, !.held = <<>>], effects |-> TRUE, changed |-> TRUE, ev |-> r.ev]

RECURSIVE EventFrames(_, _)
EventFrames(n, s) == IF n = 0 THEN <<>> ELSE <<[T("event") EXCEPT !.s = s]>> \o EventFrames(n - 1, s)

\* run.ts step and perform, in effectsOf's order: syncPage, notifyRun, then events.
\* Every snapshot is worked out before the first effect, so the notify carries it.
RunMsg(m, rest) ==
  LET b == Box(m)
      s == stepNo + 1
      v == IF b.changed THEN version + 1 ELSE version
      effects == IF ~b.effects THEN <<>>
                 ELSE <<[T("sync") EXCEPT !.s = s]>>
                      \o (IF b.changed THEN <<[T("notify") EXCEPT !.s = s, !.v = v]>> ELSE <<>>)
                      \o EventFrames(b.ev, s)
  IN /\ f' = b.f
     /\ version' = v
     /\ stepNo' = s
     /\ todo' = effects \o rest

\* queue.ts errors.push(x): kept for the drain's end.
Keep(e, x) == [n |-> e.n + x.n, raw |-> e.raw \/ x.k = "raw"]

\* queue.ts run's end: one error is thrown as itself, more as one AggregateError.
Thrown(e) == IF e.n = 0 THEN NoExc ELSE IF e.n = 1 /\ e.raw THEN RawExc ELSE [k |-> "app", n |-> e.n]

(***************************************************************************)
(* An app callback threw inside queue.callApp: queue.fail reports it.      *)
(* Unhandled, the default callbackThrew handler throws it again, and       *)
(* queue.invoke keeps it for the drain's end.                              *)
(***************************************************************************)
Raise(throws) ==
  /\ errors' = IF throws /\ handler = "default" THEN Keep(errors, [k |-> "app", n |-> 1]) ELSE errors
  /\ unsurfaced' = IF throws /\ handler = "default" THEN unsurfaced + 1 ELSE unsurfaced
  /\ handled' = IF throws /\ handler = "handles" THEN Min(handled + 1, Cap) ELSE handled

\* subscribe.ts ownThrew: l's own first call threw, and the default handler threw it back.
OwnThrown(l) == ownThrew[l] /\ handler = "default"

Hear(l) == IF ~l.hearing /\ l.connections > 0 /\ ~f.loading THEN [l EXCEPT !.hearing = TRUE] ELSE l

(***************************************************************************)
(* The start                                                               *)
(***************************************************************************)
Init ==
  /\ sync \in SyncChoices
  /\ bad \in BadChoices
  /\ handler \in HandlerChoices
  /\ script \in {[l \in Listeners |-> IF l = 1 THEN a ELSE b] : a \in Scripts1, b \in Scripts2}
  /\ onEvent \in EventScripts
  /\ queue = <<>>
  /\ draining = FALSE
  /\ errors = NoErrors
  /\ todo = <<>>
  /\ exc = NoExc
  /\ f = [loading |-> TRUE, held |-> <<>>, open |-> FALSE, step |-> 0, looked |-> FALSE, started |-> FALSE, found |-> FALSE]
  /\ version = 0
  /\ stepNo = 0
  /\ listeners = [l \in Listeners |-> FALSE]
  /\ calls = [l \in Listeners |-> 0]
  /\ subscribed = [l \in Listeners |-> FALSE]
  /\ pg = [attachments |-> 0, handles |-> 0, open |-> FALSE]
  /\ ln = [connections |-> 0, handles |-> 0, asked |-> FALSE, hearing |-> FALSE, inFlight |-> FALSE]
  /\ budget = Budget
  /\ result = NoExc
  /\ evDone = FALSE
  /\ events = 0
  /\ handled = 0
  /\ ownThrew = [l \in Listeners |-> FALSE]
  /\ subResult = [l \in Listeners |-> NoSub]
  /\ unsurfaced = 0
  /\ unprocessed = 0
  /\ staleCall = FALSE
  /\ staleEvent = FALSE
  /\ lookLate = FALSE

Idle == todo = <<>> /\ ~draining

(***************************************************************************)
(* The app and the browser, only while nothing runs: one call at a time.   *)
(* Each call ends at its Top frame, which takes what it throws.            *)
(***************************************************************************)
App(frames) ==
  /\ Idle /\ budget > 0
  /\ budget' = budget - 1
  /\ todo' = frames \o <<Top>>

\* run.start(tour)
AppStarts ==
  /\ ~f.open /\ "start" \notin {f.held[i] : i \in DOMAIN f.held}
  /\ App(<<[T("send") EXCEPT !.m = "start"]>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* run.act("advance"), from a button outside the popover
AppActs ==
  /\ App(<<T("act")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* run.subscribe(listener 1)
AppSubscribes ==
  /\ ~subscribed[1]
  /\ App(<<[T("subscribe") EXCEPT !.l = 1]>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* run.attach(ui)
AppAttaches ==
  /\ pg.attachments < 2
  /\ App(<<T("attach")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* One of the detach functions attach returned
AppDetaches ==
  /\ pg.handles > 0
  /\ App(<<T("detach")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* run.connect()
AppConnects ==
  /\ ln.connections < 2
  /\ App(<<T("connect")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* One of the disconnect functions connect returned
AppDisconnects ==
  /\ ln.handles > 0
  /\ App(<<T("disconnect")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* An async load's promise settles, as a microtask, outside any drain: link.ts take.
LoadSettles ==
  /\ ln.inFlight
  /\ App(<<T("sendLoaded"), T("takeFin")>>)
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

AppCall == AppStarts \/ AppActs \/ AppSubscribes \/ AppAttaches \/ AppDetaches \/ AppConnects \/ AppDisconnects \/ LoadSettles

(***************************************************************************)
(* The code, one frame at a time.                                          *)
(***************************************************************************)
h == Head(todo)
rest == Tail(todo)
Running(t) == todo # <<>> /\ exc = NoExc /\ h.t = t

\* queue.ts run's loop: the next work. A Msg runs at once (run.ts step).
DrainNext ==
  /\ Running("drain") /\ queue # <<>>
  /\ LET item == Head(queue)
         left == Tail(queue)
     IN /\ queue' = left
        /\ lookLate' = (lookLate \/ (item.w = "msg" /\ item.by > 0 /\
                          \E i \in DOMAIN left : left[i].w = "look" /\ left[i].by = item.by))
        /\ CASE item.w = "msg" ->
                  /\ RunMsg(item.m, todo)
                  /\ unprocessed' = unprocessed - 1
                  /\ exc' = exc /\ unsurfaced' = unsurfaced
             [] item.w = "call" ->
                  /\ todo' = <<[T("call") EXCEPT !.l = item.l, !.m = "queued"]>> \o todo
                  /\ UNCHANGED <<f, version, stepNo, unprocessed, exc, unsurfaced>>
             [] item.w = "look" ->
                  \* page.ts look: only attached, and only a step state not looked at yet.
                  IF pg.attachments = 0 \/ ~f.open \/ f.looked THEN
                    UNCHANGED <<todo, f, version, stepNo, unprocessed, exc, unsurfaced>>
                  ELSE IF bad /\ f.step = 0 THEN
                    \* measure's querySelector throws, outside callApp: a raw throw,
                    \* which the drain's catch keeps (Unwinds).
                    /\ exc' = RawExc /\ unsurfaced' = unsurfaced + 1
                    /\ UNCHANGED <<todo, f, version, stepNo, unprocessed>>
                  ELSE
                    \* sendNow: the look's Msg runs in place.
                    /\ RunMsg("look", todo)
                    /\ UNCHANGED <<unprocessed, exc, unsurfaced>>
  /\ UNCHANGED <<wired, draining, errors, listeners, calls, subscribed, pg, ln, budget, result, evDone, events,
                 handled, ownThrew, subResult, staleCall, staleEvent>>

\* queue.ts run, once the loop is done: the finally, then the errors kept, thrown once.
DrainEnds ==
  /\ Running("drain") /\ queue = <<>>
  /\ draining' = FALSE
  /\ errors' = NoErrors
  /\ exc' = Thrown(errors)
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* A frame that queues a Msg: run.ts send.
SendFrame ==
  /\ Running("send")
  /\ LET r == Send(Msg(h.m, By), rest) IN queue' = r.q /\ todo' = r.todo
  /\ draining' = TRUE
  /\ unprocessed' = unprocessed + 1
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, staleCall, staleEvent, lookLate>>

\* run.ts act with no walkthrough: queued while loading, or for the one open; otherwise nothing.
Act ==
  /\ Running("act")
  /\ IF f.loading \/ f.open
     THEN /\ LET r == Send(Msg("act", By), rest) IN queue' = r.q /\ todo' = r.todo
          /\ draining' = TRUE
          /\ unprocessed' = unprocessed + 1
     ELSE /\ todo' = rest
          /\ UNCHANGED <<queue, draining, unprocessed>>
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, staleCall, staleEvent, lookLate>>

\* page.ts sync: the first look is queued; the input listener follows the facts.
Sync ==
  /\ Running("sync")
  /\ queue' = IF pg.attachments > 0 /\ f.open /\ ~f.looked THEN Append(queue, LookItem(h.s)) ELSE queue
  /\ pg' = [pg EXCEPT !.open = f.open /\ f.looked]
  /\ todo' = rest
  /\ UNCHANGED <<wired, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, ln, budget, result,
                 evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* queue.ts notify: a copy of the listeners, each called while it is still one.
Notify ==
  /\ Running("notify")
  /\ LET c(l) == IF listeners[l] THEN <<[T("call") EXCEPT !.l = l, !.s = h.s, !.v = h.v, !.m = "notify"]>> ELSE <<>>
     IN todo' = c(1) \o c(2) \o rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

(***************************************************************************)
(* A listener's call, inside queue.callApp. Its script runs on its first   *)
(* call only, except that "throw" throws on every call and "throwLater" on *)
(* every call after the first. A first call's script frames end in        *)
(* `appRet`, its catch, as a subscribe among them may throw in place:      *)
(*   none, throw, throwLater, send (run.act), subscribe (listener 2),      *)
(*   connect (run.connect), and sendLater, which calls run.act on its      *)
(*   second call: what code that reacts to a change does.                  *)
(***************************************************************************)
ScriptFrames(s) ==
  CASE s = "send" -> <<T("act")>>
    [] s = "subscribe" -> <<[T("subscribe") EXCEPT !.l = 2]>>
    [] s = "connect" -> <<T("connect")>>
    [] OTHER -> <<>>

\* m: "notify"; "queued", subscribe's first call, run by the drain that subscribe
\* started; or "here", its first call made in place inside a drain. subscribe makes
\* its first call through queue.callAppOrThrow, so what the default handler throws
\* back is thrown in place, not kept.
Call ==
  /\ Running("call")
  /\ IF h.m = "notify" /\ ~listeners[h.l]
     THEN /\ todo' = rest
          /\ UNCHANGED <<errors, exc, calls, ownThrew, unsurfaced, handled, staleCall, staleEvent>>
     ELSE LET l == h.l
              first == calls[l] = 0
              s == script[l]
              throws == s = "throw" \/ (s = "throwLater" /\ ~first)
              ret == <<[T("appRet") EXCEPT !.l = l, !.m = h.m]>>
              frames == IF first /\ ScriptFrames(s) # <<>> THEN ScriptFrames(s) \o ret
                        ELSE IF s = "sendLater" /\ calls[l] = 1 THEN <<T("act")>>
                        ELSE <<>>
          IN /\ calls' = [calls EXCEPT ![l] = Min(@ + 1, Cap)]
             /\ ownThrew' = IF first THEN [ownThrew EXCEPT ![l] = throws] ELSE ownThrew
             /\ staleCall' = (staleCall \/ (h.m = "notify" /\ h.v # version))
             /\ staleEvent' = (staleEvent \/ (h.m = "notify" /\ h.s # stepNo))
             /\ IF h.m = "here" /\ throws /\ handler = "default"
                THEN /\ exc' = [k |-> "app", n |-> 1]
                     /\ unsurfaced' = unsurfaced + 1
                     /\ UNCHANGED <<errors, handled>>
                ELSE /\ Raise(throws)
                     /\ UNCHANGED exc
             /\ todo' = frames \o rest
  /\ UNCHANGED <<wired, queue, draining, f, version, stepNo, listeners, subscribed, pg, ln, budget, result,
                 evDone, events, subResult, unprocessed, lookLate>>

\* The first call's script frames returned.
AppReturns ==
  /\ Running("appRet")
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* onEvent, inside queue.callApp. "throw" throws every time; "send" sends once.
Event ==
  /\ Running("event")
  /\ events' = Min(events + 1, Cap)
  /\ staleEvent' = (staleEvent \/ h.s # stepNo)
  /\ Raise(onEvent = "throw")
  /\ evDone' = (evDone \/ onEvent = "send")
  /\ todo' = (IF onEvent = "send" /\ ~evDone THEN <<T("act")>> ELSE <<>>) \o rest
  /\ UNCHANGED <<wired, queue, draining, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget, result,
                 ownThrew, subResult, unprocessed, staleCall, lookLate>>

(***************************************************************************)
(* subscribe.ts listen: added, then called at once through queue.now: in   *)
(* place inside a drain, or as a drain of its own outside one. What that   *)
(* throws is thrown on, and the listener removed only if it threw itself.  *)
(***************************************************************************)
Subscribe ==
  /\ Running("subscribe")
  /\ listeners' = [listeners EXCEPT ![h.l] = TRUE]
  /\ subscribed' = [subscribed EXCEPT ![h.l] = TRUE]
  /\ IF draining
     THEN /\ todo' = <<[T("call") EXCEPT !.l = h.l, !.m = "here"], [T("subRet") EXCEPT !.l = h.l]>> \o rest
          /\ UNCHANGED <<queue, draining>>
     ELSE /\ queue' = Append(queue, CallItem(h.l))
          /\ draining' = TRUE
          /\ todo' = <<Drain, [T("subRet") EXCEPT !.l = h.l]>> \o rest
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, calls, pg, ln, budget, result, evDone, events, handled,
                 ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

SubReturns ==
  /\ Running("subRet")
  /\ subResult' = [subResult EXCEPT ![h.l] = [done |-> TRUE, threw |-> FALSE, kept |-> listeners[h.l], own |-> OwnThrown(h.l)]]
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget,
                 result, evDone, events, handled, ownThrew, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

(***************************************************************************)
(* page.ts attach and detach                                               *)
(***************************************************************************)
Attach ==
  /\ Running("attach")
  /\ pg' = [pg EXCEPT !.attachments = @ + 1, !.handles = IF pg.attachments > 0 THEN @ + 1 ELSE @]
  /\ IF pg.attachments > 0
     THEN todo' = rest /\ UNCHANGED <<queue, draining, unprocessed>>
     ELSE /\ LET r == Send(Msg("attached", By), <<T("attachRet")>> \o rest) IN queue' = r.q /\ todo' = r.todo
          /\ draining' = TRUE
          /\ unprocessed' = unprocessed + 1
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, listeners, calls, subscribed, ln, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, staleCall, staleEvent, lookLate>>

AttachReturns ==
  /\ Running("attachRet")
  /\ pg' = [pg EXCEPT !.handles = @ + 1]
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, ln, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* detach: the attachment goes; the last one sends `detached`. The app's call spends its handle.
DetachWith(spend, after) ==
  /\ pg' = [pg EXCEPT !.attachments = @ - 1, !.handles = @ - spend]
  /\ IF pg.attachments = 1
     THEN /\ LET r == Send(Msg("detached", By), after) IN queue' = r.q /\ todo' = r.todo
          /\ draining' = TRUE
          /\ unprocessed' = unprocessed + 1
     ELSE todo' = after /\ UNCHANGED <<queue, draining, unprocessed>>

Detach ==
  /\ Running("detach")
  /\ DetachWith(1, rest)
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, listeners, calls, subscribed, ln, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, staleCall, staleEvent, lookLate>>

\* A rethrow frame that was reached: what it holds is thrown on.
Rethrows ==
  /\ Running("rethrow")
  /\ exc' = h.e
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

(***************************************************************************)
(* link.ts connect, take and hear                                          *)
(***************************************************************************)
Connect ==
  /\ Running("connect")
  /\ LET load == ~ln.asked
     IN /\ ln' = [ln EXCEPT !.connections = @ + 1, !.asked = TRUE, !.inFlight = @ \/ (load /\ ~sync)]
        /\ todo' = (IF load /\ sync THEN <<T("sendLoaded"), T("takeFin")>> ELSE <<>>)
                   \o <<T("hear"), T("connRet")>> \o rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* link.ts take: loaded(read), which is run.ts send({ _tag: "loaded" }).
SendLoaded ==
  /\ Running("sendLoaded")
  /\ LET r == Send(Msg("loaded", By), rest) IN queue' = r.q /\ todo' = r.todo
  /\ draining' = TRUE
  /\ unprocessed' = unprocessed + 1
  /\ ln' = [ln EXCEPT !.inFlight = FALSE]
  /\ UNCHANGED <<wired, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, budget, result, evDone,
                 events, handled, ownThrew, subResult, unsurfaced, staleCall, staleEvent, lookLate>>

\* take's finally, and connect's own call: hear.
Hears ==
  /\ todo # <<>> /\ exc = NoExc /\ h.t \in {"takeFin", "hear"}
  /\ ln' = Hear(ln)
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

ConnectReturns ==
  /\ Running("connRet")
  /\ ln' = [ln EXCEPT !.handles = @ + 1]
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

Disconnect ==
  /\ Running("disconnect")
  /\ ln' = [ln EXCEPT !.handles = @ - 1, !.connections = @ - 1, !.hearing = @ /\ ln.connections > 1]
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, budget,
                 result, evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

\* The app's call returns: what it throws reaches the app.
Returns ==
  /\ Running("top")
  /\ result' = NoExc
  /\ todo' = rest
  /\ UNCHANGED <<wired, queue, draining, errors, exc, f, version, stepNo, listeners, calls, subscribed, pg, ln, budget,
                 evDone, events, handled, ownThrew, subResult, unsurfaced, unprocessed, staleCall, staleEvent, lookLate>>

(***************************************************************************)
(* An exception unwinds one frame.                                         *)
(***************************************************************************)
Unwinds ==
  /\ todo # <<>> /\ exc # NoExc
  /\ CASE h.t = "drain" ->
            \* queue.ts run's loop: each work's own catch keeps what it threw, and the
            \* drain goes on to the next work.
            /\ errors' = Keep(errors, exc)
            /\ exc' = NoExc
            /\ UNCHANGED <<todo, queue, draining, pg, ln, listeners, subResult, result, unsurfaced, unprocessed, ownThrew>>
       [] h.t = "subRet" ->
            \* subscribe.ts: the listener is removed if it threw itself, and the error thrown on.
            /\ listeners' = [listeners EXCEPT ![h.l] = @ /\ ~OwnThrown(h.l)]
            /\ subResult' = [subResult EXCEPT ![h.l] = [done |-> TRUE, threw |-> TRUE, kept |-> listeners'[h.l], own |-> OwnThrown(h.l)]]
            /\ todo' = rest
            /\ UNCHANGED <<queue, draining, errors, exc, pg, ln, result, unsurfaced, unprocessed, ownThrew>>
       [] h.t = "appRet" ->
            \* The listener's first call throws on what its subscribe threw: its own throw.
            \* Only the default handler let that one throw, and it throws this one back too:
            \* in place for a first call made "here", else kept for the drain's end.
            /\ ownThrew' = [ownThrew EXCEPT ![h.l] = TRUE]
            /\ IF h.m = "here"
               THEN /\ todo' = rest /\ UNCHANGED <<exc, errors>>
               ELSE /\ exc' = NoExc /\ errors' = Keep(errors, exc) /\ todo' = rest
            /\ UNCHANGED <<queue, draining, pg, ln, listeners, subResult, result, unsurfaced, unprocessed>>
       [] h.t = "attachRet" ->
            \* page.ts attach's catch: detach, then throw on.
            /\ exc' = NoExc
            /\ DetachWith(0, <<[T("rethrow") EXCEPT !.e = exc]>> \o rest)
            /\ UNCHANGED <<errors, ln, listeners, subResult, result, unsurfaced, ownThrew>>
       [] h.t = "takeFin" ->
            \* link.ts take's finally
            /\ ln' = Hear(ln)
            /\ todo' = rest
            /\ UNCHANGED <<queue, draining, errors, exc, pg, listeners, subResult, result, unsurfaced, unprocessed, ownThrew>>
       [] h.t = "top" ->
            /\ result' = exc
            /\ unsurfaced' = unsurfaced - exc.n
            /\ exc' = NoExc
            /\ todo' = rest
            /\ UNCHANGED <<queue, draining, errors, pg, ln, listeners, subResult, unprocessed, ownThrew>>
       [] OTHER ->
            \* No catch here: a rethrow frame's own error is dropped for the newer one.
            /\ todo' = rest
            /\ UNCHANGED <<queue, draining, errors, exc, pg, ln, listeners, subResult, result, unsurfaced, unprocessed, ownThrew>>
  /\ UNCHANGED <<wired, f, version, stepNo, calls, subscribed, budget, evDone, events, handled,
                 staleCall, staleEvent, lookLate>>

Internal ==
  \/ DrainNext \/ DrainEnds \/ SendFrame \/ Act \/ Sync \/ Notify \/ Call \/ Event
  \/ AppReturns \/ Subscribe \/ SubReturns \/ Attach \/ AttachReturns \/ Detach \/ Rethrows
  \/ Connect \/ SendLoaded \/ Hears \/ ConnectReturns \/ Disconnect \/ Returns \/ Unwinds

Next == AppCall \/ Internal

Spec == Init /\ [][Next]_vars /\ WF_vars(Internal)

(***************************************************************************)
(* Properties                                                              *)
(***************************************************************************)
TypeOK ==
  /\ errors.n \in Nat /\ errors.raw \in BOOLEAN /\ unsurfaced \in Nat
  /\ draining \in BOOLEAN
  /\ listeners \in [Listeners -> BOOLEAN]
  /\ pg.attachments \in 0..2 /\ pg.handles \in 0..2
  /\ ln.connections \in 0..3 /\ ln.handles \in 0..ln.connections

\* queue.ts:5, "every callback of a change sees the state that change produced".
CallbacksSeeTheirChange == ~staleEvent

\* update.ts:95, "Every snapshot is worked out before the first effect": a listener
\* called with a snapshot finds getSnapshot() returns it.
NotifiedIsCurrent == ~staleCall

\* queue.ts:7, "errors are thrown once the drain is over": every error raised is
\* thrown to the app, or taken by its handler, by the time the app's call returns.
ErrorsSurface == Idle => unsurfaced = 0

\* Every Msg queued has run by the time the drain is over.
MessagesRun == Idle => unprocessed = 0

\* DESIGN.md:162, a look a change queued runs before work its listeners queue.
LookFirst == ~lookLate

\* GLOSSARY.md:52, "Only an attached Run reacts to the page".
ListenersOnlyWhileAttached == Idle => (pg.open => pg.attachments > 0)

\* Thread 12, option (a): subscribe removes the listener exactly when the listener's
\* own first call throws, inside a drain or out, and then it throws. It may also throw
\* what other work its call set off threw, such as onEvent's error, and keep the listener.
\* Only an unhandled throw counts as its own: with a callbackThrew handler, nothing is removed.
SubscribeOnlyItsOwnThrow ==
  \A l \in Listeners : subResult[l].done =>
    /\ subResult[l].kept = ~subResult[l].own
    /\ subResult[l].own => subResult[l].threw

\* page.ts:225, "The caller gets no detach to call, so nothing may stay attached".
AttachmentsHeld == Idle => pg.attachments = pg.handles

\* The same for connect: a connection the app holds no disconnect for can never close.
ConnectionsHeld == Idle => ln.connections = ln.handles

\* A drain always ends.
QueueEmpties == draining ~> ~draining

\* DESIGN.md:264, "hears other tabs while connected and the record is in".
HearsOnceConnected == (ln.connections > 0 /\ ~f.loading) ~> (ln.hearing \/ ln.connections = 0)
=============================================================================
