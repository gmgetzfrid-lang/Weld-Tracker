import { useEffect, useState } from "react";
import { api, logErr } from "./api";
import { useAuth } from "./auth";
import { SentrixMark } from "./components/Brand";
import type { Settings } from "./types";
import { Login } from "./pages/Login";
import { ChangePassword } from "./pages/ChangePassword";
import { Dashboard } from "./pages/Dashboard";
import { Exceptions } from "./pages/Exceptions";
import { Lots } from "./pages/Lots";
import { AttentionBadge, LotMaintenance } from "./components/lots";
import { WorkOrders } from "./pages/WorkOrders";
import { WeldLog } from "./pages/WeldLog";
import { NewEntryChooser } from "./components/NewEntryChooser";
import { CommandPalette } from "./components/CommandPalette";
import { Roster } from "./pages/Roster";
import { Reports, type ReportTab } from "./pages/Reports";
import { PipeTable } from "./pages/PipeTable";
import { Legend } from "./pages/Legend";
import { Instructions } from "./pages/Instructions";
import { Users } from "./pages/Users";
import { SettingsPage } from "./pages/SettingsPage";

type PageKey =
  | "dashboard"
  | "exceptions"
  | "lots"
  | "weldlog"
  | "workorders"
  | "roster"
  | "reports"
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
  { key: "dashboard", label: "Dashboard", icon: "▚", group: "Overview", desc: "What needs attention now, plus your at-a-glance totals." },
  { key: "exceptions", label: "Exceptions", icon: "⚠", group: "Overview", desc: "Every weld the validation engine flags — unresolved NDE, below-spec coverage, rejects awaiting repair, missing heat-treat." },
  { key: "lots", label: "NDE Lots", icon: "▦", group: "Overview", desc: "ASME B31.3 examination lots — the bounded populations each welder's NDE percentage and progressive sampling are judged in. Turnover, closeout and what's owed." },
  { key: "workorders", label: "Work Orders", icon: "🗂️", group: "Records", desc: "Every work order and its isometrics + welds — the records directory. Start here." },
  { key: "weldlog", label: "Weld Log", icon: "▤", group: "Records", desc: "The searchable ledger of every weld across all work orders." },
  { key: "roster", label: "Welder Roster", icon: "☺", group: "Records", desc: "Your welders and their stamps, qualifications and status." },
  { key: "reports", label: "Reports", icon: "📊", group: "Reports", desc: "Performance, NDE compliance, welder statistics, monthly/daily counts, job, client/TSA and QM summaries." },
  { key: "pipe", label: "Pipe Table", icon: "◎", group: "Reference", desc: "Wall thickness by nominal size and schedule — drives auto-fill." },
  { key: "legend", label: "Criteria Legend", icon: "✎", group: "Reference", desc: "What each line-spec criteria category means." },
  { key: "instructions", label: "Instructions", icon: "ℹ", group: "Reference", desc: "How the app works: repair procedure, statuses and key terms." },
  { key: "users", label: "Users", icon: "⚷", group: "Administration", admin: true, desc: "Create login profiles and set who can view or edit." },
  { key: "settings", label: "Settings", icon: "⚑", group: "Administration", admin: true, desc: "Branding, dropdown lists, backups and support." },
];

/** Where the Work Orders page should open when navigated to from elsewhere. */
export type WoIntent =
  | { kind: "record"; wo: string }
  | { kind: "wizard"; wo?: string }
  | null;

