/**
 * Resources: the live things a Run needs *right now* — a frame loop, event
 * listeners, an ARIA attribute on the Waymark.
 *
 * Each one is derived from the State rather than started and stopped by hand.
 * You say what it depends on; when those change it is closed and reopened, and
 * when they go CLOSED it is closed and stays closed. Nothing in the Run has to
 * remember to clean up, because cleaning up is what changed deps already do.
 */

/** One live thing, and the way to undo it. */
export type Resource = {
  deps: readonly unknown[] | null;
  close: () => void;
};

/** Deps for a resource that should be open, with nothing to reopen it. */
export const OPEN: readonly unknown[] = [];

/** Deps for a resource that should not exist at the moment. */
export const CLOSED = null;

const noop = () => {};

export const createResource = (): Resource => ({ deps: CLOSED, close: noop });

const sameDeps = (
  a: readonly unknown[] | null,
  b: readonly unknown[] | null,
): boolean =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * Brings one resource in line with its deps. `open` does the work and returns
 * the way to undo it. Deps that have not changed cost nothing.
 */
export function keepInSync(
  resource: Resource,
  deps: readonly unknown[] | null,
  open: () => () => void,
): void {
  if (sameDeps(resource.deps, deps)) return;
  resource.close();
  resource.deps = deps;
  resource.close = deps === CLOSED ? noop : open();
}
