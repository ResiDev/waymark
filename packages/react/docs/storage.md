# Saving progress

## Save progress for each user

Without `storage`, progress lasts only as long as `<WaymarkRoot>` stays mounted. Give `<WaymarkRoot>` a localStorage key, and a `key` for the user:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon, defaultPopover } from "react-waymark";

export function Guidance({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <WaymarkRoot
      key={userId}
      storage={`waymark:${userId}`}
      renderPopover={defaultPopover}
      renderBeacon={defaultBeacon}
    >
      {children}
    </WaymarkRoot>
  );
}
```

Waymark keeps one **record** for each user, in plain JSON: which step they're on in each walkthrough, whether it's collapsed, whether they finished or exited it, and the status of each checklist task. A reload puts them back where they were. `<Walkthrough>` never shows a walkthrough again once the user has finished or exited it.

The root reads `storage` only when it mounts. `key={userId}` makes React mount a new root when the user changes, so the next user doesn't see the last one's progress.

To keep progress on your server or in IndexedDB, pass an adapter instead of a key. See [Storage adapters](#storage-adapters).

## Storage adapters

A string `storage` is a localStorage key. To keep progress anywhere else, pass an adapter: an object with `load`, and either `save` or `savePartial`. Each can be synchronous or return a promise. `load` returns `null` when nothing is stored, and throws or rejects when it fails.

### Storage only this tab writes: `save`

`save` gets the whole record, to store as it is. Before each save, Waymark loads the record again and applies this tab's changes, so it suits storage nothing else writes to between the two:

```tsx
import type { StorageAdapter } from "react-waymark";

export const thisTab: StorageAdapter = {
  load: () => JSON.parse(sessionStorage.getItem("waymark") ?? "null"),
  save: (record) => {
    if (record === null) sessionStorage.removeItem("waymark"); // null once nothing is left
    else sessionStorage.setItem("waymark", JSON.stringify(record));
  },
};
```

### Storage others write too: `savePartial`

For a server the user reaches from several devices, or IndexedDB open in several tabs, use `savePartial`. It gets only what changed, so one tab's save never wipes out another's progress on other walkthroughs and tasks. When two save the same walkthrough, the newer progress wins; when two save the same task, the last save applied wins. It also makes one small request per change, where `save` makes two.

```tsx
import { RecordUnreadableError, type StorageAdapter } from "react-waymark";

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

The GET route returns the signed-in user's stored record as JSON, or a 404 when there's none. For the PATCH route, apply the changes to the stored record with `applyChanges`, inside one transaction, so nothing writes in between. Call this from your route handler, with the signed-in user's id:

```tsx
import { applyChanges, RecordUnreadableError, type StoredRecord } from "react-waymark";

// Your database: a transaction that reads and writes one user's record.
declare const db: {
  transaction: <T>(work: (tx: {
    get: (userId: string) => Promise<StoredRecord | null>;
    set: (userId: string, record: StoredRecord | null) => Promise<void>;
  }) => Promise<T>) => Promise<T>;
};

export async function saveWaymarkChanges(request: Request, userId: string): Promise<Response> {
  let changes: unknown;
  try {
    changes = await request.json();
  } catch {
    return new Response("The body isn't JSON.", { status: 400 });
  }
  return db.transaction(async (tx) => {
    const stored = await tx.get(userId);
    let record: StoredRecord | null;
    try {
      record = applyChanges(stored, changes);
    } catch (error) {
      // Only applyChanges's own errors are answered here. A database error is left to your usual handling.
      const status = error instanceof RecordUnreadableError ? 409 : 400;
      return new Response(error instanceof Error ? error.message : "Unreadable changes.", { status });
    }
    await tx.set(userId, record); // null once nothing is left
    return new Response(null, { status: 204 });
  });
}
```

`applyChanges` checks what it's given. It throws a `RecordUnreadableError` when the stored record can't be read, which the route answers with a 409 and the adapter above throws again, so the app knows the record was the problem and not the network. It throws a plain `Error` when the changes aren't ones Waymark sent, answered here with a 400.

Never store the changes themselves in place of the record. They list only what changed, so everything else would be lost.

### How saving works

- **Nothing is read on the server.** `<WaymarkRoot>` connects to storage in the browser. Until the record is in, user actions and your commands wait, then run in order.
- **Saves don't block.** A click on Next moves on at once. A failed save is reported as `storageFailed`, and the progress stays in this tab.
- **Other tabs stay in step.** The localStorage adapter hears changes from other tabs. Your own adapter can do the same with a `subscribe(listener)` method.
- **Stale progress is dropped.** A walkthrough left part way starts again when its number of steps has changed, or when the user left it for longer than its `maxAge`. Finished and exited walkthroughs stay that way.
- **A record you already have** can be passed as `initial`, and Waymark won't load from storage. `onChange` hears the whole record each time it changes.
