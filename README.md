

https://github.com/user-attachments/assets/462467f1-bc7e-4545-a02f-68b2db074f6d

# Waymark

Walkthroughs and checklists for web apps.

Steps can advance automatically, or unlock Next, when the user clicks an element, triggers a DOM event, or meets a condition in your app. Clicking away collapses a walkthrough into a pulsing beacon on that element, so the user can come back to the same step later. Progress persists across reloads in `localStorage` or your own backend. Checklists track tasks that can launch a walkthrough and tick themselves off from your app's state.

Zero dependencies in core (~16 kB gzipped; ~19 to 23 kB for React with built-in UI and no library CSS to import). Idle when nothing is showing, with built-in events for analytics.

```sh
npm install react-waymark
```

```tsx
import { Walkthrough, WaymarkRoot, defaultBeacon, defaultPopover, defineWalkthrough } from "react-waymark";

const welcome = defineWalkthrough({
  id: "welcome",
  steps: [
    { waymark: "search", title: "Search", content: "Find any project from here." },
    { waymark: "new-project", advance: "click", content: "Click here to start your first project." },
  ],
});

export function App() {
  return (
    <WaymarkRoot storage="waymark:user-1" renderPopover={defaultPopover} renderBeacon={defaultBeacon}>
      <input data-waymark="search" placeholder="Search projects" />
      <button data-waymark="new-project">New project</button>
      <Walkthrough walkthrough={welcome} />
    </WaymarkRoot>
  );
}
```

## Packages

- [`react-waymark`](packages/react#readme): for React 18 and 19. **Start here.** Its README and [docs](packages/react/docs) are the full guide.
- [`waymark-core`](packages/core#readme): the framework-agnostic engine, for building Waymark into another framework or an app without one.

## Developing

```sh
pnpm install
pnpm setup:browser   # once, to install Chromium for the browser tests
pnpm check           # types, lint, unit and browser tests
pnpm dev:react       # the React test fixtures, in a browser
pnpm size            # bundle sizes, which fail over their budgets
```

The React package's tests run on React 18 and 19. [CODING_STANDARDS.md](CODING_STANDARDS.md) has the rules for code and tests, [GLOSSARY.md](GLOSSARY.md) defines the project's words, and [docs/design](docs/design) explains why the trickier parts work the way they do.

## Licence

MIT
