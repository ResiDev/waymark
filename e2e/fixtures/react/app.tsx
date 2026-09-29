import { useEffect, useState, type FormEvent } from "react";
import { Checklist } from "react-waymark";
import { DecksBanner, HeaderChecklist, HomeChecklist } from "./checklists";
import { Guidance, owner, WhatsNew } from "./guidance";
import {
  data,
  inviteOpen,
  patch,
  route,
  routes,
  setup,
  useStore,
  whatsNewOpen,
  type Route,
  type Theme,
} from "./state";

export function App() {
  const { renderer } = useStore(setup);
  const current = useStore(route);
  const { theme } = useStore(data);
  return (
    <div className="app" data-theme={theme}>
      <Header />
      <Sidebar current={current} />
      <main className="view">
        {current === "home" && <Home />}
        {current === "decks" && <Decks />}
        {current === "settings" && <Settings />}
      </main>
      <button type="button" className="feedback" data-waymark="feedback">
        Feedback
      </button>
      <InviteDialog />
      {renderer === "root" && <Guidance />}
      <WhatsNew />
    </div>
  );
}

function Header() {
  const { hasPhoto } = useStore(data);
  return (
    <header className="topbar">
      <span className="brand">Study</span>
      <input className="search" name="search" data-waymark="search" placeholder="Search decks" aria-label="Search decks" />
      <span className="grow" />
      {/* Not a direct child, so the header's own button look stays off the copy's trigger. */}
      <span>
        <HeaderChecklist />
      </span>
      <button type="button" data-waymark="whats-new" onClick={() => whatsNewOpen.set(true)}>
        What's new
      </button>
      <button
        type="button"
        className="avatar"
        data-waymark="avatar"
        aria-label="Profile"
        onClick={() => route.set("settings")}
      >
        {hasPhoto ? "🙂" : "?"}
      </button>
      <button type="button" className="help" data-waymark="help">
        Help
      </button>
    </header>
  );
}

const titles: Record<Route, string> = { home: "Home", decks: "Decks", settings: "Settings" };

function Sidebar({ current }: { current: Route }) {
  return (
    <nav className="sidebar">
      {routes.map((to) => (
        <button
          key={to}
          type="button"
          data-waymark={`nav-${to}`}
          aria-current={current === to ? "page" : undefined}
          onClick={() => route.set(to)}
        >
          {titles[to]}
        </button>
      ))}
    </nav>
  );
}

function Home() {
  const { renderer } = useStore(setup);
  const { decks } = useStore(data);
  return (
    <>
      <h1>Good morning</h1>
      <div className="stats">
        <div className="stat" data-waymark="streak">
          <b>3</b> day streak
        </div>
        <div className="stat">
          <b>{decks.length}</b> {decks.length === 1 ? "deck" : "decks"}
        </div>
      </div>
      <HomeChecklist />
      <div className="spacer" />
      <p className="guide" data-waymark="guide">
        The study guide lives down here, well below the fold.
      </p>
      {renderer === "home" && <Guidance />}
    </>
  );
}

function Decks() {
  const { slow } = useStore(setup);
  const [loaded, setLoaded] = useState(!slow);
  useEffect(() => {
    const timer = loaded ? undefined : setTimeout(() => setLoaded(true), 1500);
    return () => clearTimeout(timer);
  }, [loaded]);

  const { decks } = useStore(data);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || decks.includes(trimmed)) return;
    patch(data, { decks: [...decks, trimmed] });
    setName("");
    setCreating(false);
  };

  if (!loaded) return <p className="loading">Loading decks…</p>;
  return (
    <>
      <h1>Decks</h1>
      <DecksBanner />
      <button type="button" data-waymark="new-deck" onClick={() => setCreating((open) => !open)}>
        New deck
      </button>
      {creating && (
        <form className="deck-form" onSubmit={create}>
          <input
            name="deck-name"
            data-waymark="deck-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Deck name"
            aria-label="Deck name"
          />
          <button type="submit" data-waymark="deck-create">
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}
      {decks.length === 0 ? (
        <p className="empty">No decks yet.</p>
      ) : (
        <ul className="decks">
          {decks.map((deck) => (
            <li key={deck}>{deck}</li>
          ))}
        </ul>
      )}
    </>
  );
}

const themes: readonly Theme[] = ["light", "dark", "sepia"];

function Settings() {
  const app = useStore(data);
  return (
    <>
      <h1>Settings</h1>
      <section className="card">
        <h2>Profile</h2>
        <div className="avatar big">{app.hasPhoto ? "🙂" : "?"}</div>
        <button type="button" data-waymark="upload-photo" onClick={() => patch(data, { hasPhoto: true })}>
          Choose a photo
        </button>
        {app.hasPhoto && (
          <button type="button" onClick={() => patch(data, { hasPhoto: false })}>
            Remove photo
          </button>
        )}
      </section>
      <section className="card">
        <h2>Appearance</h2>
        <label>
          Theme{" "}
          <select
            name="theme"
            data-waymark="theme"
            value={app.theme}
            onChange={(event) => patch(data, { theme: event.target.value as Theme })}
          >
            {themes.map((theme) => (
              <option key={theme}>{theme}</option>
            ))}
          </select>
        </label>
      </section>
      <section className="card">
        <h2>Email</h2>
        <p>you@example.com is {app.emailVerified ? "verified" : "not verified"}.</p>
        <button type="button" onClick={() => patch(data, { emailVerified: !app.emailVerified })}>
          {app.emailVerified ? "Unverify" : "Pretend I clicked the link"}
        </button>
      </section>
      <Checklist checklist={owner.checklists.settings} />
    </>
  );
}

function InviteDialog() {
  const open = useStore(inviteOpen);
  const [email, setEmail] = useState("");
  if (!open) return null;
  const send = (event: FormEvent) => {
    event.preventDefault();
    patch(data, { invited: true });
    inviteOpen.set(false);
    setEmail("");
  };
  return (
    <div className="backdrop">
      <form className="modal" role="dialog" aria-label="Invite a teammate" onSubmit={send}>
        <h2>Invite a teammate</h2>
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          aria-label="Email"
        />
        <div>
          <button type="submit">Send invite</button>
          <button type="button" onClick={() => inviteOpen.set(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
