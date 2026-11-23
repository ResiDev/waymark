

https://github.com/user-attachments/assets/462467f1-bc7e-4545-a02f-68b2db074f6d

# Waymark

Walkthroughs and onboarding checklists for web apps. A walkthrough shows a popover beside a part of your app, one step at a time, and can move on by itself when the user does what a step asks. A checklist lists the tasks a new user should get through, and each task can start a walkthrough that shows how.

## Packages

- [`react-waymark`](packages/react#readme): for React 18 and 19. **Start here.** Its README and [docs](packages/react/docs) are the full guide.
- [`waymark-core`](packages/core#readme): the framework-agnostic engine, for building Waymark into another framework or an app without one.

```sh
npm install react-waymark
```

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
