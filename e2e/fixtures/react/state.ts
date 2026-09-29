import { useSyncExternalStore } from "react";

// Held outside React, so a remount (StrictMode switched, a renderer moved)
// loses none of it and `window.playground` drives the same stores.

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

export const setupOptions = {
  popover: ["default", "custom"],
  list: ["default", "styled", "rows", "headless"],
  /** The copy-in checklist popover from packages/react/registry, in the header. */
  copy: ["off", "css", "tailwind"],
  /** `home` unmounts the renderer, and so stops guidance, whenever you leave Home. */
  renderer: ["root", "home", "none"],
} as const;

export type Setup = Readonly<{
  strict: boolean;
  popover: (typeof setupOptions.popover)[number];
  list: (typeof setupOptions.list)[number];
  copy: (typeof setupOptions.copy)[number];
  renderer: (typeof setupOptions.renderer)[number];
  /** The decks page loads for 1.5s first, so its Waymarks mount late. */
  slow: boolean;
  /** The owner reads it once, at creation. */
  padding: number;
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
    copy: oneOf(setupOptions.copy, q.get("copy")),
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
  if (setup.copy !== "off") q.set("copy", setup.copy);
  if (setup.renderer !== "root") q.set("renderer", setup.renderer);
  if (setup.slow) q.set("slow", "1");
  if (setup.padding !== DEFAULT_PADDING) q.set("padding", String(setup.padding));
  if (!setup.lab) q.set("lab", "0");
  const query = q.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
};

export const setup = createStore(readSetup(), writeSetup);

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

export const data = createStore(loadData(), (next) => localStorage.setItem(DATA_KEY, JSON.stringify(next)));

export const inviteOpen = createStore(false);

export const whatsNewOpen = createStore(false);

export type Entry = Readonly<{
  id: number;
  /** ms since the page loaded. */
  at: number;
  source: "owner" | "run" | "waymark" | "whats-new";
  text: string;
}>;

export const log = createStore<readonly Entry[]>([]);

let nextId = 0;

export const record = (source: Entry["source"], text: string) =>
  log.set([...log.get(), { id: nextId++, at: Math.round(performance.now()), source, text }]);

/** Null while no renderer is mounted: only a watched Run finds Waymarks and hears clicks. */
export const watched = createStore<string | null>(null);
