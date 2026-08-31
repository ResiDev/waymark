// A generic Elm-style runtime. This is the only file that owns mutable state:
// the current model, the set of live subscriptions, and the listener set.
// It knows nothing about tours.

/** A resource that should be live while the model says so. `start` returns
 * its teardown. `deps` are compared by identity: when they change, the
 * subscription is restarted (same idea as effect deps in React). */
export type Sub<Model, Msg> = {
  key: string;
  deps?: ReadonlyArray<unknown>;
  start: (send: (msg: Msg) => void, current: () => Model) => () => void;
};

export type Program<Model, Msg, Effect> = {
  init: Model;
  /** Pure. Return the same model reference to mean "nothing changed". */
  update: (model: Model, msg: Msg) => { model: Model; effects?: Array<Effect> };
  /** Pure. What should be live given this model. */
  subscriptions: (model: Model) => Array<Sub<Model, Msg>>;
  /** Optional: the model fields `subscriptions` reads. When given, the
   * subscription list is only re-derived when one of them changes. */
  subscriptionDeps?: (model: Model) => ReadonlyArray<unknown>;
  /** The one impure interpreter for effects. */
  runEffect: (effect: Effect) => void;
  /** Observe transitions, e.g. to fire user callbacks. Called after listeners. */
  onChange?: (prev: Model, next: Model, msg: Msg) => void;
};

export type Runtime<Model, Msg> = {
  current: () => Model;
  send: (msg: Msg) => void;
  /** Subscriptions go live with the first listener and are torn down with the last. */
  subscribe: (cb: () => void) => () => void;
};

const sameDeps = (a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>) =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

export function createRuntime<Model, Msg, Effect>(
  program: Program<Model, Msg, Effect>,
): Runtime<Model, Msg> {
  let model = program.init;
  let running = false;
  const live = new Map<
    string,
    { deps?: ReadonlyArray<unknown>; stop: () => void }
  >();
  const listeners = new Set<() => void>();

  const current = () => model;

  const reconcile = () => {
    const wanted = new Map(
      (running ? program.subscriptions(model) : []).map((s) => [s.key, s]),
    );
    for (const [key, entry] of live) {
      const want = wanted.get(key);
      if (want && sameDeps(want.deps, entry.deps)) continue;
      entry.stop();
      live.delete(key);
    }
    for (const [key, sub] of wanted) {
      if (live.has(key)) continue;
      live.set(key, { deps: sub.deps, stop: sub.start(send, current) });
    }
  };

  const send = (msg: Msg) => {
    const prev = model;
    const { model: next, effects = [] } = program.update(prev, msg);
    model = next;
    for (const effect of effects) program.runEffect(effect);
    if (next === prev) return;
    const deps = program.subscriptionDeps;
    if (!deps || !sameDeps(deps(prev), deps(next))) reconcile();
    listeners.forEach((l) => l());
    program.onChange?.(prev, next, msg);
  };

  return {
    current,
    send,
    subscribe: (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) {
        running = true;
        reconcile();
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          running = false;
          reconcile();
        }
      };
    },
  };
}
