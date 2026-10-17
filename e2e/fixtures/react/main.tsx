import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Action, Run, RunSnapshot, StoredRecord } from "react-waymark";
import { App } from "./app";
import { currentRun, forgetRecord, Guidance, onboarding, stored } from "./guidance";
import { Lab } from "./lab";
import "./tailwind.css";
import {
  data,
  EMPTY_DATA,
  inviteOpen,
  log,
  patch,
  route,
  runStatus,
  setup,
  useStore,
  whatsNewOpen,
  type AppData,
  type Route,
  type Setup,
} from "./state";

/**
 * The setup lives in the query and the route in the hash, so a link is a
 * reproduction:
 *
 *   /react.html?popover=custom&list=headless&copy=css&slow=1#/decks
 */

function Root() {
  const { strict } = useStore(setup);
  const app = (
    <Guidance>
      <App />
    </Guidance>
  );
  return (
    <>
      <Lab />
      {strict ? <StrictMode>{app}</StrictMode> : app}
    </>
  );
}

createRoot(document.querySelector("#root")!).render(<Root />);

const run = (): Run => {
  const current = currentRun.get();
  if (!current) throw new Error("No <WaymarkRoot> is mounted.");
  return current;
};

declare global {
  interface Window {
    playground: {
      /** The mounted root's Run. A new root, after a StrictMode switch, a storage change or `reset`, has a new one. */
      run: () => Run;
      /** Its checklists, for `run().checklist(onboarding.checklists.home)`. */
      onboarding: typeof onboarding;
      setup: (changes?: Partial<Setup>) => Setup;
      navigate: (to: Route) => void;
      data: (changes?: Partial<AppData>) => AppData;
      /** Acts on the open walkthrough. */
      act: (action: Action) => void;
      snapshot: () => RunSnapshot;
      /** The open walkthrough, or the beacons to go back to. */
      status: () => string | null;
      /** The app asks for what's new: it waits until nothing is open. */
      whatsNew: () => void;
      log: () => string[];
      stored: () => StoredRecord | null;
      /** Clears the record, app data and the log without a reload, and starts a new Run. */
      reset: () => Promise<void>;
    };
  }
}

window.playground = {
  run,
  onboarding,
  setup: (changes) => {
    if (changes) patch(setup, changes);
    return setup.get();
  },
  navigate: (to) => route.set(to),
  data: (changes) => {
    if (changes) patch(data, changes);
    return data.get();
  },
  act: (action) => run().act(action),
  snapshot: () => run().getSnapshot(),
  status: () => runStatus.get(),
  whatsNew: () => whatsNewOpen.set(true),
  log: () => log.get().map((entry) => `${entry.at}ms ${entry.source} ${entry.text}`),
  stored: () => stored.get(),
  reset: async () => {
    whatsNewOpen.set(false);
    inviteOpen.set(false);
    // Before the new Run, so its checklists first see the empty data.
    data.set(EMPTY_DATA);
    await forgetRecord();
    route.set("home");
    log.set([]);
  },
};
