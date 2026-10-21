# Storage saves

Status: built, in `packages/core/src/storage/` (`adapter.ts`, `link.ts`, `records.ts`). Where the build differs from this design, "As built" at the end says so.

## Problem

Today a custom adapter's `save` gets only what changed, as `StoredChanges`. It has the same keys as `StoredRecord` (`version`, `walkthroughs`, `tasks`), so it looks like the record. The obvious adapter is:

```ts
save: (record) => db.set(id, record)
```

It compiles, because database clients take any value. It writes over every entry the save left out, and stores removed entries as `null`. The next load reads that as a valid record, so the user's progress resets with no error. Only localStorage is safe, because its adapter merges inside its own `save`.

Saves are partial for a reason (commit 9630b85): a save must not write over entries this Run didn't change. That covers another tab's entries, and the real record after this Run's load failed. And no save may write over a record Waymark can't read.

## The design

An adapter gives `save` or `savePartial`, not both. TypeScript refuses both, and refuses neither.

```ts
// save: the whole record. Store it as it is.
{ load: () => db.get(id), save: (record) => db.set(id, record) }

// savePartial: only what changed. Merge it on your server.
{ load, savePartial: (changes) => fetch("/api/waymark", { method: "PATCH", body: JSON.stringify(changes) }) }
// server
await db.transaction(async (tx) => tx.set(id, applyChanges(await tx.get(id), changes)));
```

### save

Before each save, Waymark calls `load`. It checks the result, makes this Run's changes to it, and calls `save` with the whole record. That keeps the protections without the developer merging:

- **Another tab:** the changes land on what is stored now, not on what this Run loaded earlier.
- **A failed load:** if the load before a save fails, nothing is saved, and the changes wait for the next save.
- **An unreadable record:** Waymark doesn't call `save` over a record it can't read, unless the app calls `replace`.

The cost is one load before every save. That's free for localStorage, and cheap for a store in the browser. Over HTTP it means two requests per save.

### savePartial

`savePartial` is what today's `save` does: it gets only what changed. Use it when saves go over the network often enough that the extra request matters. Each save is one small request. The server merges next to the data, in a transaction if two devices may save at once. The developer writes that server route and calls `applyChanges` in it.

### RecordChanges

`RecordChanges` replaces `StoredChanges`, and is shaped unlike a record:

```ts
{ version: 1, set: { walkthroughs: {…}, tasks: {…} }, remove: { walkthroughs: ["intro"], tasks: [] }, replace?: true }
```

- **No nulls:** `set` and `remove` say what happens to each entry.
- **Refused by name if stored:** a stored `RecordChanges` has `set` and `remove` where a record has `walkthroughs` and `tasks`. The next load reports `recordUnreadable` with a message naming the mistake, instead of reading it as a record with entries missing.
- **Checked:** `applyChanges(stored, changes)` takes `changes` as `unknown`, so a server passes `request.json()` straight in. It throws on anything that isn't a Run's changes.

## What catches each mistake

**TypeScript catches:**
- an adapter with both `save` and `savePartial`, or neither
- a `savePartial` that stores `changes` in a column typed as a record
- reading `changes.tasks` as if the changes were a record
- a `save` into a store that can't hold `null`

**Only the running app catches:**
- **Changes stored in an untyped column:** the next load reports `recordUnreadable`, naming the mistake. The entries the save left out are already gone by then. This is loud where today it is silent.
- **A route still written for today's save, behind a `save` adapter:** the route gets a whole record and passes it to `applyChanges`, which throws before writing. The save fails as `storageFailed`.

**Nothing catches:** a `load` under `save` that returns `null` when it actually failed. The next save then holds only this Run's progress. Today, the server's merge would have kept the other entries. This is documented on `load`.

## Changes from today

- **`save`:** now gets the whole record. Existing adapters' `save` must become `savePartial`. A route left unchanged fails loudly, as above.
- **`savePartial`:** new. It gets what today's `save` gets.
- **`StoredChanges`:** becomes `RecordChanges`, with the new shape. `applyChanges` takes it as `unknown`.
- **`localStorageAdapter`:** becomes a `save` adapter. Its own merge goes, because core now loads and merges before calling `save`.
- **A failed save:** under `save`, its changes go again with the next save. Under `savePartial`, they are dropped, as today.
- **Unchanged:** `StoredRecord` and what is stored, `load`, `subscribe`, `RecordUnreadableError` and the 409 path, `initial`, `onChange`, and `replace`.

## Alternatives considered

- **Whole records only:** every save over HTTP costs two requests, with no cheaper option.
- **Partial only, as today:** the mistake stays the default path.
- **Both in one save** (`save.record()` and `save.changes`): to keep the partial from being stored, it relied on objects that throw when serialized, which depends on each database driver.
- **Waymark-owned server half** (`serverStorage` plus `saveChanges`): it is still developer-written server code that calls our merge, so it's `applyChanges` with more API around it.
- **One method per entry** (`setTask`, `setWalkthrough`): more surface, Waymark's schema leaks into every adapter, and every entry becomes its own request over HTTP.

## Open questions

- **Atomic `save` across devices:** two devices on one remote `save` store can each load, then each save, and the second save wins. Is "use `savePartial` with a transaction" enough, or should `save` stores get an optional transaction?
- **Old changes during a deploy:** should `applyChanges` accept today's `StoredChanges` shape for one release, so tabs left open across the deploy keep saving?
- **A `load` that answers `null` after a record was loaded:** should Waymark refuse to save then, to blunt a load that swallows errors? A real clear from another tab would then need a reload.

## As built

- **Two adapter types are exported:** core exports `SaveAdapter` and `SavePartialAdapter` beside `StorageAdapter`. `localStorageAdapter` returns a `SaveAdapter`, so its `save` can be called without narrowing.
- **A `save` adapter saves only once connected:** its saves wait for the Run's first `connect`, because each save loads first, and the Run reads nothing until then. A Run given `initial` holds its changes and saves them when it connects.
- **Checked at runtime:** `createRun` throws on an adapter with both `save` and `savePartial`, or neither. TypeScript refuses both cases; this check catches plain JavaScript and casts.
- **`applyChanges` names the migration mistake:** it throws "they are a whole record" on a record sent where changes were expected, such as from a route still written for today's PATCH.
- **One merge:** a `save` adapter's merge is the same `merge` that `applyChanges` uses, in `storage/records.ts`. The pending changes fold together with `combine`.
