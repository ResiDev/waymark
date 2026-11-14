# Server rendering

A Run can be made on a server: it touches no `document` or storage until `attach` and `connect`, which you call only in the browser. Draw the server's HTML, and the browser's first render, from `run.getServerSnapshot()`, the state from before storage was read, so the two match. Switch to `getSnapshot()` after hydration. Checklists have `getServerSnapshot()` too.

Make one Run per user. A Run kept in a module on a server would be shared by every request. In the browser, hand it down as your framework does, such as through Svelte's context or Vue's `provide`.
