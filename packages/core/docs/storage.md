# Storage

A storage adapter has:

- `load(): StoredRecord | null | Promise<StoredRecord | null>`: what's stored, or `null` when nothing is. Throws or rejects when it fails.
- One of `save(record: StoredRecord | null)`, which stores the whole record (`null`: delete it), or `savePartial(changes: RecordChanges)`, which applies only what changed. Either can return a promise.
- Optionally `subscribe(listener: (record: StoredRecord | null) => void): () => void`, to hear the record change elsewhere.

Use `save` for storage only this tab writes; Waymark loads again before each save and applies its changes. Use `savePartial` for storage several tabs or devices write. A `RecordUnreadableError` thrown from `savePartial` is reported as `recordUnreadable`; anything else as `storageFailed`. `localStorageAdapter(key)` is the adapter a string `storage` uses.

On the server, `applyChanges(stored: unknown, changes: unknown): StoredRecord | null` applies the changes to the stored record, and returns the record to store, or `null` when nothing is left. Call it inside one transaction, so nothing writes in between, from a route handler with the signed-in user's id:

```ts
import { applyChanges, RecordUnreadableError, type StoredRecord } from "waymark-core";

declare const db: {
  transaction: (work: (tx: {
    get: (userId: string) => Promise<StoredRecord | null>;
    set: (userId: string, record: StoredRecord | null) => Promise<void>;
  }) => Promise<void>) => Promise<void>;
};

// Your PATCH route: answer what applyChanges throws, and leave database errors to your usual handling.
export async function saveWaymarkChanges(userId: string, changes: unknown): Promise<Response> {
  let answer = new Response(null, { status: 204 });
  await db.transaction(async (tx) => {
    let record: StoredRecord | null;
    try {
      record = applyChanges(await tx.get(userId), changes);
    } catch (error) {
      const status = error instanceof RecordUnreadableError ? 409 : 400;
      answer = new Response(error instanceof Error ? error.message : "Unreadable changes.", { status });
      return;
    }
    await tx.set(userId, record);
  });
  return answer;
}
```

`applyChanges` throws a `RecordUnreadableError` when the stored record can't be read, and a plain `Error` when the changes aren't ones Waymark sent. The adapter in the browser, with a GET route that returns the stored record as JSON, or a 404 when there's none:

```ts
import { RecordUnreadableError, type StorageAdapter } from "waymark-core";

export const server: StorageAdapter = {
  load: async () => {
    const response = await fetch("/api/waymark");
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Loading Waymark progress failed: ${response.status}`);
    return response.json();
  },
  savePartial: async (changes) => {
    const response = await fetch("/api/waymark", { method: "PATCH", body: JSON.stringify(changes) });
    if (response.status === 409) throw new RecordUnreadableError(await response.text());
    if (!response.ok) throw new Error(`Saving Waymark progress failed: ${response.status}`);
  },
};
```

Throwing `RecordUnreadableError` again in the browser reports it as `recordUnreadable`, so the app knows the record was the problem and not the network.

## How saving works

- **Saves don't block.** The snapshot changes at once. A failed save is reported as `storageFailed`, and the progress stays in this Run.
- **Other tabs stay in step** while connected. The localStorage adapter hears changes from other tabs; your own adapter can with `subscribe`.
- **Stale progress is dropped.** A walkthrough left part way starts again when its number of steps has changed, or when it was left for longer than its `maxAge`. Each drop is reported as `recordDropped`.

## The record

A `StoredRecord` is plain JSON. You don't need to read it, but this is its shape:

```ts
type StoredRecord = {
  version: 1;
  // Each started walkthrough's progress, by id.
  walkthroughs: Record<string, {
    status: "running" | "finished" | "exited";
    step: number; // from 0
    stepCount: number;
    collapsed: boolean; // put aside as a beacon
    changedAt: number; // epoch ms
  }>;
  // Each task's status by id, once it has left its first todo. "reopened" is one the user took back to todo.
  tasks: Record<string, "done" | "skipped" | "reopened">;
  // When each walkthrough was reset, epoch ms, kept until it next runs. Left out when there are none.
  resets?: Record<string, number>;
};

// What savePartial gets.
type RecordChanges = {
  version: 1;
  // Entries to write, each in place of the one under its id.
  set: { walkthroughs: StoredRecord["walkthroughs"]; tasks: StoredRecord["tasks"]; resets?: Record<string, number> };
  // Ids whose entries go.
  remove: { walkthroughs: string[]; tasks: string[] };
  // Only when the stored record couldn't be read and a recordUnreadable handler replaced it:
  // applyChanges then builds a new record from `set` alone, without reading what's stored.
  replace?: true;
};
```

It's deliberately not shaped like a record, so it can't be stored as one by mistake. Hand it to `applyChanges` and store what that returns.
