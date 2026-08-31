import type { State } from "./state";
import type { RunEventType } from "./types";

/**
 * A RunEvent with no Snapshot on it yet. Core decides *what* to announce; the
 * driver attaches the Run as it stood afterwards and hands it to `onEvent`.
 */
export type Announcement = Readonly<{
  type: RunEventType;
  /** The Step it happened on — named before any move it describes. */
  stepIndex: number;
}>;

/** Everything one Input caused. The only thing core ever hands back. */
export type Outcome = Readonly<{
  /** The same State by identity means nothing happened. */
  state: State;
  announcements: readonly Announcement[];
  /** Bring this element into view. Fire and forget. */
  scrollTo?: Element;
}>;

/**
 * An Outcome with nothing to announce. Passing the State that came in is how
 * every rule says "refused".
 */
export const silent = (state: State): Outcome => ({ state, announcements: [] });
