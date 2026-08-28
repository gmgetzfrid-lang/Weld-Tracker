import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Settings } from "../types";
import { ErrorBox, useToast } from "../components/ui";
import { ChangePassword } from "./ChangePassword";

const BRAND_FIELDS: [string, string][] = [
  ["company_name", "Company Name"],
  ["company_tagline", "Tagline"],
  ["app_title", "Application Title"],
  ["reject_rate_warn_pct", "Reject-rate warning threshold (%)"],
];

const LOOKUP_KINDS = [
  "joint_type", "material", "schedule", "status", "process", "shop_field",
];

export function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>({});
  const [lookups, setLookups] = useState<Lookups>({});
  const [error, setError] = useState<string | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [kind, setKind] = useState("joint_type");
  const [newVal, setNewVal] = useState("");
  const [db, setDb] = useState<{ path: string; shared: boolean } | null>(null);
  useEffect(() => { api.dbInfo().then(setDb).catch(() => {}); }, []);

  const loadLookups = () => api.lookupsGrouped().then(setLookups).catch(() => {});
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
            The company logo shown on the sign-in screen and sidebar is the Kern
            Energy mark bundled with the app.
          </p>
        </div>
      )}

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
          <dt>Application</dt><dd>Kern Energy Weld Tracker v0.1</dd>
          <dt>Database mode</dt>
          <dd>
            {db == null ? "…" : db.shared
              ? <span className="badge badge-green">Shared — everyone on this database sees the same data</span>
              : <span className="badge badge-gray">This PC only (local)</span>}
          </dd>
          <dt>Database file</dt>
          <dd style={{ fontWeight: 400, wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
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

      {showChangePw && <ChangePassword onClose={() => setShowChangePw(false)} />}
    </div>
  );
}
