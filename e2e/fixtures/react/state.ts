import { useSyncExternalStore } from "react";

/**
 * Everything the page holds outside React: the lab's setup, the app's route
 * and data, and the event log. A remount (StrictMode switched, a renderer
 * moved) loses none of it, and `window.playground` reads and drives the same
 * stores the components do.
 */

export type Store<T> = Readonly<{
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}>;

/** `onSet` runs before listeners, so a reader never sees the value unsaved. */
export function createStore<T>(initial: T, onSet?: (next: T) => void): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      onSet?.(next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const useStore = <T>(store: Store<T>): T =>
  useSyncExternalStore(store.subscribe, store.get, store.get);

export const patch = <T extends object>(store: Store<T>, changes: Partial<T>) =>
  store.set({ ...store.get(), ...changes });

const oneOf = <T extends string>(allowed: readonly T[], value: string | null): T =>
  allowed.find((option) => option === value) ?? allowed[0]!;

// ---- the lab's setup: how the React package is used on this page -------------------

export const setupOptions = {
  /** The owner's guidance renderer: the library's popover, or one passed as `renderPopover`. */
  popover: ["default", "custom"],
  /** How the home checklist is drawn: `<Checklist>`, restyled, with `renderRow`, or `useChecklist`. */
  list: ["default", "styled", "rows", "headless"],
  /** Where `<Walkthrough checklists>` is mounted. `home` unmounts it whenever you leave Home. */
  renderer: ["root", "home", "none"],
} as const;

export type Setup = Readonly<{
  strict: boolean;
  popover: (typeof setupOptions.popover)[number];
  list: (typeof setupOptions.list)[number];
  renderer: (typeof setupOptions.renderer)[number];
  /** The decks page loads for 1.5s first, so its Waymarks mount late. */
  slow: boolean;
  /** The halo, in px. The owner reads it once, at creation: changing it reloads. */
  padding: number;
  /** The lab panel; off leaves only the app, for screenshots. */
  lab: boolean;
}>;

const DEFAULT_PADDING = 8;

const readSetup = (): Setup => {
  const q = new URLSearchParams(location.search);
  const padding = Number(q.get("padding") ?? DEFAULT_PADDING);
  return {
    strict: q.get("strict") !== "0",
    popover: oneOf(setupOptions.popover, q.get("popover")),
    list: oneOf(setupOptions.list, q.get("list")),
    renderer: oneOf(setupOptions.renderer, q.get("renderer")),
    slow: q.get("slow") === "1",
    padding: Number.isFinite(padding) ? padding : DEFAULT_PADDING,
    lab: q.get("lab") !== "0",
  };
};

/** Only what differs from the defaults, so a link reads as what is special about it. */
const writeSetup = (setup: Setup) => {
  const q = new URLSearchParams();
  if (!setup.strict) q.set("strict", "0");
  if (setup.popover !== "default") q.set("popover", setup.popover);
  if (setup.list !== "default") q.set("list", setup.list);
  if (setup.renderer !== "root") q.set("renderer", setup.renderer);
  if (setup.slow) q.set("slow", "1");
  if (setup.padding !== DEFAULT_PADDING) q.set("padding", String(setup.padding));
  if (!setup.lab) q.set("lab", "0");
  const query = q.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
};

/** Live, and mirrored into the URL, so a link is a reproduction. */
export const setup = createStore(readSetup(), writeSetup);

// ---- the app: its route and its own data ---------------------------------------------

export const routes = ["home", "decks", "settings"] as const;
export type Route = (typeof routes)[number];

const readRoute = (): Route => oneOf(routes, location.hash.replace(/^#\//, ""));

/** In the hash, so the back button and links work as in any single-page app. */
export const route = createStore(readRoute(), (next) => {
  if (readRoute() !== next) location.hash = `/${next}`;
  window.scrollTo(0, 0);
});
window.addEventListener("hashchange", () => route.set(readRoute()));

export type Theme = "light" | "dark" | "sepia";

export type AppData = Readonly<{
  decks: readonly string[];
  hasPhoto: boolean;
  invited: boolean;
  emailVerified: boolean;
  theme: Theme;
}>;

export const EMPTY_DATA: AppData = {
  decks: [],
  hasPhoto: false,
  invited: false,
  emailVerified: false,
  theme: "light",
};

const DATA_KEY = "waymark-react-app";

const loadData = (): AppData => {
  try {
    return { ...EMPTY_DATA, ...(JSON.parse(localStorage.getItem(DATA_KEY) ?? "{}") as Partial<AppData>) };
  } catch {
    return EMPTY_DATA;
  }
};

/** What a real app would keep on its server. Kept across reloads, like checklist progress. */
export const data = createStore(loadData(), (next) => localStorage.setItem(DATA_KEY, JSON.stringify(next)));

/** The app's invite dialog, which the invite Task's action opens. */
export const inviteOpen = createStore(false);

/** The self-owned "What's new" walkthrough, outside the checklists. */
export const whatsNewOpen = createStore(false);

// ---- what happened ---------------------------------------------------------------------

export type Entry = Readonly<{
  id: number;
  /** ms since the page loaded. */
  at: number;
  /** owner: checklists events. run: the owner's Run events. waymark: where the active step's Waymark is. */
  source: "owner" | "run" | "waymark" | "whats-new";
  text: string;
}>;

export const log = createStore<readonly Entry[]>([]);

let nextId = 0;

export const record = (source: Entry["source"], text: string) =>
  log.set([...log.get(), { id: nextId++, at: Math.round(performance.now()), source, text }]);

/**
 * The active Run as the mounted guidance renderer sees it, or null while no
 * renderer is mounted. Only a watched Run finds Waymarks and hears clicks.
 */
export const watched = createStore<string | null>(null);
