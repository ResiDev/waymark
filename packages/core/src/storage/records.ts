import { copy } from "../checklists/record";
import type { Stored } from "../checklists/record";
import type { Snapshot } from "../run/types";

/**
 * Each Task's status. Only Tasks off todo are listed; `reopened` is a Task
 * taken back from done, and is stored like the others.
 */
export type StoredTasks = Readonly<{
  version: 3;
  tasks: Readonly<Record<string, "done" | "skipped" | "reopened">>;
}>;

/** The active Task and where its walkthrough is. */
export type StoredChecklistWalkthrough = Readonly<{
  version: 1;
  task: string;
  /** The checklist whose `start` began it, so its skip events still name it. */
  from?: string;
  step: number;
  stepCount: number;
  collapsed: boolean;
  /** Epoch ms. */
  savedAt: number;
}>;

/** A walkthrough run on its own. Ended, it stays ended, so a finished tour is not shown again. */
export type StoredWalkthrough =
  | Readonly<{
      version: 1;
      phase: "running";
      step: number;
      stepCount: number;
      collapsed: boolean;
      /** Epoch ms. */
      savedAt: number;
    }>
  | Readonly<{ version: 1; phase: "completed" | "exited" }>;

/** `null`: nothing is stored. */
export type Parsed<T> =
  | Readonly<{ ok: true; value: T | null }>
  | Readonly<{ ok: false; error: unknown }>;

/** A walkthrough record restores for a day after its last change. */
export const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000;

const TASKS_VERSION = 3;
const WALKTHROUGH_VERSION = 1;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTaskMap = (value: unknown): value is Stored =>
  isRecord(value) &&
  Object.values(value).every(
    (status) => status === "done" || status === "skipped" || status === "reopened",
  );

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A step inside its walkthrough, saved at a real time. */
const isPosition = (value: Readonly<Record<string, unknown>>): boolean =>
  isIndex(value["step"]) &&
  isIndex(value["stepCount"]) &&
  value["step"] < value["stepCount"] &&
  typeof value["collapsed"] === "boolean" &&
  Number.isFinite(value["savedAt"]);

const nothing = { ok: true, value: null } as const;

const invalid = (record: "tasks" | "walkthrough", value: unknown, latest: number): Parsed<never> => {
  const version = isRecord(value) ? value["version"] : undefined;
  const message =
    typeof version === "number" && version > latest
      ? `The stored ${record} record is version ${version}; this Waymark reads up to ${latest}.`
      : `The stored ${record} record is not one Waymark wrote.`;
  return { ok: false, error: new Error(message) };
};

/** Version 2 is the old localStorage envelope; it holds the same statuses. */
export function parseTasks(value: unknown): Parsed<Stored> {
  if (value === null || value === undefined) return nothing;
  if (isRecord(value)) {
    const tasks =
      value["version"] === TASKS_VERSION
        ? value["tasks"]
        : value["version"] === 2
          ? value["record"]
          : undefined;
    if (isTaskMap(tasks)) return { ok: true, value: copy(tasks) };
  }
  return invalid("tasks", value, TASKS_VERSION);
}

export function parseChecklistWalkthrough(
  value: unknown,
): Parsed<StoredChecklistWalkthrough> {
  if (value === null || value === undefined) return nothing;
  if (
    !isRecord(value) ||
    value["version"] !== WALKTHROUGH_VERSION ||
    typeof value["task"] !== "string" ||
    (value["from"] !== undefined && typeof value["from"] !== "string") ||
    !isPosition(value)
  ) {
    return invalid("walkthrough", value, WALKTHROUGH_VERSION);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field was checked above.
  return { ok: true, value: value as StoredChecklistWalkthrough };
}

export function parseWalkthrough(value: unknown): Parsed<StoredWalkthrough> {
  if (value === null || value === undefined) return nothing;
  if (isRecord(value) && value["version"] === WALKTHROUGH_VERSION) {
    const phase = value["phase"];
    if (phase === "completed" || phase === "exited") {
      return { ok: true, value: { version: 1, phase } };
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field was checked.
    if (phase === "running" && isPosition(value)) return { ok: true, value: value as StoredWalkthrough };
  }
  return invalid("walkthrough", value, WALKTHROUGH_VERSION);
}

/** Saved for the walkthrough it was saved from, and recently enough to pick up again. */
export const isCurrent = (
  saved: Readonly<{ stepCount: number; savedAt: number }>,
  stepCount: number,
  maxAge: number,
): boolean => saved.stepCount === stepCount && Date.now() - saved.savedAt <= maxAge;

export const storedTasks = (tasks: Stored): StoredTasks => ({
  version: TASKS_VERSION,
  tasks,
});

/** `null` once the run has ended: a checklist keeps whether its Task finished in the Task's status. */
export const storedChecklistWalkthrough = (
  task: string,
  from: string | undefined,
  snapshot: Snapshot,
): StoredChecklistWalkthrough | null =>
  snapshot.phase === "running"
    ? {
        version: 1,
        task,
        ...(from === undefined ? {} : { from }),
        step: snapshot.stepIndex,
        stepCount: snapshot.stepCount,
        collapsed: snapshot.collapsed,
        savedAt: Date.now(),
      }
    : null;

export const storedWalkthrough = (snapshot: Snapshot): StoredWalkthrough | null => {
  switch (snapshot.phase) {
    case "loading":
      return null;
    case "running":
      return {
        version: 1,
        phase: "running",
        step: snapshot.stepIndex,
        stepCount: snapshot.stepCount,
        collapsed: snapshot.collapsed,
        savedAt: Date.now(),
      };
    case "completed":
    case "exited":
      return { version: 1, phase: snapshot.phase };
  }
};
