import { Checklist, useChecklist, type ChecklistRowProps, type CoreChecklist } from "react-waymark";
import { owner, type AnyTask } from "./guidance";
import { setup, useStore } from "./state";

/**
 * The home checklist, drawn each way the package offers. The lab switches
 * between them live; all four read the same view, so progress and the active
 * task carry across.
 */
export function HomeChecklist() {
  const { list } = useStore(setup);
  const home = owner.checklists.home;
  if (list === "styled") {
    return (
      <Checklist
        checklist={home}
        style={{ background: "#fdf4ff", borderColor: "#f0abfc", borderRadius: 4 }}
        rowStyle={{ background: "#ffffff", borderRadius: 2 }}
        labels={{ start: "Guide me", replay: "Again", skip: "Not now" }}
      />
    );
  }
  if (list === "rows") return <Checklist checklist={home} renderRow={(row) => <CompactRow {...row} />} />;
  if (list === "headless") return <HeadlessChecklist checklist={home} />;
  return <Checklist checklist={home} />;
}

/** A `renderRow` row. Unlike the default it offers `markDone`, and shows the status as text. */
function CompactRow<TTask extends AnyTask>({ task, status, active, start, markDone, skip, toggle }: ChecklistRowProps<TTask>) {
  return (
    <div className="compact-row">
      <span className="pill" data-status={status}>
        {active ? "active" : status}
      </span>
      <span className="compact-title">{task.title}</span>
      {task.walkthrough !== undefined && (
        <button type="button" onClick={() => start(task.id)} disabled={active}>
          {status === "done" ? "replay" : "start"}
        </button>
      )}
      {task.action !== undefined && (
        <button type="button" onClick={task.action.onSelect}>
          {task.action.label}
        </button>
      )}
      {status === "todo" && (
        <>
          <button type="button" onClick={() => markDone(task.id)}>
            mark done
          </button>
          <button type="button" onClick={() => skip(task.id)}>
            skip
          </button>
        </>
      )}
      {status !== "todo" && task.toggleable !== false && (
        <button type="button" onClick={() => toggle(task.id)}>
          undo
        </button>
      )}
    </div>
  );
}

/** `useChecklist`: the view's snapshot and commands, and nothing drawn for you. */
function HeadlessChecklist<TTask extends AnyTask>({ checklist }: { checklist: CoreChecklist<TTask> }) {
  const { snapshot, start, skip, toggle } = useChecklist(checklist);
  return (
    <section className="headless">
      <header>
        <b>Getting started</b>
        <progress value={snapshot.finishedCount} max={snapshot.taskCount} />
        <span>{snapshot.complete ? "all done" : `${snapshot.finishedCount} of ${snapshot.taskCount}`}</span>
      </header>
      <div className="cards">
        {snapshot.tasks.map(({ task, status }) => (
          <article key={task.id} data-status={status} data-active={snapshot.active?.task.id === task.id}>
            <h4>{task.title}</h4>
            {task.description !== undefined && <p>{task.description}</p>}
            <footer>
              {status === "todo" && task.walkthrough !== undefined && (
                <button type="button" onClick={() => start(task.id)}>
                  Show me
                </button>
              )}
              {status === "todo" && task.action !== undefined && (
                <button type="button" onClick={task.action.onSelect}>
                  {task.action.label}
                </button>
              )}
              {status === "todo" && (
                <button type="button" onClick={() => skip(task.id)}>
                  Skip
                </button>
              )}
              {status !== "todo" && task.toggleable !== false && (
                <button type="button" onClick={() => toggle(task.id)}>
                  {status === "done" ? "Not done" : "Unskip"}
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * The decks view: one task, drawn as a banner with `useChecklist`. Dismissing
 * skips it from this view; the skip shows in every view.
 */
export function DecksBanner() {
  const { snapshot, start, skip } = useChecklist(owner.checklists.decks);
  const row = snapshot.tasks[0];
  if (!row || row.status !== "todo") return null;
  return (
    <div className="banner">
      New here?
      <button type="button" onClick={() => start(row.task.id)} disabled={snapshot.active !== null}>
        Show me how to make a deck
      </button>
      <button type="button" onClick={() => skip(row.task.id)}>
        Dismiss
      </button>
    </div>
  );
}
