import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createRun } from "waymark-core";
import { RunView } from "./RunView";
import type { ProblemHandlers, Walkthrough, WaymarkRootProps } from "./types";
import { RunContext } from "./useRun";

/**
 * Hands the Run the app's latest handlers each time it calls one, so a
 * handler written inline sees the render it came from without making a new Run.
 */
const latestHandlers = (latest: RefObject<WaymarkRootProps>): ProblemHandlers => {
  const handlers = {
    get storageFailed() {
      return latest.current?.problemHandlers?.storageFailed;
    },
    get recordUnreadable() {
      return latest.current?.problemHandlers?.recordUnreadable;
    },
    get recordDropped() {
      return latest.current?.problemHandlers?.recordDropped;
    },
    get waymarkLost() {
      return latest.current?.problemHandlers?.waymarkLost;
    },
    get waymarkMissing() {
      return latest.current?.problemHandlers?.waymarkMissing;
    },
    get callbackThrew() {
      return latest.current?.problemHandlers?.callbackThrew;
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a getter's undefined is no handler, as a missing key is: the Run falls back to its default.
  return handlers as ProblemHandlers;
};

/**
 * Before the browser paints, so a record read at once is drawn in the first
 * frame. A server runs no effect, and React 18 warns of a layout effect there.
 */
const useBeforePaint = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Makes one user's Run from its props, provides it to the components below,
 * which reach it with `useRun`, and draws it: the open walkthrough and the
 * visible beacons. Give it `key={user.id}`, so another user gets a Run of
 * their own.
 */
export function WaymarkRoot(props: WaymarkRootProps) {
  const {
    children,
    storage,
    initial,
    context,
    waymarkPadding = 20,
    renderPopover,
    renderBeacon,
    labels,
    portal = true,
  } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  // The closures read the ref when the Run calls them, not during render.
  // oxlint-disable-next-line react/refs
  const [run] = useState(() =>
    createRun<Walkthrough>({
      ...(storage === undefined ? {} : { storage }),
      ...(initial === undefined ? {} : { initial }),
      context,
      problemHandlers: latestHandlers(latest),
      onEvent: (event) => latest.current.onEvent?.(event),
      onChange: (stored) => latest.current.onChange?.(stored),
    }),
  );
  // Storage starts here, in the browser: a server render reads none.
  useBeforePaint(() => run.connect(), [run]);
  useEffect(() => {
    run.setContext(context);
  }, [run, context]);

  return (
    <RunContext.Provider value={run}>
      {children}
      <RunView
        run={run}
        waymarkPadding={waymarkPadding}
        renderPopover={renderPopover}
        renderBeacon={renderBeacon}
        labels={labels}
        portal={portal}
      />
    </RunContext.Provider>
  );
}