export function App() {
  const { user, ready, logout, can } = useAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<Settings>({});
  // One app-level "New Weld Entry" chooser and a single hub (Work Orders).
  const [entryOpen, setEntryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [woIntent, setWoIntent] = useState<WoIntent>(null);
  const [lotIntent, setLotIntent] = useState<number | null>(null);
  // Bumped whenever lots change so the topbar attention badge refreshes.
  const [attnTick, setAttnTick] = useState(0);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [dbShared, setDbShared] = useState<boolean | null>(null);
  const [reportTab, setReportTab] = useState<ReportTab>("performance");
  const [railPinned, setRailPinned] = useState<boolean>(() => {
    try { return localStorage.getItem("rail-pinned") === "1"; } catch { return false; }
  });
  const togglePin = () => setRailPinned((v) => {
    const next = !v;
    try { localStorage.setItem("rail-pinned", next ? "1" : "0"); } catch { /* per-user convenience only */ }
    return next;
  });
  const REPORT_KEYS: PageKey[] = ["performance", "statistics", "welderstats", "welderreport", "monthly", "daily", "job", "client", "qm"];
  // Deep links from other pages may still target a specific report — fold them
  // into the Reports hub with that tab active.
  const navigate = (p: PageKey) => {
    if (REPORT_KEYS.includes(p)) { setReportTab(p as ReportTab); setPage("reports"); }
    else setPage(p);
  };
  const openNewEntry = () => setEntryOpen(true);
  const openWorkOrder = (wo: string) => { setWoIntent({ kind: "record", wo }); setPage("workorders"); };
  const openLot = (id: number | null) => { setLotIntent(id); setPage("lots"); };

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
    <div className={`app ${railPinned ? "rail-pinned" : ""}`}>
      <div className="rail-slot">
        <aside className={`rail ${railPinned ? "pinned" : ""}`} onMouseLeave={() => setProfileOpen(false)}>
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
                      onClick={() => navigate(n.key)}
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
            <button className="rail-item rail-pin" onClick={togglePin}
              title={railPinned ? "Unpin the menu (expand on hover)" : "Keep the menu open"}>
              <span className="rail-ico">{railPinned ? "⇤" : "⇥"}</span>
              <span className="rail-label">{railPinned ? "Unpin menu" : "Pin menu open"}</span>
            </button>
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
          <AttentionBadge tick={`${page}-${attnTick}`} onClick={() => setPage("lots")} />
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
            reportTab={reportTab}
            onNavigate={navigate}
            onNewEntry={openNewEntry}
            onOpenWorkOrder={openWorkOrder}
            onOpenLot={openLot}
            woIntent={woIntent}
            clearWoIntent={() => setWoIntent(null)}
            lotIntent={lotIntent}
            clearLotIntent={() => setLotIntent(null)}
          />
        </div>
        <LotMaintenance onOpenLots={() => setPage("lots")} onChanged={() => setAttnTick((t) => t + 1)} />
        {entryOpen && (
          <NewEntryChooser
            onClose={() => setEntryOpen(false)}
            onNew={(wo) => { setEntryOpen(false); setWoIntent({ kind: "wizard", wo }); setPage("workorders"); }}
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
  reportTab,
  onNavigate,
  onNewEntry,
  onOpenWorkOrder,
  onOpenLot,
  woIntent,
  clearWoIntent,
  lotIntent,
  clearLotIntent,
}: {
  page: PageKey;
  reportTab: ReportTab;
  onNavigate: (p: PageKey) => void;
  onNewEntry: () => void;
  onOpenWorkOrder: (wo: string) => void;
  onOpenLot: (id: number | null) => void;
  woIntent: WoIntent;
  clearWoIntent: () => void;
  lotIntent: number | null;
  clearLotIntent: () => void;
}) {
  switch (page) {
    case "dashboard":
      return <Dashboard onNavigate={onNavigate} onNewEntry={onNewEntry} onOpenWorkOrder={onOpenWorkOrder} onOpenLot={onOpenLot} />;
    case "exceptions":
      return <Exceptions onOpenWorkOrder={onOpenWorkOrder} />;
    case "lots":
      return <Lots onOpenWorkOrder={onOpenWorkOrder} initialLotId={lotIntent} onConsumedInitial={clearLotIntent} />;
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
    case "reports":
      return <Reports initialTab={reportTab} />;
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
