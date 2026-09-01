import { useEffect, useState } from "react";
import { api, logErr } from "./api";
import { useAuth } from "./auth";
import { SentrixMark } from "./components/Brand";
import type { Settings } from "./types";
import { Login } from "./pages/Login";
import { ChangePassword } from "./pages/ChangePassword";
import { Dashboard } from "./pages/Dashboard";
import { Exceptions } from "./pages/Exceptions";
import { WorkOrders } from "./pages/WorkOrders";
import { WeldLog } from "./pages/WeldLog";
import { NewEntryChooser } from "./components/NewEntryChooser";
import { CommandPalette } from "./components/CommandPalette";
import { Roster } from "./pages/Roster";
import { Performance } from "./pages/Performance";
import { Statistics } from "./pages/Statistics";
import { WelderStats } from "./pages/WelderStats";
import { WelderReport } from "./pages/WelderReport";
import { Monthly } from "./pages/Monthly";
import { Daily } from "./pages/Daily";
import { JobReport } from "./pages/JobReport";
import { ClientReport } from "./pages/ClientReport";
import { QmReport } from "./pages/QmReport";
import { PipeTable } from "./pages/PipeTable";
import { Legend } from "./pages/Legend";
import { Instructions } from "./pages/Instructions";
import { Users } from "./pages/Users";
import { SettingsPage } from "./pages/SettingsPage";

type PageKey =
  | "dashboard"
  | "exceptions"
  | "weldlog"
  | "workorders"
  | "roster"
  | "performance"
  | "statistics"
  | "welderstats"
  | "welderreport"
  | "monthly"
  | "daily"
  | "job"
  | "client"
  | "qm"
  | "pipe"
  | "legend"
  | "instructions"
  | "users"
  | "settings";

interface NavDef {
  key: PageKey;
  label: string;
  icon: string;
  group: string;
  desc: string;
  admin?: boolean;
}

const NAV: NavDef[] = [
  { key: "dashboard", label: "Dashboard", icon: "▚", group: "Overview", desc: "Your at-a-glance totals — weld count, RT coverage and reject rate." },
  { key: "exceptions", label: "Exceptions", icon: "⚠", group: "Overview", desc: "Every weld the validation engine flags — unresolved NDE, below-spec coverage, rejects awaiting repair, missing heat-treat. Clear the errors before closeout." },
  { key: "weldlog", label: "Weld Log", icon: "▤", group: "Records", desc: "The hub: log new welds from an isometric, search, and open a work order's records. Start here." },
  { key: "workorders", label: "Work Orders", icon: "🗂️", group: "Records", desc: "Every work order and its isometrics + welds — the records directory." },
  { key: "roster", label: "Welder Roster", icon: "☺", group: "Records", desc: "Your welders and their stamps, qualifications and status." },
  { key: "performance", label: "Performance Report", icon: "📄", group: "Reports", desc: "The distribution report: each welder's performance and proof they stayed at or above their assigned NDE spec, for a month, year, or all time. Generate a PDF for management, supervisors or the welders." },
  { key: "statistics", label: "NDE Statistics", icon: "📊", group: "Reports", desc: "Per-welder NDE compliance (5/10/20/100% + API 570), performance and reject-rate analysis. Catch anyone falling below spec." },
  { key: "welderstats", label: "Welder Statistics", icon: "％", group: "Reports", desc: "Per-welder counts and reject rates by NDE examination level." },
  { key: "welderreport", label: "Welder Report", icon: "◔", group: "Reports", desc: "A single welder's full breakdown by joint type." },
  { key: "monthly", label: "Monthly Report", icon: "▦", group: "Reports", desc: "Weld counts, RT and rejects across the twelve months of a year." },
  { key: "daily", label: "Daily Weld Count", icon: "☀", group: "Reports", desc: "How many welds were made and RT'd on a given day." },
  { key: "job", label: "Job Report", icon: "⚙", group: "Reports", desc: "Totals and examination completion for one work order." },
  { key: "client", label: "Client / TSA Report", icon: "✦", group: "Reports", desc: "The monthly per-welder summary for the client." },
  { key: "qm", label: "QM Summary", icon: "✓", group: "Reports", desc: "Quality-manager roll-up of acceptance and rejection by welder." },
  { key: "pipe", label: "Pipe Table", icon: "◎", group: "Reference", desc: "Wall thickness by nominal size and schedule — drives auto-fill." },
  { key: "legend", label: "Criteria Legend", icon: "✎", group: "Reference", desc: "What each line-spec criteria category means." },
  { key: "instructions", label: "Instructions", icon: "ℹ", group: "Reference", desc: "How the app works: repair procedure, statuses and key terms." },
  { key: "users", label: "Users", icon: "⚷", group: "Administration", admin: true, desc: "Create login profiles and set who can view or edit." },
  { key: "settings", label: "Settings", icon: "⚑", group: "Administration", admin: true, desc: "Branding, dropdown lists and your own password." },
];

/** Where the Work Orders page should open when navigated to from elsewhere. */
export type WoIntent =
  | { kind: "record"; wo: string }
  | { kind: "wizard" }
  | null;

