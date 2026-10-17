import { createContext, useContext } from "react";
import type { Run } from "./types";

export const RunContext = createContext<Run | null>(null);

/** The Run of the `<WaymarkRoot>` above: one user's walkthroughs, to start, follow or act on. */
export function useRun(): Run {
  const run = useContext(RunContext);
  if (run === null) throw new Error("useRun needs a WaymarkRoot above it.");
  return run;
}
