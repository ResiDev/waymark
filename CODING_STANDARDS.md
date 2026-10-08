## Comments

- Few comments. A comment gives a reason the code has to be this way, when that reason is not obvious from the code itself. Delete comments that only say what the code does.

## Tests

- Test through what the packages' `index.ts` files export. Never export something only for a test. The one exception is a pure function that could only be reached by faking its inputs, like `placement.ts`; say why in a comment.
- Assert what an app can observe: snapshots, events, DOM, calls to its callbacks. Not internal state, and not how the code got there. Spy on DOM calls only to catch a leak nothing else would show, or to make the browser fail in a way a test cannot otherwise cause, like blocked storage.
- Write each test against a specific bug, and prove it: break the code, see the test fail.
- Characterisation tests, which pin current behaviour without a bug in mind, are secondary. Only write them for the public interface, the one place behaviour must stay fixed: event order, the stored format, snapshot identity.
- When a test fails after a refactor, fix the code, not the assertion. Fix bugs test first.
- No `beforeEach`, `afterEach`, `beforeAll` or `afterAll` in a test file. A test sets up what it needs by calling helpers, and each helper undoes what it made with `onTestFinished`, so a test reads top to bottom. Spies are restored by the config's `restoreMocks`, and `src/test/leaks.ts` fails a test that leaves anything on the page or in localStorage.
- Helpers more than one test file could use go in the package's `src/test/`: `dom.ts`, `time.ts`, and `browser.ts` for browser tests only. When two helpers differ, keep both under names that say how.
- Browser tests only for real layout, scrolling, pointers and time. Finish with `pnpm check`.
