import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Snapshot, StoredTasks } from "react-waymark";
import type { Action } from "waymark";
import { App } from "./app";
import { owner, stored } from "./guidance";
import { Lab } from "./lab";
import "./tailwind.css";
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
 * The setup lives in the query and the route in the hash, so a link is a
 * reproduction:
 *
 *   /react.html?renderer=home&popover=custom&list=headless&copy=css&slow=1#/decks
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

declare global {
  interface Window {
    playground: {
      owner: typeof owner;
      /** A padding change needs a reload: the owner reads it once, at creation. */
      setup: (changes?: Partial<Setup>) => Setup;
      navigate: (to: Route) => void;
      data: (changes?: Partial<AppData>) => AppData;
      act: (action: Action) => void;
      snapshot: () => Snapshot | null;
      watched: () => string | null;
      whatsNew: () => void;
      log: () => string[];
      stored: () => StoredTasks | null;
      /** Clears guidance, progress, app data and the log without a reload. */
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
