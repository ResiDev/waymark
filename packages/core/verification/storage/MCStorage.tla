---- MODULE MCStorage ----
EXTENDS Storage

AllCommands == {"start", "request", "finish", "reset", "tick"}
\* For the conformance walks, which replay every move: start does what request does to a hint with no progress.
FewCommands == {"request", "finish", "tick"}
\* Another device makes the record unreadable, as a newer Waymark would.
NewerVersion == {Unreadable}
NoDevice == {}
NothingStored == {Empty}
====
