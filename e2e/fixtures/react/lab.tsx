import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { actions } from "waymark-core";
import { owner, stored } from "./guidance";
import {
  data,
  EMPTY_DATA,
  log,
  patch,
  setup,
  setupOptions,
  useStore,
  watched,
  whatsNewOpen,
  type AppData,
  type Setup,
} from "./state";

// Outside the StrictMode switch, so toggling StrictMode remounts the app and not the panel.
export function Lab() {
  const current = useStore(setup);
  if (!current.lab) {
    return (
      <button type="button" className="lab-show" data-waymark-ui onClick={() => patch(setup, { lab: true })}>
        lab
      </button>
    );
  }
  return (
    <aside className="lab" data-waymark-ui>
      <div className="lab-head">
        <b>React lab</b>
        <a href="./index.html">core</a>
        <a href="./checklist.html">checklists</a>
        <button type="button" onClick={() => patch(setup, { lab: false })}>
          hide
        </button>
      </div>
      <SetupPanel setup={current} />
      <GuidancePanel />
      <DataPanel />
      <ProgressPanel />
      <EventLog />
    </aside>
  );
}

function Choice<K extends keyof typeof setupOptions>({ name, setup: current }: { name: K; setup: Setup }) {
  return (
    <div className="choice">
      <span>{name}</span>
      {setupOptions[name].map((option) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            checked={current[name] === option}
            onChange={() => patch(setup, { [name]: option })}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function SetupPanel({ setup: current }: { setup: Setup }) {
  return (
    <>
      <h2>Setup</h2>
      <Choice name="renderer" setup={current} />
      <Choice name="popover" setup={current} />
      <Choice name="list" setup={current} />
      <Choice name="copy" setup={current} />
      <label title="Remounts the app, not this panel.">
        <input type="checkbox" name="strict" checked={current.strict} onChange={() => patch(setup, { strict: !current.strict })} />
        StrictMode
      </label>
      <label title="The decks page shows a loader for 1.5s, so its Waymarks mount late.">
        <input type="checkbox" name="slow" checked={current.slow} onChange={() => patch(setup, { slow: !current.slow })} />
        slow decks page
      </label>
      <label title="The owner reads its Run options once, at creation, so this reloads the page.">
        padding{" "}
        <input
          type="number"
          name="padding"
          min={0}
          defaultValue={current.padding}
          onBlur={(event) => {
            const padding = Number(event.target.value);
            if (padding === current.padding || !Number.isFinite(padding)) return;
            patch(setup, { padding });
            location.reload();
          }}
        />
      </label>
    </>
  );
}

function GuidancePanel() {
  const { active } = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const line = useStore(watched);
  const status = active === null
    ? "Nothing active."
    : line ?? `${active.task.id}: no renderer is mounted, so its Run is not watching the page.`;
  return (
    <>
      <h2>Guidance</h2>
      <div className="lab-status">{status}</div>
      <div>
        {actions.map((action) => (
          <button key={action} type="button" disabled={active === null} onClick={() => active?.run.act(action)}>
            {action}
          </button>
        ))}
      </div>
      <div>
        <button type="button" onClick={() => owner.stop()}>
          owner.stop()
        </button>
        <button type="button" onClick={() => whatsNewOpen.set(true)}>
          what's new
        </button>
      </div>
    </>
  );
}

const flags = ["hasPhoto", "invited", "emailVerified", "tipDismissed"] as const satisfies readonly (keyof AppData)[];

function DataPanel() {
  const app = useStore(data);
  return (
    <>
      <h2>App data (context)</h2>
      <div>
        {app.decks.length} decks{" "}
        <button type="button" disabled={app.decks.length === 0} onClick={() => patch(data, { decks: [] })}>
          delete all
        </button>
      </div>
      <div>
        {flags.map((flag) => (
          <label key={flag}>
            <input type="checkbox" name={flag} checked={app[flag]} onChange={() => patch(data, { [flag]: !app[flag] })} />
            {flag}
          </label>
        ))}
      </div>
    </>
  );
}

function ProgressPanel() {
  const record = useStore(stored);
  return (
    <>
      <h2>Stored progress</h2>
      <pre>{JSON.stringify(record)}</pre>
      <div>
        <button type="button" onClick={() => owner.clear()}>
          owner.clear()
        </button>
        <button type="button" onClick={() => data.set(EMPTY_DATA)}>
          reset app data
        </button>
        <button type="button" onClick={() => location.reload()}>
          reload
        </button>
      </div>
    </>
  );
}

function EventLog() {
  const entries = useStore(log);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (element && entries.length > 0) element.scrollTop = element.scrollHeight;
  }, [entries]);
  return (
    <>
      <h2>
        Events{" "}
        <button type="button" onClick={() => log.set([])}>
          clear
        </button>
      </h2>
      <div ref={box} className="log">
        {entries.map((entry) => (
          <div key={entry.id} data-source={entry.source}>
            {(entry.at / 1000).toFixed(1)}s <b>{entry.source}</b> {entry.text}
          </div>
        ))}
      </div>
    </>
  );
}
