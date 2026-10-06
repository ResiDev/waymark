import {
  Bell,
  Calendar,
  ChartColumn,
  Check,
  ChevronsUpDown,
  FolderKanban,
  Inbox,
  LayoutGrid,
  Link,
  ListFilter,
  Map,
  Plus,
  Search,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useChecklist } from "react-waymark";
import {
  creatingProject,
  data,
  inviteOpen,
  me,
  patch,
  people,
  pickingOwner,
  tab,
  useStore,
  type Person,
  type Project,
  type Status,
  type Tab,
} from "./data";
import { Guidance, onboarding, onTab } from "./guidance";

export function App() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <TopBar />
        <main className="page">
          <PageHeader />
          <Stats />
          <div className="columns">
            <Projects />
            <GettingStarted />
          </div>
        </main>
      </div>
      <Guidance />
    </div>
  );
}

const nav: readonly { label: string; icon: ReactNode; waymark?: string; current?: boolean; count?: number }[] = [
  { label: "Overview", icon: <LayoutGrid size={16} /> },
  { label: "Inbox", icon: <Inbox size={16} />, count: 3 },
  { label: "Projects", icon: <FolderKanban size={16} />, current: true },
  { label: "Roadmap", icon: <Map size={16} /> },
  { label: "Reports", icon: <ChartColumn size={16} />, waymark: "nav-reports" },
  { label: "Members", icon: <Users size={16} /> },
  { label: "Settings", icon: <Settings size={16} /> },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="workspace">
        <span className="logo">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M3 15.5 8 9l3.5 4L17 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="workspace-name">
          Fernhill Studio
          <small>Plotline · Team plan</small>
        </span>
        <ChevronsUpDown size={14} className="muted" />
      </div>
      <nav className="nav">
        {nav.map((item) => (
          <a key={item.label} href="#" data-waymark={item.waymark} aria-current={item.current ? "page" : undefined}>
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="count">{item.count}</span>}
          </a>
        ))}
      </nav>
      <div className="nav-section">Teams</div>
      <nav className="nav teams">
        {["Payments", "Platform", "Growth", "Data"].map((team, index) => (
          <a key={team} href="#">
            <span className="team-dot" style={{ background: ["#7c3aed", "#0891b2", "#db2777", "#16a34a"][index] }} />
            {team}
          </a>
        ))}
      </nav>
      <div className="me">
        <Avatar person={me} size={28} />
        <span>
          {me.name}
          <small>sam@fernhill.studio</small>
        </span>
      </div>
    </aside>
  );
}

function Avatar({ person, size = 28 }: { person: Person; size?: number }) {
  return (
    <span className="avatar" title={person.name} style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }}>
      {person.initials}
    </span>
  );
}

const team = [people.priya, people.mateo, people.hannah, people.aiko];

function TopBar() {
  const { pending } = useStore(data);
  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="muted">Fernhill Studio</span>
        <span className="sep">/</span>
        <span>Projects</span>
      </div>
      <label className="search" data-waymark="search">
        <Search size={15} />
        <input placeholder="Search projects, people, docs" aria-label="Search" />
        <kbd>⌘K</kbd>
      </label>
      <div className="topbar-end">
        <div className="members">
          {team.map((person) => (
            <Avatar key={person.initials} person={person} size={28} />
          ))}
          {pending.map((email) => (
            <span key={email} className="avatar pending" title={`${email} (invited)`}>
              {email.slice(0, 2).toUpperCase()}
            </span>
          ))}
          <span className="avatar more">+5</span>
        </div>
        <InviteButton />
        <button type="button" className="icon-button" aria-label="Notifications">
          <Bell size={16} />
          <span className="dot" />
        </button>
      </div>
    </header>
  );
}

function InviteButton() {
  const open = useStore(inviteOpen);
  return (
    <div className="invite">
      <button type="button" className="button" data-waymark="invite" onClick={() => inviteOpen.set(!open)}>
        <UserPlus size={15} />
        Invite
      </button>
      {open && <InvitePanel />}
    </div>
  );
}

function InvitePanel() {
  const [email, setEmail] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!email.includes("@")) return;
    patch({ pending: [...data.get().pending, email.trim()] });
    inviteOpen.set(false);
  };
  return (
    <form className="invite-panel" onSubmit={send}>
      <div className="panel-title">Invite to Fernhill Studio</div>
      <label className="field">
        <span>Email</span>
        <input
          name="email"
          data-waymark="invite-email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
        />
      </label>
      <label className="field">
        <span>Role</span>
        <select name="role" defaultValue="Member">
          <option>Admin</option>
          <option>Member</option>
          <option>Viewer</option>
        </select>
      </label>
      <div className="panel-actions">
        <button type="button" className="button ghost">
          <Link size={14} />
          Copy link
        </button>
        <button type="submit" className="button primary" data-waymark="send-invite">
          Send invite
        </button>
      </div>
    </form>
  );
}

function PageHeader() {
  return (
    <div className="page-header">
      <div>
        <h1>Projects</h1>
        <p className="muted">Everything Fernhill is shipping this quarter.</p>
      </div>
      <div className="page-actions">
        <button type="button" className="button" data-waymark="filter">
          <ListFilter size={15} />
          Filter
        </button>
        <button type="button" className="button primary" data-waymark="new-project" onClick={() => creatingProject.set(true)}>
          <Plus size={15} />
          New project
        </button>
      </div>
    </div>
  );
}

