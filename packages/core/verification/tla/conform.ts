// Walks every move of a model's state graph on the real code, and fails at the first place they differ.
import type { Graph } from "./tlc";

/** How a property drives the real code alongside its model. S is a model state, W the real side. */
export type Conformance<S, W> = Readonly<{
  /** The real side, brought to one of the model's initial states. */
  start: (state: S) => W;
  /** The model's action, done on the real side, from the state `from` towards the state `to`. */
  act: (world: W, action: string, from: S, to: S) => W;
  /** Where the real side differs from the model's state, one line each, in the model's names. */
  differences: (world: W, state: S) => readonly string[];
  /** Where the real side allows different moves than the model does from this state, one line each. */
  allows?: (world: W, state: S, actions: ReadonlySet<string>) => readonly string[];
}>;

/** Walks the whole graph, breadth first. Returns how many moves it checked. */
export function conform<S, W>(graph: Graph<S>, conformance: Conformance<S, W>): number {
  const worlds = new Map<string, W>();
  const parents = new Map<string, readonly [from: string, action: string]>();
  const queue: string[] = [];
  const stateOf = (id: string): S => {
    const state = graph.states.get(id);
    if (state === undefined) throw new Error(`The graph has no state ${id}`);
    return state;
  };
  const fail = (id: string, what: string, problems: readonly string[], last?: string): never => {
    const path = [...pathTo(parents, id), ...(last === undefined ? [] : [last])];
    throw new Error([`After: ${path.length === 0 ? "the start" : path.join(", ")}`, what, ...problems.map((problem) => `  ${problem}`)].join("\n"));
  };

  for (const id of graph.initial) {
    const world = conformance.start(stateOf(id));
    const problems = conformance.differences(world, stateOf(id));
    if (problems.length > 0) fail(id, "The code starts differently from the model:", problems);
    worlds.set(id, world);
    queue.push(id);
  }

  let checked = 0;
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    const world = worlds.get(from);
    if (world === undefined) throw new Error(`Lost the real side at state ${from}`);
    const state = stateOf(from);
    const moves = graph.moves.get(from) ?? [];
    const allowed = conformance.allows?.(world, state, new Set(moves.map(([, action]) => action))) ?? [];
    if (allowed.length > 0) fail(from, "The code allows different moves from the model:", allowed);
    for (const [to, action] of moves) {
      const after = conformance.act(world, action, state, stateOf(to));
      const problems = conformance.differences(after, stateOf(to));
      if (problems.length > 0) fail(from, `The code and the model differ after ${action}:`, problems, action);
      checked++;
      if (!worlds.has(to)) {
        worlds.set(to, after);
        parents.set(to, [from, action]);
        queue.push(to);
      }
    }
  }

  if (worlds.size !== graph.states.size) throw new Error(`Reached ${worlds.size} of ${graph.states.size} states.`);
  return checked;
}

function pathTo(parents: ReadonlyMap<string, readonly [string, string]>, id: string): string[] {
  const path: string[] = [];
  for (let at = parents.get(id); at !== undefined; at = parents.get(at[0])) path.unshift(at[1]);
  return path;
}