export function App() {
  const { user, ready, logout, can } = useAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<Settings>({});
  // One app-level "New Weld Entry" chooser and a single hub (Work Orders).
  const [entryOpen, setEntryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [woIntent, setWoIntent] = useState<WoIntent>(null);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [dbShared, setDbShared] = useState<boolean | null>(null);
  const openNewEntry = () => setEntryOpen(true);
  const openWorkOrder = (wo: string) => { setWoIntent({ kind: "record", wo }); setPage("workorders"); };

  useEffect(() => {
    api.getSettings().then(setSettings).catch(logErr("loading settings"));
    api.dbInfo().then((d) => setDbShared(d.shared)).catch(logErr("loading database info"));
  }, [user]);

  // Global Ctrl/Cmd+K opens the jump box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset to the dashboard whenever the signed-in user changes, so a non-admin
  // can never land on an admin-only page left over from a previous session.
  useEffect(() => {
    setPage("dashboard");
  }, [user?.id]);

  if (!ready) {
    return <div className="auth-wrap" />;
  }
  if (!user) {
    return <Login settings={settings} />;
  }
  if (user.must_change_password) {
    return <ChangePassword forced />;
  }

  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  const current = NAV.find((n) => n.key === page);
  const title = current?.label ?? "";
  const initials = (user.display_name || user.username)
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app">
      <div className="rail-slot">
        <aside className="rail" onMouseLeave={() => setProfileOpen(false)}>
          <div className="rail-brand" title="SENTRIX — Assurance Console">
            <SentrixMark size={30} />
            <div className="rail-brand-text">
              <span className="rail-word">SENTRIX</span>
              <span className="rail-tag">Assurance Console</span>
            </div>
          </div>
          <nav className="rail-nav">
            {groups.map((g) => {
              const items = NAV.filter((n) => n.group === g && (!n.admin || can("admin")));
              if (items.length === 0) return null;
              return (
                <div key={g} className="rail-group">
                  <div className="rail-group-label">{g}</div>
                  {items.map((n) => (
                    <button
                      key={n.key}
                      className={`rail-item ${page === n.key ? "active" : ""}`}
                      onClick={() => setPage(n.key)}
                      title={n.desc}
                    >
                      <span className="rail-ico">{n.icon}</span>
                      <span className="rail-label">{n.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="rail-foot">
            <button className="rail-user" onClick={() => setProfileOpen((v) => !v)} title={user.display_name || user.username}>
              <span className="rail-avatar">{initials}</span>
              <span className="rail-label rail-user-name">{user.display_name || user.username}</span>
            </button>
            {profileOpen && (
              <div className="rail-profile">
                <div className="rail-profile-name">{user.display_name || user.username}</div>
                <div className="rail-profile-role">{user.role}</div>
                {can("admin") && (
                  <button className="rail-profile-btn" onClick={() => { setPage("settings"); setProfileOpen(false); }}>Settings</button>
                )}
                <button className="rail-profile-btn danger" onClick={() => logout()}>Sign out</button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <main className="main">
        <header className="topbar">
          <h2 title={current?.desc}>{title}</h2>
          <div className="spacer" />
          {dbShared != null && (
            <span
              className={`env-chip ${dbShared ? "shared" : "local"}`}
              title={dbShared
                ? "Shared database — everyone on this database sees the same records"
                : "Local database — changes stay on this PC and are NOT visible to the team"}
            >
              {dbShared ? "Shared" : "Local"}
            </span>
          )}
          {!can("editor") && <span className="env-chip viewer" title="Read-only account — you can view everything but not change records">Viewer</span>}
          <button className="topbar-search" onClick={() => setCmdkOpen(true)} title="Search everything (Ctrl+K)">
            ⌕ Search <kbd>Ctrl K</kbd>
          </button>
        </header>
        <div className="content">
          <PageView
            page={page}
            onNavigate={setPage}
            onNewEntry={openNewEntry}
            onOpenWorkOrder={openWorkOrder}
            woIntent={woIntent}
            clearWoIntent={() => setWoIntent(null)}
          />
        </div>
        {entryOpen && (
          <NewEntryChooser
            onClose={() => setEntryOpen(false)}
            onNew={() => { setEntryOpen(false); setWoIntent({ kind: "wizard" }); setPage("workorders"); }}
            onExisting={(wo) => { setEntryOpen(false); setWoIntent({ kind: "record", wo }); setPage("workorders"); }}
          />
        )}
        <CommandPalette
          open={cmdkOpen}
          onClose={() => setCmdkOpen(false)}
          onPick={(hit) => {
            if (hit.work_order) { openWorkOrder(hit.work_order); }
            else if (hit.kind === "welder") { setPage("roster"); }
          }}
        />
      </main>
    </div>
  );
}

function PageView({
  page,
  onNavigate,
  onNewEntry,
  onOpenWorkOrder,
  woIntent,
  clearWoIntent,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  onNewEntry: () => void;
  onOpenWorkOrder: (wo: string) => void;
  woIntent: WoIntent;
  clearWoIntent: () => void;
}) {
  switch (page) {
    case "dashboard":
      return <Dashboard onNavigate={onNavigate} onNewEntry={onNewEntry} />;
    case "exceptions":
      return <Exceptions onOpenWorkOrder={onOpenWorkOrder} />;
    case "workorders":
      return (
        <WorkOrders
          onNewEntry={onNewEntry}
          initial={woIntent}
          onConsumedInitial={clearWoIntent}
        />
      );
    case "weldlog":
      return <WeldLog onNewEntry={onNewEntry} onOpenWorkOrder={onOpenWorkOrder} />;
    case "roster":
      return <Roster />;
    case "performance":
      return <Performance />;
    case "statistics":
      return <Statistics />;
    case "welderstats":
      return <WelderStats />;
    case "welderreport":
      return <WelderReport />;
    case "monthly":
      return <Monthly />;
    case "daily":
      return <Daily />;
    case "job":
      return <JobReport />;
    case "client":
      return <ClientReport />;
    case "qm":
      return <QmReport />;
    case "pipe":
      return <PipeTable />;
    case "legend":
      return <Legend />;
    case "instructions":
      return <Instructions />;
    case "users":
      return <Users />;
    case "settings":
      return <SettingsPage />;
    default:
      return null;
  }
}
