---- MODULE MCStorage ----
EXTENDS Storage

AllCommands == {"start", "request", "finish", "reset", "tick"}
\* For the conformance walks, which replay every move: start does what request does to a hint with no progress.
FewCommands == {"request", "finish", "tick"}
\* Another device makes the record unreadable, as a newer Waymark would.
NewerVersion == {Unreadable}
NoDevice == {}
NothingStored == {Empty}

\* QuietTabsAgree, but a tab may keep an entry newer than the stored one, as heardWalkthroughProgress
\* does (record.ts:60). Holding where QuietTabsAgree breaks pins every break on that one cause.
NewerHere(r) == r.w # None /\ stored.w # None /\ r.w.at > stored.w.at
QuietTabsAgreeButNewer ==
  Quiet /\ stored \in Records =>
    \A t \in Tabs : tabs[t].mem.task = stored.task /\ (IsOpen(tabs[t].mem) \/ SameEntry(tabs[t].mem.w, stored.w) \/ NewerHere(tabs[t].mem))
====
