import { useLayoutEffect, useRef } from "react";
import { actions } from "waymark-core";
import { currentRun, forgetRecord, stored, useRunSnapshot, whatsNew } from "./guidance";
import {
  data,
  EMPTY_DATA,
  log,
  patch,
  runStatus,
  setup,
  setupOptions,
  useStore,
  whatsNewOpen,
  type AppData,
  type Setup,
} from "./state";

// Outside the StrictMode switch, so toggling StrictMode remounts the app and
// its root, not the panel. It reaches the Run through `currentRun`.
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
      <Choice name="popover" setup={current} />
      <Choice name="list" setup={current} />
      <Choice name="copy" setup={current} />
      <Choice name="storage" setup={current} />
      <label title="Remounts the app and its root, so a new Run, not this panel.">
        <input type="checkbox" name="strict" checked={current.strict} onChange={() => patch(setup, { strict: !current.strict })} />
        StrictMode
      </label>
      <label title="The decks page shows a loader for 1.5s, so its Waymarks mount late.">
        <input type="checkbox" name="slow" checked={current.slow} onChange={() => patch(setup, { slow: !current.slow })} />
        slow decks page
      </label>
      <label title="The root's waymarkPadding: room around the Waymark, drawn and clicked.">
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
          }}
        />
      </label>
    </>
  );
}

function GuidancePanel() {
  const run = useStore(currentRun);
  const open = useRunSnapshot()?.open ?? null;
  const status = useStore(runStatus);
  const asked = useStore(whatsNewOpen);
  return (
    <>
      <h2>Guidance</h2>
      <div className="lab-status">{status ?? "Nothing open."}</div>
      <div>
        {actions.map((action) => (
          <button key={action} type="button" disabled={open === null} onClick={() => run?.act(action)}>
            {action}
          </button>
        ))}
      </div>
      <div>
        <button type="button" title="A click: shown now, over any open walkthrough." onClick={() => run?.start(whatsNew)}>
          start(whatsNew)
        </button>
        <button
          type="button"
          title="The app asking: shown once nothing is open, and not at all once finished or exited."
          aria-pressed={asked}
          onClick={() => whatsNewOpen.set(true)}
        >
          requestStart(whatsNew)
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
  const { storage } = useStore(setup);
  const run = useStore(currentRun);
  const storageStatus = useRunSnapshot()?.storageStatus ?? "loading";
  const record = useStore(stored);
  return (
    <>
      <h2>Storage</h2>
      <div className="lab-status" data-testid="storage-status">
        record in {storage === "server" ? "/api/record" : "localStorage"}: {storageStatus}
      </div>
      <pre data-testid="stored-record">{JSON.stringify(record)}</pre>
      <div>
        <button type="button" title="Clears the record and starts a new Run on it." onClick={() => void forgetRecord()}>
          forget record
        </button>
        <button type="button" onClick={() => data.set(EMPTY_DATA)}>
          reset app data
        </button>
        <button
          type="button"
          title="Starts what's new again from its first step: now if it is open, else the next time it shows."
          onClick={() => {
            run?.reset(whatsNew);
            whatsNewOpen.set(false);
          }}
        >
          run.reset(whatsNew)
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
