import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Snapshot, Stored } from "react-waymark";
import type { Action } from "waymark";
import { App } from "./app";
import { owner, stored } from "./guidance";
import { Lab } from "./lab";
import {
  data,
  EMPTY_DATA,
  inviteOpen,
  log,
  patch,
  route,
  setup,
  useStore,
  watched,
  whatsNewOpen,
  type AppData,
  type Route,
  type Setup,
} from "./state";

/**
 * A lab for the React package: a small app guided by `react-waymark`, and a
 * panel for switching how the package is used while it runs.
 *
 * The setup lives in the query and the route in the hash, so a link is a
 * reproduction:
 *
 *   /react.html?renderer=home&popover=custom&list=headless&slow=1#/decks
 *
 * App data and checklist progress persist in local storage; `reset()` forgets
 * both. The same controls are on `window.playground` for scripts and agents.
 */

function Root() {
  const { strict } = useStore(setup);
  return (
    <>
      <Lab />
      {strict ? (
        <StrictMode>
          <App />
        </StrictMode>
      ) : (
        <App />
      )}
    </>
  );
}

createRoot(document.querySelector("#root")!).render(<Root />);

// ---- what a script drives ----------------------------------------------------------------

declare global {
  interface Window {
    playground: {
      owner: typeof owner;
      /** Read the setup, or change part of it. Changing padding needs a reload to take effect. */
      setup: (changes?: Partial<Setup>) => Setup;
      navigate: (to: Route) => void;
      /** Read the app's data, or change part of it; the owner is updated either way. */
      data: (changes?: Partial<AppData>) => AppData;
      /** Act on the owner's active Run. */
      act: (action: Action) => void;
      /** The active Run's snapshot, or null. */
      snapshot: () => Snapshot | null;
      /** The status line the lab shows: what the mounted renderer sees, or null. */
      watched: () => string | null;
      whatsNew: () => void;
      log: () => string[];
      stored: () => Stored;
      /** A clean slate without a reload: no guidance, no progress, no app data, no log, Home. */
      reset: () => void;
    };
  }
}

window.playground = {
  owner,
  setup: (changes) => {
    if (changes) patch(setup, changes);
    return setup.get();
  },
  navigate: (to) => route.set(to),
  data: (changes) => {
    if (changes) patch(data, changes);
    return data.get();
  },
  act: (action) => owner.getSnapshot().active?.run.act(action),
  snapshot: () => owner.getSnapshot().active?.run.getSnapshot() ?? null,
  watched: () => watched.get(),
  whatsNew: () => whatsNewOpen.set(true),
  log: () => log.get().map((entry) => `${entry.at}ms ${entry.source} ${entry.text}`),
  stored: () => stored.get(),
  reset: () => {
    owner.stop();
    whatsNewOpen.set(false);
    inviteOpen.set(false);
    owner.clear();
    data.set(EMPTY_DATA);
    route.set("home");
    log.set([]);
  },
};