function Stats() {
  const { projects } = useStore(data);
  const count = (status: Status) => projects.filter((project) => project.status === status).length;
  const stats = [
    { label: "Active projects", value: projects.length, note: "+2 this month" },
    { label: "On track", value: count("On track"), note: "of active projects" },
    { label: "At risk", value: count("At risk") + count("Off track"), note: "need attention", warn: true },
    { label: "Shipped this quarter", value: 5, note: "+1 vs last quarter" },
  ];
  return (
    <div className="stats">
      {stats.map((stat) => (
        <div key={stat.label} className="stat">
          <span className="muted">{stat.label}</span>
          <b>{stat.value}</b>
          <small className={stat.warn ? "warn" : "up"}>{stat.note}</small>
        </div>
      ))}
    </div>
  );
}

const tone: Record<Status, string> = {
  "On track": "green",
  "At risk": "amber",
  "Off track": "red",
  "In review": "blue",
  Planning: "slate",
};

function Projects() {
  const { projects } = useStore(data);
  const creating = useStore(creatingProject);
  const current = useStore(tab);
  const choose = (next: Tab) => {
    tab.set(next);
    onTab(next);
  };
  const shown = current === "Mine" ? projects.filter((p) => p.owner === me || p.owner?.name === me.name) : projects;
  return (
    <section className="card projects">
      <div className="card-header">
        <h2>Active projects</h2>
        <div className="tabs" data-waymark="tabs">
          {(["All", "Mine", "Starred"] as const).map((name) => (
            <button key={name} type="button" aria-current={current === name || undefined} onClick={() => choose(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {creating && <NewProjectForm />}
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, 7).map((project) => (
            <tr key={project.id} className={project.id.startsWith("new-") ? "fresh" : undefined}>
              <td>
                <div className="project">
                  {project.name}
                  <small>{project.team}</small>
                </div>
              </td>
              <td>{project.owner ? <Owner person={project.owner} /> : <AssignOwner project={project} />}</td>
              <td>
                <span className={`badge ${tone[project.status]}`}>{project.status}</span>
              </td>
              <td>
                <div className="progress">
                  <span className="bar">
                    <span style={{ width: `${project.progress}%` }} />
                  </span>
                  {project.progress}%
                </div>
              </td>
              <td>
                <span className="due">
                  <Calendar size={13} />
                  {project.due}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Owner({ person }: { person: Person }) {
  return (
    <span className="owner">
      <Avatar person={person} size={24} />
      {person.name.split(" ")[0]}
    </span>
  );
}

function AssignOwner({ project }: { project: Project }) {
  const open = useStore(pickingOwner) === project.id;
  const assign = (owner: Person) => {
    // oxlint-disable-next-line oxc/no-map-spread -- a new object, so the store sees the change; mutating would not.
    patch({ projects: data.get().projects.map((p) => (p.id === project.id ? { ...p, owner } : p)) });
    pickingOwner.set(null);
  };
  return (
    <span className="assign">
      <button type="button" className="assign-button" data-waymark="assign-owner" onClick={() => pickingOwner.set(open ? null : project.id)}>
        <span className="avatar empty">
          <Plus size={12} />
        </span>
        Assign
      </button>
      {open && (
        <span className="owner-menu" data-waymark="owner-menu">
          {[people.hannah, people.priya, people.mateo, people.aiko].map((person) => (
            <button key={person.initials} type="button" onClick={() => assign(person)}>
              <Avatar person={person} size={22} />
              {person.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function NewProjectForm() {
  const [name, setName] = useState("");
  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const project = { id: `new-${Date.now()}`, name: trimmed, team: "Growth", owner: null, status: "Planning" as const, progress: 0, due: "Dec 12" };
    patch({ projects: [project, ...data.get().projects] });
    creatingProject.set(false);
  };
  return (
    <form className="new-project" onSubmit={create}>
      <input
        name="project-name"
        data-waymark="project-name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Project name"
        aria-label="Project name"
      />
      <span className="chip">
        <span className="team-dot" style={{ background: "#db2777" }} />
        Growth
      </span>
      <button type="button" className="button ghost" onClick={() => creatingProject.set(false)}>
        Cancel
      </button>
      <button type="submit" className="button primary" data-waymark="create-project">
        Create
      </button>
    </form>
  );
}

function GettingStarted() {
  const { snapshot, start } = useChecklist(onboarding.checklists.main);
  const done = snapshot.finishedCount;
  return (
    <section className="card getting-started">
      <div className="gs-header">
        <h2>{snapshot.complete ? "You're all set" : "Get started with Plotline"}</h2>
        <span className="muted">
          {done} of {snapshot.taskCount}
        </span>
      </div>
      <div className="gs-bar">
        <span style={{ width: `${(done / snapshot.taskCount) * 100}%` }} />
      </div>
      <ol className="tasks">
        {snapshot.tasks.map(({ task, status }) => {
          const active = snapshot.active?.task.id === task.id;
          return (
            <li key={task.id} data-status={status} data-active={active || undefined}>
              <span className="tick">{status === "done" && <Check size={12} strokeWidth={3} />}</span>
              <span className="task-text">
                <b>{task.title}</b>
                <small>{task.description}</small>
              </span>
              {status === "todo" && "walkthrough" in task && (
                <button type="button" className="button small" disabled={active} onClick={() => start(task.id)}>
                  Show me
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
