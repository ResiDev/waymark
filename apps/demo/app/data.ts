import { useSyncExternalStore } from "react";

export type Status = "On track" | "At risk" | "Off track" | "In review" | "Planning";

export type Person = Readonly<{ name: string; initials: string; color: string }>;

export type Project = Readonly<{
  id: string;
  name: string;
  team: string;
  owner: Person | null;
  status: Status;
  progress: number;
  due: string;
}>;

/** Teammates who can own a project. */
export const people = {
  priya: { name: "Priya Raman", initials: "PR", color: "#7c3aed" },
  mateo: { name: "Mateo García", initials: "MG", color: "#0891b2" },
  hannah: { name: "Hannah Okafor", initials: "HO", color: "#db2777" },
  jonas: { name: "Jonas Weber", initials: "JW", color: "#ea580c" },
  aiko: { name: "Aiko Tanaka", initials: "AT", color: "#16a34a" },
  lucas: { name: "Lucas Martin", initials: "LM", color: "#2563eb" },
  sofia: { name: "Sofia Rossi", initials: "SR", color: "#ca8a04" },
} satisfies Record<string, Person>;

export const me: Person = { name: "Sam Carter", initials: "SC", color: "#0f766e" };

const seed: readonly Project[] = [
  { id: "p1", name: "Checkout redesign", team: "Payments", owner: people.priya, status: "On track", progress: 72, due: "Oct 24" },
  { id: "p2", name: "Partner API v2", team: "Platform", owner: people.mateo, status: "At risk", progress: 41, due: "Oct 18" },
  { id: "p3", name: "Mobile onboarding", team: "Growth", owner: people.hannah, status: "On track", progress: 88, due: "Oct 9" },
  { id: "p4", name: "Help center refresh", team: "Support", owner: people.jonas, status: "In review", progress: 95, due: "Oct 11" },
  { id: "p5", name: "Warehouse migration", team: "Data", owner: people.aiko, status: "Off track", progress: 23, due: "Nov 30" },
  { id: "p6", name: "Usage-based billing", team: "Payments", owner: me, status: "On track", progress: 56, due: "Nov 14" },
  { id: "p7", name: "Q4 pricing page", team: "Marketing", owner: me, status: "Planning", progress: 8, due: "Dec 2" },
];

export type AppData = Readonly<{
  projects: readonly Project[];
  /** Emails invited and not yet accepted. */
  pending: readonly string[];
  githubConnected: boolean;
}>;

const KEY = "plotline-data";
const initial: AppData = { projects: seed, pending: [], githubConnected: false };

/** The app's own data, kept in localStorage so a reload looks like a server answered. */
function createStore<T>(read: () => T, write?: (value: T) => void) {
  let value = read();
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      write?.(next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Store<T> = ReturnType<typeof createStore<T>>;

export const data = createStore<AppData>(
  () => ({ ...initial, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }),
  (value) => localStorage.setItem(KEY, JSON.stringify(value)),
);

export const inviteOpen = createStore(() => false);
export const creatingProject = createStore(() => false);
const TABS = ["All", "Mine", "Starred"] as const;
export type Tab = (typeof TABS)[number];
/** Kept across a reload, as the view someone was on would be. */
export const tab = createStore<Tab>(
  () => TABS.find((name) => name === localStorage.getItem("plotline-tab")) ?? "All",
  (value) => localStorage.setItem("plotline-tab", value),
);
/** The project whose owner picker is open. */
export const pickingOwner = createStore<string | null>(() => null);

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get);

export const patch = (changes: Partial<AppData>) => data.set({ ...data.get(), ...changes });
