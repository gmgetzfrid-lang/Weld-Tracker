import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Settings } from "../types";
import { ErrorBox, localTime, useToast } from "../components/ui";
import { APP_NAME, APP_VERSION } from "../version";
import { ChangePassword } from "./ChangePassword";
import { Icon } from "../components/Icon";
import { useNdeRules } from "../ndeRules";

const BRAND_FIELDS: [string, string][] = [
  ["company_name", "Company Name"],
  ["company_tagline", "Tagline"],
  ["app_title", "Application Title"],
  ["reject_rate_warn_pct", "Reject-rate warning threshold (%)"],
];

const LOOKUP_KINDS = [
  "joint_type", "material", "schedule", "status", "process", "shop_field",
];

export function SettingsPage({ onOpenRules }: { onOpenRules?: () => void }) {
  const { can } = useAuth();
  const nde = useNdeRules();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>({});
  const [lookups, setLookups] = useState<Lookups>({});
  const [error, setError] = useState<string | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [kind, setKind] = useState("joint_type");
  const [newVal, setNewVal] = useState("");
  const [db, setDb] = useState<{ path: string; shared: boolean } | null>(null);
  useEffect(() => { api.dbInfo().then(setDb).catch(logErr("loading database info")); }, []);

  // Admin: backup + activity log.
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [activity, setActivity] = useState<import("../types").AuditEntry[]>([]);
  // The activity trail is visible to everyone (transparency), newest first;
  // backup stays admin-only.
  useEffect(() => {
    api.recentActivity(null, 100).then(setActivity).catch(logErr("loading activity"));
  }, []);
  const runBackup = async () => {
    setBackingUp(true);
    try {
      const path = await api.backupDatabase();
      setLastBackup(path);
      toast.push("ok", "Backup written");
      api.recentActivity(null, 100).then(setActivity).catch(logErr("refreshing activity"));
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBackingUp(false); }
  };

  const loadLookups = () => api.lookupsGrouped().then(setLookups).catch(logErr("loading lookups"));
  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => setError(errMsg(e)));
    loadLookups();
  }, []);

  const saveSetting = async (key: string) => {
    try {
      await api.setSetting(key, settings[key] ?? "");
      toast.push("ok", "Saved");
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const addValue = async () => {
    if (!newVal.trim()) return;
    try {
      await api.addLookup(kind, newVal.trim());
      setNewVal("");
      loadLookups();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const removeValue = async (v: string) => {
    try {
      await api.removeLookup(kind, v);
      loadLookups();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 900 }}>
      <ErrorBox message={error} />

      <div className="card card-pad">
        <h3>My Account</h3>
        <p className="muted">Update the password for your own login.</p>
        <button className="btn" onClick={() => setShowChangePw(true)}>Change my password</button>
      </div>

      {can("admin") && (
        <div className="card card-pad">
          <h3>Branding &amp; Company</h3>
          <div className="form-grid cols-2">
            {BRAND_FIELDS.map(([key, label]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={settings[key] ?? ""}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                  />
                  <button className="btn btn-sm" onClick={() => saveSetting(key)}>Save</button>
                </div>
              </div>
            ))}
          </div>
          <p className="hint">
            The SENTRIX mark shown on the sign-in screen and navigation rail is
            rendered by the app; set a company name and tagline above to brand
            reports for your facility.
          </p>
        </div>
      )}

      <div className="card card-pad">
        <h3>Examination rules</h3>
        <p className="muted">
          The NDE table every weld's required coverage is computed from — service and material rows with shop and field
          percentages, the vocabularies, the tie-in override, supplemental rules, coverage specs and progressive sampling.
          Nothing is hard-coded: an administrator can change it and activate a new revision.
        </p>
        <dl className="kv">
          <dt>In force</dt><dd>{nde.rules ? <>{nde.rules.name} <span className="badge badge-green" style={{ marginLeft: 6 }}>{nde.rules.id}</span></> : "…"}</dd>
          <dt>Revision</dt><dd style={{ fontWeight: 400 }}>{nde.rules?.revision || "—"}</dd>
          <dt>Source</dt><dd style={{ fontWeight: 400 }}>{nde.rules?.source || "—"}</dd>
          <dt>Coverage rows</dt><dd style={{ fontWeight: 400 }}>{nde.rules ? `${nde.rules.rows.length} rows · ${nde.rules.specs.length} coverage specs · ${nde.rules.materials.length} material groups` : "—"}</dd>
        </dl>
        {onOpenRules && (
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onOpenRules}>
            <Icon name="sliders" size={14} /> {can("admin") ? "Open the rules editor" : "View the examination rules"}
          </button>
        )}
      </div>

      {can("editor") && (
        <div className="card card-pad">
          <h3>Dropdown Lists</h3>
          <p className="muted">Manage the values available in record dropdowns.</p>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="btn" style={{ padding: "7px 10px" }}>
              {LOOKUP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input
              placeholder="Add value…"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addValue()}
              style={{ padding: "8px 11px", border: "1px solid var(--border-strong)", borderRadius: 8 }}
            />
            <button className="btn btn-primary" onClick={addValue}>Add</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(lookups[kind] ?? []).map((v) => (
              <span key={v} className="badge badge-gray" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "4px 8px 4px 12px" }}>
                {v}
                <button
                  onClick={() => removeValue(v)}
                  style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--danger)", fontWeight: 700 }}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
            {(lookups[kind] ?? []).length === 0 && <span className="faint">No values.</span>}
          </div>
        </div>
      )}

      <div className="card card-pad">
        <h3>About</h3>
        <dl className="kv">
          <dt>Application</dt><dd>{APP_NAME} v{APP_VERSION}</dd>
          <dt>Database mode</dt>
          <dd>
            {db == null ? "…" : db.shared
              ? <span className="badge badge-green">Shared — everyone on this database sees the same data</span>
              : <span className="badge badge-gray">This PC only (local)</span>}
          </dd>
          <dt>Database file</dt>
          <dd style={{ fontWeight: 400, wordBreak: "break-all", fontFamily: "monospace", fontSize: 13 }}>
            {db?.path ?? "…"}
          </dd>
          <dt>Converted from</dt><dd style={{ fontWeight: 400 }}>Weld_Log_Statistics workbook</dd>
        </dl>
        {db && !db.shared && (
          <p className="hint" style={{ marginTop: 10 }}>
            To share this data across your team, put the portable app on a network
            drive with a <code>weld-tracker.portable</code> marker file, or set a{" "}
            <code>weld-tracker.json</code> pointing <code>database_path</code> to a
            shared location. See the README.
          </p>
        )}
      </div>

      <div className="card card-pad">
        <h3>Support</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          The app writes a per-user diagnostic log (startup, database path,
          errors). Attach it when reporting a problem.
        </p>
        <button
          className="btn"
          onClick={() => api.openLogFolder().catch((e) => toast.push("err", errMsg(e)))}
        >
          Open log folder
        </button>
      </div>

      {can("admin") && (
        <div className="card card-pad">
          <h3>Backup</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Write a timestamped snapshot of the whole database into a{" "}
            <code>backups</code> folder beside the live file. Safe to run while
            the app is in use.
          </p>
          <button className="btn btn-accent" onClick={runBackup} disabled={backingUp}>
            {backingUp ? "Backing up…" : "Back up database now"}
          </button>
          {lastBackup && (
            <p className="hint" style={{ marginTop: 10, wordBreak: "break-all", fontFamily: "monospace", fontSize: 13 }}>
              <Icon name="check" size={13} /> {lastBackup}
            </p>
          )}
        </div>
      )}

      {(
        <div className="card card-pad">
          <h3>Recent Activity</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            The audit trail — who did what, newest first. Weld edits record which
            fields changed.
          </p>
          {activity.length === 0 ? (
            <p className="faint">No activity recorded yet.</p>
          ) : (
            <div className="activity-log">
              {activity.map((a) => (
                <div key={a.id} className="activity-row">
                  <span className="activity-ts" title={a.ts + " UTC"}>{localTime(a.ts)}</span>
                  <span className={`activity-action act-${a.action ?? ""}`}>{a.action ?? "—"}</span>
                  <span className="activity-who">{a.username ?? "—"}</span>
                  <span className="activity-what">
                    {a.entity ?? ""}{a.entity_id ? ` #${a.entity_id}` : ""}
                    {a.detail ? ` — ${a.detail}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showChangePw && <ChangePassword onClose={() => setShowChangePw(false)} />}
    </div>
  );
}
