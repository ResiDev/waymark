## Tests

- Test through what the packages' `index.ts` files export. Never export something only for a test. The one exception is a pure function that could only be reached by faking its inputs, like `placement.ts`; say why in a comment.
- Assert what an app can observe: snapshots, events, DOM, calls to its callbacks. Not internal state, and not how the code got there. Spy on DOM calls only to catch a leak nothing else would show.
- Write each test against a specific bug, and prove it: break the code, see the test fail.
- Characterisation tests, which pin current behaviour without a bug in mind, are secondary. Only write them for the public interface, the one place behaviour must stay fixed: event order, the stored format, snapshot identity.
- When a test fails after a refactor, fix the code, not the assertion. Fix bugs test first.
- Browser tests only for real layout, scrolling, pointers and time. Finish with `pnpm check`.
