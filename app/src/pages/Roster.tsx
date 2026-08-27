import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Welder } from "../types";
import {
  ErrorBox,
  Modal,
  Spinner,
  downloadCsv,
  useToast,
} from "../components/ui";

const EMPTY: Welder = { id: 0, stamp: "", name: "", active: true };

export function Roster() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Welder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("name");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState<Welder | null | undefined>(undefined);
  const [lookups, setLookups] = useState<Lookups>({});

  useEffect(() => {
    api.lookupsGrouped().then(setLookups).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listWelders(includeInactive, sortBy)
      .then(setRows)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [includeInactive, sortBy]);

  useEffect(load, [load]);

  const exportCsv = () => {
    downloadCsv("welder-roster.csv", [
      ["Stamp", "Name", "Shift", "Crew", "Process", "Active", "WPQs", "WPQ Status", "Training"],
      ...rows.map((w) => [
        w.stamp, w.name, w.shift ?? "", w.crew ?? "", w.process ?? "",
        w.active ? "Yes" : "No", w.wpqs ?? "", w.wpq_status ?? "", w.training ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <div className="toolbar">
        <div className="pill-tabs">
          <button className={sortBy === "name" ? "active" : ""} onClick={() => setSortBy("name")}>
            Sort by Name
          </button>
          <button className={sortBy === "stamp" ? "active" : ""} onClick={() => setSortBy("stamp")}>
            Sort by Stamp
          </button>
        </div>
        <label className="checkline" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} welders</span>
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
        {can("editor") && (
          <button className="btn btn-primary" onClick={() => setEditing(null)}>
            + New Welder
          </button>
        )}
      </div>

      <ErrorBox message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Stamp</th>
                <th>Name</th>
                <th>Shift</th>
                <th>Crew</th>
                <th>Process</th>
                <th>WPQ Status</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="table-empty">No welders on the roster.</td></tr>
              )}
              {rows.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => setEditing(w)}>
                  <td style={{ fontWeight: 600 }}>{w.stamp}</td>
                  <td>{w.name}</td>
                  <td>{w.shift ?? "—"}</td>
                  <td>{w.crew ?? "—"}</td>
                  <td>{w.process ?? "—"}</td>
                  <td style={{ whiteSpace: "pre-line", maxWidth: 260 }}>
                    {w.wpq_status ?? "—"}
                  </td>
                  <td>
                    {w.active ? (
                      <span className="badge badge-green">Active</span>
                    ) : (
                      <span className="badge badge-gray">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <WelderEditor
          welder={editing}
          lookups={lookups}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
            toast.push("ok", "Roster updated");
          }}
        />
      )}
    </div>
  );
}

function WelderEditor({
  welder,
  lookups,
  onClose,
  onSaved,
}: {
  welder: Welder | null;
  lookups: Lookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("editor");
  const [w, setW] = useState<Welder>(welder ? { ...welder } : { ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Welder>(k: K, v: Welder[K]) =>
    setW((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setError(null);
    try {
      if (w.id) await api.updateWelder(w);
      else await api.createWelder(w);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const del = async () => {
    if (!w.id) return;
    if (!confirm(`Delete welder ${w.name}?`)) return;
    try {
      await api.deleteWelder(w.id);
      onSaved();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  return (
    <Modal
      title={w.id ? `Welder ${w.stamp}` : "New Welder"}
      onClose={onClose}
      footer={
        <>
          {w.id && editable && (
            <>
              <button className="btn btn-danger" onClick={del}>Delete</button>
              <div style={{ flex: 1 }} />
            </>
          )}
          <button className="btn" onClick={onClose}>Close</button>
          {editable && (
            <button className="btn btn-primary" onClick={save}>Save</button>
          )}
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="form-grid cols-2">
        <div className="field">
          <label>Welder Stamp *</label>
          <input value={w.stamp} disabled={!editable} onChange={(e) => set("stamp", e.target.value)} />
        </div>
        <div className="field">
          <label>Name *</label>
          <input value={w.name} disabled={!editable} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label>Shift</label>
          <select value={w.shift ?? ""} disabled={!editable} onChange={(e) => set("shift", e.target.value || null)}>
            <option value="">—</option>
            {(lookups.shift ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Crew</label>
          <select value={w.crew ?? ""} disabled={!editable} onChange={(e) => set("crew", e.target.value || null)}>
            <option value="">—</option>
            {(lookups.crew ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Process</label>
          <select value={w.process ?? ""} disabled={!editable} onChange={(e) => set("process", e.target.value || null)}>
            <option value="">—</option>
            {(lookups.process ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label className="checkline" style={{ marginTop: 26 }}>
          <input type="checkbox" disabled={!editable} checked={w.active} onChange={(e) => set("active", e.target.checked)} />
          Active
        </label>
      </div>
      <div className="field">
        <label>WPQs (Weld Procedure Qualifications)</label>
        <textarea value={w.wpqs ?? ""} disabled={!editable} onChange={(e) => set("wpqs", e.target.value)} />
      </div>
      <div className="field">
        <label>WPQ Status</label>
        <textarea value={w.wpq_status ?? ""} disabled={!editable} onChange={(e) => set("wpq_status", e.target.value)} />
      </div>
      <div className="field">
        <label>Training</label>
        <textarea value={w.training ?? ""} disabled={!editable} onChange={(e) => set("training", e.target.value)} />
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={w.notes ?? ""} disabled={!editable} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </Modal>
  );
}
