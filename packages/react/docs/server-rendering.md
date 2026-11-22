# Next.js and server rendering

Waymark's components use hooks, so in the Next.js App Router they must be rendered from client components. Put `<WaymarkRoot>` in a file that starts with `"use client"`, and render it from your layout:

```tsx
// app/guidance.tsx
"use client";

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

`app/layout.tsx` can stay a server component and wrap the page in `<Guidance userId={user.id}>`. Its children can be server components too. Render `<Walkthrough>`, `<Checklist>` and `useChecklist` from client components as well. Waymark recognises a walkthrough or checklist by the object `defineWalkthrough` or `defineChecklists` returned, so a server component can't pass one as a prop, which would hand over a copy: import them where a client component uses them.

On the server, `<WaymarkRoot>` draws no walkthrough and reads no storage, and a checklist shows every task as todo. That way the server's HTML hydrates without a mismatch, but it does mean a server-rendered checklist first appears all todo, then shows the user's progress once the browser has read their record. A localStorage key is read straight after hydration. An adapter that returns a promise takes as long as it takes, and until then user actions wait.

To render the user's real progress on the server, fetch their record there and pass it as `initial`. Waymark then doesn't load it in the browser.

In Route Handlers, Server Actions or other server-only files, import `applyChanges` and `RecordUnreadableError` from `"react-waymark/server"` rather than `"react-waymark"`, so the server bundle doesn't pull in React's client hooks. See [Storage adapters](storage.md#storage-others-write-too-savepartial).
