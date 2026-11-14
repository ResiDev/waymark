# Why isn't anything showing?

Two steps `react-waymark` takes for you, which a renderer of your own must take:

- **The Run isn't attached.** A walkthrough opens in the snapshot, but Waymark only looks for its waymark while a renderer is attached, so its waymark stays `"searching"` for good. Call `run.attach(...)` where you draw it.
- **The Run has `storage` but isn't connected.** It stays `"loading"` and holds every command until the record is in, which is never. Call `run.connect()`.

And a walkthrough asked for with `requestStart` holds back on purpose when:

- **The user already finished or exited it.** It's in their record. While developing, clear the storage key, or call `run.reset(walkthrough)` and then `requestStart` again: a request is dropped once the walkthrough has progress.
- **The user put it aside.** It shows as a beacon instead, once no other walkthrough is open. Once it's older than its `maxAge`, it's forgotten the next time its progress is read from storage, such as on a reload.
- **Another walkthrough is open.** It waits its turn.

A beacon only shows for a walkthrough the Run has been given: by `requestStart`, `act` naming it, or a checklist holding it being used. After a reload, hand each walkthrough to the Run again, or one the user put aside has no beacon.

`run.start(walkthrough)` opens one whatever its progress, so it's a quick way to check the walkthrough itself works. If the popover sits in the middle of the screen, the step's waymark wasn't found: check the `data-waymark` value matches the step's `waymark`, and that the element is inside `root` with a size.
