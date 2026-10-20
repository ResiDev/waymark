import {
  Checklist,
  useChecklist,
  type AnyReactTask,
  type ChecklistDefinition,
  type ChecklistRowProps,
} from "react-waymark";
import { ChecklistPopover as CssPopover } from "../../../packages/react/registry/checklist-popover/css/checklist-popover";
import { ChecklistPopover as TailwindPopover } from "../../../packages/react/registry/checklist-popover/tailwind/checklist-popover";
import { onboarding } from "./guidance";
import { setup, useStore } from "./state";

export function HomeChecklist() {
  const { list } = useStore(setup);
  const home = onboarding.checklists.home;
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

function CompactRow<TTask extends AnyReactTask>({
  task,
  status,
  walkthrough,
  start,
  markDone,
  skip,
  toggle,
}: ChecklistRowProps<TTask>) {
  return (
    <div className="compact-row">
      <span className="pill" data-status={status}>
        {walkthrough === "open" ? "open" : walkthrough === "collapsed" ? "in progress" : status}
      </span>
      <span className="compact-title">{task.title}</span>
      {task.walkthrough !== undefined && (
        <button type="button" onClick={() => start(task.id)} disabled={walkthrough === "open"}>
          {status === "done" ? "replay" : walkthrough === "collapsed" ? "resume" : "start"}
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

function HeadlessChecklist<TTask extends AnyReactTask>({ checklist }: { checklist: ChecklistDefinition<TTask> }) {
  const { snapshot, start, skip, toggle } = useChecklist(checklist);
  return (
    <section className="headless">
      <header>
        <b>Getting started</b>
        <progress value={snapshot.finishedCount} max={snapshot.taskCount} />
        <span>{snapshot.complete ? "all done" : `${snapshot.finishedCount} of ${snapshot.taskCount}`}</span>
      </header>
      <div className="cards">
        {snapshot.tasks.map(({ task, status, walkthrough }) => (
          <article
            key={task.id}
            data-status={status}
            data-open={walkthrough === "open"}
            data-in-progress={walkthrough === "collapsed"}
          >
            <h4>{task.title}</h4>
            {task.description !== undefined && <p>{task.description}</p>}
            <footer>
              {status === "todo" && task.walkthrough !== undefined && (
                <button type="button" onClick={() => start(task.id)}>
                  {walkthrough === "collapsed" ? "Carry on" : "Show me"}
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

export function DecksBanner() {
  const { snapshot, start, skip } = useChecklist(onboarding.checklists.decks);
  const row = snapshot.tasks[0];
  if (!row || row.status !== "todo") return null;
  return (
    <div className="banner">
      New here?
      <button type="button" onClick={() => start(row.task.id)} disabled={snapshot.open !== null}>
        Show me how to make a deck
      </button>
      <button type="button" onClick={() => skip(row.task.id)}>
        Dismiss
      </button>
    </div>
  );
}

export function HeaderChecklist() {
  const { copy } = useStore(setup);
  if (copy === "css") return <CssPopover checklist={onboarding.checklists.home} />;
  if (copy === "tailwind") return <TailwindPopover checklist={onboarding.checklists.home} />;
  return null;
}
