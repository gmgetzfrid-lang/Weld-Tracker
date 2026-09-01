import { useCallback, useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Welder, WelderCert, WelderContinuity } from "../types";
import { ConfirmDialog, ErrorBox, Modal, Spinner, downloadCsv, useToast } from "../components/ui";
import { fileToBase64 } from "../pdf";
import { continuityPdf, printContinuity } from "../continuity";

const EMPTY: Welder = { id: 0, stamp: "", name: "", active: true };

export function Roster() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Welder[]>([]);
  const [certs, setCerts] = useState<Record<number, WelderCert[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("name");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState<Welder | null | undefined>(undefined);
  const [continuity, setContinuity] = useState<Welder | null>(null);
  const [lookups, setLookups] = useState<Lookups>({});

  useEffect(() => {
    api.lookupsGrouped().then(setLookups).catch(logErr("loading lookups"));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listWelders(includeInactive, sortBy)
      .then(async (ws) => {
        setRows(ws);
        const pairs = await Promise.all(
          ws.map(async (w) => [w.id, await api.listWelderCerts(w.id).catch((e) => { logErr("loading welder certs")(e); return []; })] as const)
        );
        setCerts(Object.fromEntries(pairs));
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [includeInactive, sortBy]);

  useEffect(load, [load]);

  const exportCsv = () => {
    const header = ["Stamp", "Name", "Active", "Cert (alias)", "Process", "Status", "Qualified", "Last X-ray", "Continuous through"];
    const out: (string | number)[][] = [header];
    for (const w of rows) {
      const cs = certs[w.id] ?? [];
      if (cs.length === 0) out.push([w.stamp, w.name, w.active ? "Yes" : "No", "", "", "", "", "", ""]);
      for (const c of cs)
        out.push([w.stamp, w.name, w.active ? "Yes" : "No", c.alias, c.process ?? "", c.status, c.qualified_date ?? "", c.last_activity ?? "", c.continuous_through ?? ""]);
    }
    downloadCsv("welder-roster.csv", out);
  };

  const openCertFile = async (c: WelderCert) => {
    if (!c.has_file) return;
    try {
      await api.openWelderCert(c.id);
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div className="pill-tabs">
          <button className={sortBy === "name" ? "active" : ""} onClick={() => setSortBy("name")}>Sort by Name</button>
          <button className={sortBy === "stamp" ? "active" : ""} onClick={() => setSortBy("stamp")}>Sort by Stamp</button>
        </div>
        <label className="checkline" style={{ margin: 0 }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show inactive
        </label>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} welders</span>
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
        {can("editor") && (
          <button className="btn btn-primary" onClick={() => setEditing(null)}>+ New Welder</button>
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
                <th>Qualifications (cert · status · file)</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="table-empty">No welders on the roster.</td></tr>
              )}
              {rows.map((w) => {
                const cs = certs[w.id] ?? [];
                return (
                  <tr key={w.id} className="clickable" onClick={() => setEditing(w)}>
                    <td style={{ fontWeight: 600 }}>{w.stamp}</td>
                    <td>{w.name}</td>
                    <td>
                      {cs.length === 0 ? (
                        <span className="faint">no certs</span>
                      ) : (
                        <div className="cert-chips">
                          {cs.map((c) => (
                            <span
                              key={c.id}
                              className={`cert-chip ${c.status === "Active" ? "on" : "off"} ${c.has_file ? "hasfile" : ""}`}
                              title={`${c.process ? c.process + " · " : ""}${c.status}${c.continuous_through ? " · continuous thru " + c.continuous_through : ""}${c.has_file ? " · click to open the WPQ" : " · no file"}`}
                              onClick={(e) => { e.stopPropagation(); openCertFile(c); }}
                            >
                              <span className={`dot ${c.status === "Active" ? "green" : "gray"}`} />
                              {c.alias}
                              {c.has_file && <span className="clip">📎</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {w.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Inactive</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm" onClick={() => setContinuity(w)}>Continuity</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <WelderEditor
          welder={editing}
          lookups={lookups}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load(); toast.push("ok", "Roster updated"); }}
        />
      )}

      {continuity && (
        <ContinuityModal welder={continuity} onClose={() => setContinuity(null)} />
      )}
    </div>
  );
}

function WelderEditor({
  welder, lookups, onClose, onSaved,
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
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = <K extends keyof Welder>(k: K, v: Welder[K]) => setW((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (w.id) await api.updateWelder(w);
      else {
        const id = await api.createWelder(w);
        setW((p) => ({ ...p, id }));
        toast.push("ok", "Welder created — you can now add qualifications");
        return; // stay open so certs can be added
      }
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!w.id) return;
    try { await api.deleteWelder(w.id); onSaved(); } catch (e) { toast.push("err", errMsg(e)); }
  };

  return (
    <Modal
      title={w.id ? `Welder ${w.stamp}` : "New Welder"}
      onClose={onClose}
      wide
      footer={
        <>
          {w.id && editable && (<><button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Delete</button><div style={{ flex: 1 }} /></>)}
          <button className="btn" onClick={onClose}>Close</button>
          {editable && (
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : w.id ? "Save" : "Create"}
            </button>
          )}
        </>
      }
    >
      {confirmDel && (
        <ConfirmDialog
          title={`Delete welder ${w.name || w.stamp}`}
          body="The welder and their qualification records are removed from the roster. Welds already logged under their stamp are kept."
          confirmLabel="Delete welder"
          danger
          onConfirm={() => { setConfirmDel(false); del(); }}
          onClose={() => setConfirmDel(false)}
        />
      )}
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
        <label className="checkline" style={{ marginTop: 26 }}>
          <input type="checkbox" disabled={!editable} checked={w.active} onChange={(e) => set("active", e.target.checked)} />
          Active welder
        </label>
      </div>

      {w.id ? (
        <CertManager welderId={w.id} lookups={lookups} editable={editable} />
      ) : (
        <div className="empty-hint" style={{ marginTop: 12 }}>
          Save the welder first, then add their qualifications (certs & WPQ documents).
        </div>
      )}

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

function CertManager({
  welderId, lookups, editable,
}: {
  welderId: number;
  lookups: Lookups;
  editable: boolean;
}) {
  const toast = useToast();
  const [certs, setCerts] = useState<WelderCert[]>([]);
  const [loading, setLoading] = useState(true);
  // One action at a time, and every action announces itself: "add",
  // "up-<id>", "open-<id>" — buttons disable and show progress so a
  // multi-second file write never reads as a dead click.
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<WelderCert | null>(null);
  const [adding, setAdding] = useState<{ alias: string; process: string; qualified_date: string; file: File | null }>({
    alias: "", process: "", qualified_date: "", file: null,
  });

  const load = useCallback(() => {
    api.listWelderCerts(welderId).then(setCerts).catch(logErr("loading certs")).finally(() => setLoading(false));
  }, [welderId]);
  useEffect(load, [load]);

  const fmtMb = (n: number) => (n / 1024 / 1024).toFixed(1);

  const addCert = async () => {
    if (!adding.alias.trim()) return toast.push("err", "Give the cert an alias (name)");
    if (busy) return;
    setBusy("add");
    try {
      const id = await api.createWelderCert({
        id: 0, welder_id: welderId, alias: adding.alias.trim(),
        process: adding.process || null, qualified_date: adding.qualified_date || null,
        has_file: false, status: "", weld_count: 0,
      } as WelderCert);
      if (adding.file) {
        const b64 = await fileToBase64(adding.file);
        await api.setWelderCertFile(id, adding.file.name, b64);
      }
      const withFile = adding.file ? ` with ${adding.file.name} (${fmtMb(adding.file.size)} MB)` : "";
      setAdding({ alias: "", process: "", qualified_date: "", file: null });
      load();
      toast.push("ok", `Cert added${withFile}`);
    } catch (e) {
      toast.push("err", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const uploadTo = async (c: WelderCert, file: File) => {
    if (busy) return;
    setBusy(`up-${c.id}`);
    try {
      const b64 = await fileToBase64(file);
      await api.setWelderCertFile(c.id, file.name, b64);
      load();
      toast.push("ok", `Attached ${file.name} (${fmtMb(file.size)} MB)`);
    } catch (e) { toast.push("err", errMsg(e)); } finally { setBusy(null); }
  };

  const open = async (c: WelderCert) => {
    if (busy) return;
    setBusy(`open-${c.id}`);
    try {
      await api.openWelderCert(c.id);
    } catch (e) { toast.push("err", errMsg(e)); } finally { setBusy(null); }
  };

  const saveField = async (c: WelderCert, patch: Partial<WelderCert>) => {
    try { await api.updateWelderCert({ ...c, ...patch }); load(); } catch (e) { toast.push("err", errMsg(e)); }
  };

  const del = async (c: WelderCert) => {
    try { await api.deleteWelderCert(c.id); load(); toast.push("ok", `Removed ${c.alias}`); } catch (e) { toast.push("err", errMsg(e)); }
  };

  return (
    <div className="field">
      <label>Qualifications — WPQ Certs</label>
      <p className="hint" style={{ marginTop: 0 }}>
        Each cert is a named qualification for a process, with its WPQ document. Status is automatic:
        <b> Active</b> when x-rayed to within six months, else <b>Inactive</b>. These aliases are what you
        pick per weld in the Weld Log.
      </p>
      {loading ? <Spinner /> : (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table className="data">
            <thead>
              <tr><th>Alias</th><th>Process</th><th>Qualified</th><th>Status</th><th>Last X-ray</th><th>Document</th><th></th></tr>
            </thead>
            <tbody>
              {certs.length === 0 && <tr><td colSpan={7} className="table-empty">No certs yet.</td></tr>}
              {certs.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {editable ? <input defaultValue={c.alias} style={{ width: 130 }} onBlur={(e) => e.target.value !== c.alias && saveField(c, { alias: e.target.value })} /> : c.alias}
                  </td>
                  <td>
                    {editable ? (
                      <select defaultValue={c.process ?? ""} onChange={(e) => saveField(c, { process: e.target.value || null })}>
                        <option value="">—</option>
                        {(lookups.process ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (c.process ?? "—")}
                  </td>
                  <td>
                    {editable ? <input type="date" defaultValue={c.qualified_date ?? ""} onChange={(e) => saveField(c, { qualified_date: e.target.value || null })} /> : (c.qualified_date ?? "—")}
                  </td>
                  <td>
                    <span className={`badge ${c.status === "Active" ? "badge-green" : "badge-gray"}`} title={c.continuous_through ? `continuous through ${c.continuous_through}` : "no continuity yet"}>{c.status}</span>
                  </td>
                  <td>{c.last_activity ?? <span className="faint">—</span>}</td>
                  <td>
                    {c.has_file ? (
                      <button className="btn btn-sm" disabled={busy === `open-${c.id}`} onClick={() => open(c)}>
                        {busy === `open-${c.id}` ? "Opening…" : <>📎 {c.file_name || "open"}</>}
                      </button>
                    ) : <span className="faint">none</span>}
                    {editable && (
                      <label className={`btn btn-sm ${busy === `up-${c.id}` ? "btn-busy" : ""}`} style={{ marginLeft: 6, cursor: busy ? "wait" : "pointer" }}>
                        {busy === `up-${c.id}` ? "Uploading…" : c.has_file ? "Replace" : "Upload WPQ"}
                        <input type="file" hidden disabled={!!busy} accept=".pdf,image/*,.doc,.docx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadTo(c, f); }} />
                      </label>
                    )}
                  </td>
                  <td>{editable && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDel(c)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="cert-add">
          <input placeholder="Cert alias (e.g. 6G GTAW CS)" value={adding.alias} disabled={busy === "add"} onChange={(e) => setAdding((a) => ({ ...a, alias: e.target.value }))} />
          <select value={adding.process} disabled={busy === "add"} onChange={(e) => setAdding((a) => ({ ...a, process: e.target.value }))}>
            <option value="">Process…</option>
            {(lookups.process ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" title="Date qualified" value={adding.qualified_date} disabled={busy === "add"} onChange={(e) => setAdding((a) => ({ ...a, qualified_date: e.target.value }))} />
          {adding.file ? (
            <span className="cert-filechip" title={`${adding.file.name} (${fmtMb(adding.file.size)} MB) — attached when you add the cert`}>
              📎 {adding.file.name.length > 22 ? adding.file.name.slice(0, 20) + "…" : adding.file.name}
              <button type="button" className="cert-filechip-x" title="Remove the chosen file" onClick={() => setAdding((a) => ({ ...a, file: null }))}>✕</button>
            </span>
          ) : (
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              WPQ file…
              <input type="file" hidden accept=".pdf,image/*,.doc,.docx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setAdding((a) => ({ ...a, file: f })); }} />
            </label>
          )}
          <button className="btn btn-primary btn-sm" disabled={busy === "add" || !adding.alias.trim()} onClick={addCert}>
            {busy === "add" ? "Adding…" : "+ Add cert"}
          </button>
        </div>
      )}
      <p className="hint">You can add the cert now and attach the WPQ document later — every row has an Upload button.</p>

      {confirmDel && (
        <ConfirmDialog
          title={`Remove cert ${confirmDel.alias}`}
          body="The qualification and its WPQ document are removed from this welder's record."
          confirmLabel="Remove cert"
          danger
          onConfirm={() => { const c = confirmDel; setConfirmDel(null); if (c) del(c); }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function ContinuityModal({ welder, onClose }: { welder: Welder; onClose: () => void }) {
  const toast = useToast();
  const [c, setC] = useState<WelderContinuity | null>(null);
  useEffect(() => {
    api.welderContinuity(welder.id).then(setC).catch((e) => toast.push("err", errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welder.id]);

  return (
    <Modal
      title={`Continuity Log — ${welder.name} (${welder.stamp})`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <div style={{ flex: 1 }} />
          {c && <button className="btn" onClick={() => printContinuity(c)}>🖨 Print</button>}
          {c && <button className="btn btn-primary" onClick={() => continuityPdf(c)}>⭳ Export PDF</button>}
        </>
      }
    >
      {!c ? <Spinner /> : (
        <>
          <h4 style={{ marginTop: 0 }}>Qualifications</h4>
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="data">
              <thead><tr><th>Cert</th><th>Process</th><th>Status</th><th>Qualified</th><th>Last X-ray</th><th>Continuous thru</th><th className="num">Welds</th></tr></thead>
              <tbody>
                {c.certs.length === 0 && <tr><td colSpan={7} className="table-empty">No certs.</td></tr>}
                {c.certs.map((ct) => (
                  <tr key={ct.id}>
                    <td style={{ fontWeight: 600 }}>{ct.alias}</td>
                    <td>{ct.process ?? "—"}</td>
                    <td><span className={`badge ${ct.status === "Active" ? "badge-green" : "badge-gray"}`}>{ct.status}</span></td>
                    <td>{ct.qualified_date ?? "—"}</td>
                    <td>{ct.last_activity ?? "—"}</td>
                    <td>{ct.continuous_through ?? "—"}</td>
                    <td className="num">{ct.weld_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>X-ray Continuity Events</h4>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Cert</th><th>Process</th><th>Weld #</th><th>Work Order</th><th>Drawing</th><th>Result</th></tr></thead>
              <tbody>
                {c.events.length === 0 && <tr><td colSpan={7} className="table-empty">No x-rays recorded against a cert yet.</td></tr>}
                {c.events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.cert_alias}</td>
                    <td>{e.process ?? "—"}</td>
                    <td>{e.weld_number ?? "—"}</td>
                    <td>{e.work_order ?? "—"}</td>
                    <td>{e.drawing_no ?? "—"}</td>
                    <td>
                      {e.result === "Rejected" ? <span className="badge badge-red">Rejected</span>
                        : e.result === "Accepted" ? <span className="badge badge-green">Accepted</span>
                        : <span className="faint">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
