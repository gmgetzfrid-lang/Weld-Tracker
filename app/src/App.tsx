import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import logo from "./assets/kern-energy-logo.png";
import type { Settings } from "./types";
import { Login } from "./pages/Login";
import { ChangePassword } from "./pages/ChangePassword";
import { Dashboard } from "./pages/Dashboard";
import { Drawings } from "./pages/Drawings";
import { WeldLog } from "./pages/WeldLog";
import { Roster } from "./pages/Roster";
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
  | "drawings"
  | "weldlog"
  | "roster"
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
  { key: "drawings", label: "Drawings", icon: "📐", group: "Records", desc: "Add an isometric, drop weld bubbles on it, and the weld log fills itself. Start here." },
  { key: "weldlog", label: "Weld Log", icon: "▤", group: "Records", desc: "Every weld on record. Search, filter, edit, or log a repair." },
  { key: "roster", label: "Welder Roster", icon: "☺", group: "Records", desc: "Your welders and their stamps, qualifications and status." },
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

export function App() {
  const { user, ready, logout, can } = useAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<Settings>({});

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, [user]);

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
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="Kern Energy" />
        </div>
        <nav className="sidebar-nav">
          {groups.map((g) => {
            const items = NAV.filter(
              (n) => n.group === g && (!n.admin || can("admin"))
            );
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <div className="nav-group-label">{g}</div>
                {items.map((n) => (
                  <button
                    key={n.key}
                    className={`nav-item ${page === n.key ? "active" : ""}`}
                    onClick={() => setPage(n.key)}
                    title={n.desc}
                  >
                    <span className="nav-ico">{n.icon}</span>
                    {n.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {settings.app_title || "Weld Tracker"} · v0.1
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>{title}</h2>
            {current?.desc && <div className="topbar-sub">{current.desc}</div>}
          </div>
          <div className="spacer" />
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>
                {user.display_name || user.username}
              </div>
              <div style={{ fontSize: 11, textTransform: "capitalize" }}>
                {user.role}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </header>
        <div className="content">
          <PageView page={page} onNavigate={setPage} />
        </div>
      </main>
    </div>
  );
}

function PageView({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
}) {
  switch (page) {
    case "dashboard":
      return <Dashboard onNavigate={onNavigate} />;
    case "drawings":
      return <Drawings />;
    case "weldlog":
      return <WeldLog />;
    case "roster":
      return <Roster />;
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
