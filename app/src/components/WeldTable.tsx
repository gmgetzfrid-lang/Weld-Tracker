import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg, logErr } from "../api";
import type { Lookups, Weld, Welder } from "../types";
import { useAuth } from "../auth";
import { ConfirmDialog, StatusBadge, useToast } from "./ui";
import { InlineMulti, InlineSelect, InlineText, Segmented } from "./inline";
import { Icon } from "./Icon";
import { useNdeRules } from "../ndeRules";

/** Hideable grid columns, in display order. */
const COLS_DEF: { key: string; label: string }[] = [
  { key: "drawing", label: "Drawing" },
  { key: "nde_percent", label: "NDE %" },
  { key: "joint", label: "Joint Type" },
  { key: "size", label: "Size" },
  { key: "schedule", label: "Schedule" },
  { key: "material", label: "Material" },
  { key: "thk", label: "Thk" },
  { key: "weld_inches", label: "Weld Inches" },
  { key: "welder", label: "Welder" },
  { key: "date", label: "Date Welded" },
  { key: "method", label: "Method" },
  { key: "result", label: "NDE Result" },
  { key: "pwht", label: "PWHT" },
  { key: "brinell", label: "Brinell" },
  { key: "pressure", label: "Pressure Test" },
  { key: "status", label: "Status" },
];
/** Hidden out of the box: derived / secondary columns (still one click away). */
// A calm default: the columns that answer "what was welded, by whom, and was
// it examined". Everything else is one click away under Columns.
const DEFAULT_HIDDEN = ["schedule", "thk", "weld_inches", "brinell", "material", "pwht", "pressure"];

/**
 * The one weld grid used everywhere. An "Edit" toggle puts the whole table into
 * inline-edit mode (no modal). A chevron expands each weld's less-common fields
 * inline. Columns and dropdowns match the workbook.
 */
export function WeldTable({
  welds,
  welders,
  lookups,
  sizes,
  editable,
  onChanged,
  onAddWeld,
  showWorkOrder,
  onOpenWorkOrder,
  initialEdit,
}: {
  welds: Weld[];
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  editable: boolean;
  onChanged?: () => void;
  onAddWeld?: () => void;
  showWorkOrder?: boolean;
  onOpenWorkOrder?: (wo: string) => void;
  initialEdit?: boolean;
}) {
  const { tableLabel } = useNdeRules();
  const toast = useToast();
  const { user } = useAuth();
  // Non-admins may delete only the welds they created themselves.
  const canDelete = (w: Weld) =>
    user != null && (user.role === "admin" || w.created_by === user.username);
  const [rows, setRows] = useState<Weld[]>(welds);
  const [edit, setEdit] = useState(!!initialEdit && editable);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<Set<number>>(new Set());
  // Optimistic-concurrency bookkeeping. `latestVer` holds the newest row_version
  // the server has confirmed for each weld, so a burst of quick single-field
  // edits doesn't conflict with itself; `chain` serializes saves per weld so
  // they apply in order, each seeing the previous one's committed version.
  const latestVer = useRef<Map<number, number>>(new Map());
  const chain = useRef<Map<number, Promise<void>>>(new Map());
  useEffect(() => {
    setRows(welds);
    // Reconcile the confirmed-version cache with the incoming rows: an
    // out-of-band update (Record NDE, void/restore, another view's save)
    // bumps row_version on the server, and saving against the older cached
    // value would manufacture a false "someone else changed this" conflict.
    for (const w of welds) {
      const cached = latestVer.current.get(w.id);
      const incoming = w.row_version ?? 0;
      if (cached != null && incoming > cached) latestVer.current.set(w.id, incoming);
    }
  }, [welds]);

  // Column visibility: the grid shows a working set by default; secondary
  // derived/heat-treat columns hide behind the Columns menu (persisted).
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("wt-hidden-cols");
      return new Set<string>(raw ? JSON.parse(raw) : DEFAULT_HIDDEN);
    } catch { return new Set<string>(DEFAULT_HIDDEN); }
  });
  const [colsOpen, setColsOpen] = useState(false);
  const showCol = (k: string) => !hidden.has(k);
  const toggleCol = (k: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      try { localStorage.setItem("wt-hidden-cols", JSON.stringify([...n])); } catch { /* convenience only */ }
      return n;
    });

  // Visible autosave state: a QC user must never wonder whether an edit stuck.
  const [pendingSaves, setPendingSaves] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  // Sticky failure flag: "All changes saved" must never show after a save
  // failed — it clears only when a later save succeeds.
  const [saveFailed, setSaveFailed] = useState(false);

  // Void / purge run through a proper confirm dialog, not browser prompt().
  const [confirmAct, setConfirmAct] = useState<{ kind: "void" | "purge"; w: Weld } | null>(null);

  const stamps = welders.map((w) => w.stamp);
  const opt = (k: string) => lookups[k] ?? [];
  const sizeStr = sizes.map(String);

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const c = (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true });
      return sortDir === "asc" ? c : -c;
    });
    return r;
  }, [rows, sortDir]);

  const save = (w: Weld, changes: Partial<Weld>) => {
    setRows((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...changes } : x)));
    setPendingSaves((n) => n + 1);
    const prior = chain.current.get(w.id) ?? Promise.resolve();
    const next = prior.then(async () => {
      const version = latestVer.current.get(w.id) ?? w.row_version ?? 0;
      const updated = { ...w, ...changes, row_version: version };
      try {
        const fresh = await api.updateWeld(updated);
        latestVer.current.set(w.id, fresh.row_version ?? version + 1);
        setRows((prev) => prev.map((x) => (x.id === w.id ? fresh : x)));
        setSaveFailed(false);
        onChanged?.();
      } catch (e) {
        setSaveFailed(true);
        const msg = errMsg(e);
        if (/changed by someone else|conflict/i.test(msg)) {
          // Someone else saved first — reload the row and keep the newest
          // version so the user can re-apply their change on top.
          try {
            const fresh = await api.getWeld(w.id);
            latestVer.current.set(w.id, fresh.row_version ?? 0);
            setRows((prev) => prev.map((x) => (x.id === w.id ? fresh : x)));
          } catch { /* ignore reload failure */ }
          toast.push("err", "Someone else changed this weld — reloaded it. Re-apply your edit.");
        } else {
          // The save failed — the optimistic cell would silently lie. Reload
          // the row to the server's truth and surface the error.
          try {
            const fresh = await api.getWeld(w.id);
            latestVer.current.set(w.id, fresh.row_version ?? 0);
            setRows((prev) => prev.map((x) => (x.id === w.id ? fresh : x)));
          } catch { /* reload best-effort */ }
          toast.push("err", msg);
        }
      } finally {
        setPendingSaves((n) => n - 1);
        setSavedOnce(true);
      }
    });
    chain.current.set(w.id, next);
  };

  // Void = the normal, record-preserving delete: the weld is kept for the QC
  // record but excluded from every count. A reason is required (dialog).
  const voidWeld = (w: Weld) => setConfirmAct({ kind: "void", w });
  // Purge = admin-only permanent delete. Destroys the record (dialog).
  const purge = (w: Weld) => setConfirmAct({ kind: "purge", w });
  const runConfirm = async (reason?: string) => {
    if (!confirmAct) return;
    const { kind, w } = confirmAct;
    setConfirmAct(null);
    try {
      if (kind === "void") await api.voidWeld(w.id, (reason ?? "").trim());
      else await api.deleteWeld(w.id);
      onChanged?.();
    } catch (e) { toast.push("err", errMsg(e)); }
  };
  const restore = async (w: Weld) => {
    try { await api.restoreWeld(w.id); onChanged?.(); } catch (e) { toast.push("err", errMsg(e)); }
  };
  const repair = async (w: Weld) => {
    try {
      const ids = await api.createRepair(w.id, true);
      toast.push("ok", `Created ${ids.length} row(s): repair + tracers`);
      onChanged?.();
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const toggleOpen = (id: number) =>
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const txt = (v: unknown) => (v == null || v === "" ? <span className="faint">—</span> : String(v));
  const cols = 2 + (showWorkOrder ? 1 : 0) + COLS_DEF.filter((c) => showCol(c.key)).length;

  return (
    <div className="weldtable">
      <div className="wt-bar">
        <span className="muted" style={{ fontSize: 13 }}>{rows.length} welds</span>
        {editable && (pendingSaves > 0 || savedOnce) && (
          <span className={`wt-savestate ${pendingSaves > 0 ? "busy" : saveFailed ? "failed" : ""}`}>
            {pendingSaves > 0
              ? `Saving ${pendingSaves} change${pendingSaves > 1 ? "s" : ""}…`
              : saveFailed
              ? "Last change didn't save — the row was reloaded"
              : "All changes saved"}
          </span>
        )}
        <div className="spacer" />
        <div className="wt-cols">
          <button className="btn btn-sm" onClick={() => setColsOpen((v) => !v)} title="Choose which columns to show"><Icon name="columns" size={14} /> Columns</button>
          {colsOpen && (
            <div className="wt-cols-menu" onMouseLeave={() => setColsOpen(false)}>
              {COLS_DEF.map((c) => (
                <label key={c.key}>
                  <input type="checkbox" checked={showCol(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        {onAddWeld && editable && <button className="btn btn-sm" onClick={onAddWeld}><Icon name="plus" size={13} stroke={2.25} /> Add Weld</button>}
        {editable && (
          <button className={`btn btn-sm ${edit ? "btn-primary" : ""}`} onClick={() => setEdit((e) => !e)}>
            {edit ? <><Icon name="check" size={14} /> Done editing</> : <><Icon name="pencil" size={13} /> Edit table</>}
          </button>
        )}
      </div>
      {edit && <div className="wt-editing">Edit mode — click any cell to change it (saves automatically). The trash button on a row deletes that weld (your own, or any if you're an admin); the ▸ chevron opens more fields, cert &amp; repair.</div>}

      <div className="table-wrap wt-scroll">
        <table className={`data wt ${edit ? "editing" : ""}`}>
          <thead>
            <tr>
              <th style={{ width: 26 }}></th>
              <th className="sortable" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>Weld # <Icon name={sortDir === "asc" ? "chevronUp" : "chevronDown"} size={12} stroke={2.4} /></th>
              {showWorkOrder && <th>Work Order</th>}
              {showCol("drawing") && <th>Drawing</th>}
              {showCol("nde_percent") && <th title="Assigned NDE coverage — the calculated requirement is in the row detail">NDE %</th>}
              {showCol("joint") && <th>Joint Type</th>}
              {showCol("size") && <th className="num" title="Nominal pipe size">Size</th>}
              {showCol("schedule") && <th>Schedule</th>}
              {showCol("material") && <th>Material</th>}
              {showCol("thk") && <th className="num" title="Wall thickness (in.)">Thk</th>}
              {showCol("weld_inches") && <th className="num" title="Diameter inches">Weld Inches</th>}
              {showCol("welder") && <th>Welder</th>}
              {showCol("date") && <th>Date Welded</th>}
              {showCol("method") && <th title="NDE methods / passes recorded">Method</th>}
              {showCol("result") && <th>NDE Result</th>}
              {showCol("pwht") && <th>PWHT</th>}
              {showCol("brinell") && <th title="Brinell hardness check">Brinell</th>}
              {showCol("pressure") && <th>Pressure Test</th>}
              {showCol("status") && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={cols} className="table-empty">No welds yet.</td></tr>}
            {sorted.map((w) => {
              const rt = w.nde_result === "Rejected" ? "Rejected" : w.nde_result === "Accepted" ? "Accepted" : "";
              const isOpen = open.has(w.id);
              const warn = specWarning(w, tableLabel);
              return (
                <Fragment key={w.id}>
                  <tr className={`${isOpen ? "wt-open" : ""}${w.voided_at ? " wt-voided" : ""}`}>
                    <td>
                      <span className="wt-rowact">
                        <button className="chev" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => toggleOpen(w.id)}><Icon name={isOpen ? "chevronDown" : "chevronRight"} size={14} /></button>
                        {edit && canDelete(w) && !w.voided_at && (
                          <button className="wt-del" title="Void this weld (kept on record)" onClick={() => voidWeld(w)}><Icon name="trash" size={14} /></button>
                        )}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{w.weld_number ?? "—"}</td>
                    {showWorkOrder && (
                      <td onClick={() => w.work_order && onOpenWorkOrder?.(w.work_order)}>
                        {w.work_order ? <a className="wo-link">{w.work_order}</a> : "—"}
                      </td>
                    )}
                    {showCol("drawing") && <td>{txt(w.drawing_no)}</td>}
                    {showCol("nde_percent") && (
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {edit ? <InlineSelect value={w.nde_percent} options={opt("nde_percent")} allowCustom onCommit={(v) => save(w, { nde_percent: v })} />
                            : warn ? <span className="spec-bad">{w.nde_percent ?? "—"}</span> : txt(w.nde_percent)}
                          {warn && <span className="spec-warn" title={warn}><Icon name="alert" size={13} /></span>}
                        </span>
                      </td>
                    )}
                    {showCol("joint") && <td>{edit ? <InlineSelect value={w.joint_type} options={opt("joint_type")} onCommit={(v) => save(w, { joint_type: v })} /> : txt(w.joint_type)}</td>}
                    {showCol("size") && <td className="num">{edit ? <InlineSelect value={w.size?.toString()} options={sizeStr} allowCustom onCommit={(v) => save(w, { size: v == null ? null : Number(v) })} /> : txt(w.size)}</td>}
                    {showCol("schedule") && <td>{edit ? <InlineSelect value={w.schedule} options={opt("schedule")} onCommit={(v) => save(w, { schedule: v })} /> : txt(w.schedule)}</td>}
                    {showCol("material") && <td>{edit ? <InlineSelect value={w.material} options={opt("material")} allowCustom onCommit={(v) => save(w, { material: v })} /> : txt(w.material)}</td>}
                    {showCol("thk") && <td className="num" title="auto from pipe table">{txt(w.thickness)}</td>}
                    {showCol("weld_inches") && <td className="num" title="diameter inches = NPS">{txt(w.weld_inches ?? w.size)}</td>}
                    {showCol("welder") && <td>{edit ? <InlineSelect value={w.stamp_number} options={stamps} onCommit={(v) => save(w, { stamp_number: v })} /> : txt(w.stamp_number)}</td>}
                    {showCol("date") && <td>{edit ? <InlineText value={w.date_welded} date onCommit={(v) => save(w, { date_welded: v })} /> : txt(w.date_welded)}</td>}
                    {showCol("method") && <td>{edit ? <InlineMulti value={w.nde_types} options={opt("nde_type")} onCommit={(v) => save(w, { nde_types: v })} /> : <InlineMulti readOnly value={w.nde_types} options={[]} onCommit={() => {}} />}</td>}
                    {showCol("result") && (
                      <td>
                        {edit ? (
                          <div className="stack">
                            <Segmented value={rt} options={[{ value: "", label: "—" }, { value: "Accepted", label: "Accept", cls: "ok" }, { value: "Rejected", label: "Reject", cls: "bad" }]} onChange={(v) => save(w, { nde_result: v || null })} />
                            <InlineText value={w.nde_date} date onCommit={(v) => save(w, { nde_date: v })} />
                          </div>
                        ) : rt ? <span className={`badge ${rt === "Rejected" ? "badge-red" : "badge-green"}`}>{rt}{w.nde_date ? ` · ${w.nde_date}` : ""}</span> : <span className="faint">—</span>}
                      </td>
                    )}
                    {showCol("pwht") && <td>{edit ? <InlineText value={w.pwht_temp} placeholder="N/A" onCommit={(v) => save(w, { pwht_temp: v })} /> : (w.pwht_temp ? String(w.pwht_temp) : <span className="faint">N/A</span>)}</td>}
                    {showCol("brinell") && (
                      <td>
                        {edit ? (
                          <div className="stack">
                            <Segmented value={w.brinnel_complete === "Y" ? "Y" : ""} options={[{ value: "", label: "No" }, { value: "Y", label: "Yes", cls: "ok" }]} onChange={(v) => save(w, { brinnel_complete: v || null })} />
                            {w.brinnel_complete === "Y" && <InlineText value={w.brinnel_value} placeholder="value" onCommit={(v) => save(w, { brinnel_value: v })} />}
                          </div>
                        ) : w.brinnel_complete === "Y" ? `Yes${w.brinnel_value ? ` (${w.brinnel_value})` : ""}` : <span className="faint">No</span>}
                      </td>
                    )}
                    {showCol("pressure") && (
                      <td>
                        {edit ? (
                          <div className="stack">
                            <InlineText value={w.hydro_pressure} placeholder="pressure" onCommit={(v) => save(w, { hydro_pressure: v })} />
                            <InlineText value={w.hydro_time_held} placeholder="time held" onCommit={(v) => save(w, { hydro_time_held: v })} />
                          </div>
                        ) : w.hydro_pressure ? `${w.hydro_pressure}${w.hydro_time_held ? ` · ${w.hydro_time_held}` : ""}` : <span className="faint">N/A</span>}
                      </td>
                    )}
                    {showCol("status") && <td>{edit ? <InlineSelect value={w.status} options={opt("status")} onCommit={(v) => save(w, { status: v ?? "" })} render={(s) => <StatusBadge status={s} />} /> : <StatusBadge status={w.status} />}</td>}
                  </tr>
                  {isOpen && (
                    <tr className="wt-detail">
                      <td colSpan={cols}>
                        <DetailPanel w={w} edit={edit} editable={editable} lookups={lookups} save={save}
                          canDelete={canDelete(w)} isAdmin={user?.role === "admin"}
                          onRepair={() => repair(w)} onVoid={() => voidWeld(w)}
                          onPurge={() => purge(w)} onRestore={() => restore(w)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmAct && (confirmAct.kind === "void" ? (
        <ConfirmDialog
          title={`Void weld ${confirmAct.w.weld_number ?? confirmAct.w.id}`}
          body="The weld stays on the record and in history — it is excluded from every count and can be restored later."
          confirmLabel="Void weld"
          danger
          requireReason
          reasonLabel="Reason for voiding"
          onConfirm={(reason) => runConfirm(reason)}
          onClose={() => setConfirmAct(null)}
        />
      ) : (
        <ConfirmDialog
          title={`Permanently delete weld ${confirmAct.w.weld_number ?? confirmAct.w.id}`}
          body="This destroys the record and its history and cannot be undone. Prefer Void, which keeps the record."
          confirmLabel="Delete permanently"
          danger
          onConfirm={() => runConfirm()}
          onClose={() => setConfirmAct(null)}
        />
      ))}
    </div>
  );
}

/**
 * When a weld's logged NDE % falls *below* the active rule set's requirement for
 * its service / material / class / joint, returns an explanatory message;
 * otherwise null. Over-inspection (a higher %) is allowed and never warns. The
 * backend supplies `expected_nde_percent`, `_method` and `_note` from the
 * single-source-of-truth engine.
 */
function specWarning(w: Weld, label: string): string | null {
  // Don't assert a requirement before the drivers that determine it are known —
  // Shop/Field distinguishes 5% from 10%, so a blank one can't be judged.
  if (!w.shop_or_field || !w.joint_type) return null;
  const exp = w.expected_nde_percent;
  if (!exp) return null;
  const reqPct = Number((exp.match(/\d+/) ?? ["0"])[0]);
  const actualRaw = (w.nde_percent ?? "").trim();
  // API 570 in-lieu-of-hydro records its own two-form NDE, not a percentage.
  if (/api|570/i.test(actualRaw)) return null;
  const actualPct = actualRaw ? Number((actualRaw.match(/\d+/) ?? ["0"])[0]) : null;
  if (actualPct != null && actualPct >= reqPct) return null;
  const method = w.expected_nde_method ? ` (${w.expected_nde_method})` : "";
  const note = w.expected_nde_note ? ` — ${w.expected_nde_note}` : "";
  return actualRaw
    ? `${label} requires ${exp}${method}${note}. This weld is logged at ${actualRaw}, below spec.`
    : `${label} requires ${exp}${method}${note}. This weld has no NDE % set.`;
}

function DetailPanel({
  w, edit, editable, lookups, save, canDelete, isAdmin, onRepair, onVoid, onPurge, onRestore,
}: {
  w: Weld; edit: boolean; editable: boolean; lookups: Lookups;
  save: (w: Weld, c: Partial<Weld>) => void; canDelete: boolean; isAdmin: boolean;
  onRepair: () => void; onVoid: () => void; onPurge: () => void; onRestore: () => void;
}) {
  // The welder's cert aliases feed the Cert dropdown (which cert this weld used).
  const [certAliases, setCertAliases] = useState<string[]>([]);
  useEffect(() => {
    if (w.stamp_number) api.welderCertAliases(w.stamp_number).then(setCertAliases).catch((e) => { logErr("loading cert aliases")(e); setCertAliases([]); });
    else setCertAliases([]);
  }, [w.stamp_number]);
  const opt = (k: string) => lookups[k] ?? [];
  const F = ({ label, node }: { label: string; node: React.ReactNode }) => (
    <div className="dp-field"><span className="dp-label">{label}</span><span className="dp-val">{node}</span></div>
  );
  const t = (v: unknown) => (v == null || v === "" ? <span className="faint">—</span> : String(v));
  const yn = ["Y"];
  const ndeResolved = w.expected_nde_resolved !== false && !!w.expected_nde_percent;
  return (
    <div className="detail-panel">
      {(w.expected_nde_percent || w.expected_nde_blockers) && (
        <div className={`dp-provenance ${ndeResolved ? "" : "unresolved"}`}>
          <span className="dp-prov-tag">NDE basis</span>
          {ndeResolved ? (
            <span className="dp-prov-body">
              <b>{w.expected_nde_percent}</b>
              {w.expected_nde_method ? ` · ${w.expected_nde_method}` : ""}
              {w.expected_nde_note ? ` — ${w.expected_nde_note}` : ""}
              {w.nde_rule_set ? <span className="dp-prov-rule"> [{w.nde_rule_set}]</span> : null}
            </span>
          ) : (
            <span className="dp-prov-body">
              Requirement unresolved{w.expected_nde_blockers ? ` — set/correct: ${w.expected_nde_blockers}` : ""}
            </span>
          )}
        </div>
      )}
      <div className="dp-grid">
        <F label="Unit" node={edit ? <InlineText value={w.unit} onCommit={(v) => save(w, { unit: v })} /> : t(w.unit)} />
        <F label="Line Spec" node={edit ? <InlineText value={w.line_spec} onCommit={(v) => save(w, { line_spec: v })} /> : t(w.line_spec)} />
        <F label="Shop / Field" node={edit ? <InlineSelect value={w.shop_or_field} options={opt("shop_field")} onCommit={(v) => save(w, { shop_or_field: v })} /> : t(w.shop_or_field)} />
        <F label="Old → New" node={edit ? <InlineSelect value={w.old_to_new} options={opt("old_to_new")} onCommit={(v) => save(w, { old_to_new: v })} /> : t(w.old_to_new)} />
        <F label="Groove Type" node={edit ? <InlineSelect value={w.groove_type} options={opt("groove_type")} onCommit={(v) => save(w, { groove_type: v })} /> : t(w.groove_type)} />
        <F label="Process" node={edit ? <InlineSelect value={w.process} options={opt("process")} onCommit={(v) => save(w, { process: v })} /> : t(w.process)} />
        <F label="Cert (WPQ)" node={edit ? <InlineSelect value={w.cert_alias} options={certAliases} placeholder={certAliases.length ? "pick a cert…" : "no certs on this welder"} onCommit={(v) => save(w, { cert_alias: v })} /> : t(w.cert_alias)} />
        <F label="WPS Number" node={edit ? <InlineText value={w.wps_number} onCommit={(v) => save(w, { wps_number: v })} /> : t(w.wps_number)} />
        <F label="UT Thickness" node={edit ? <InlineText value={w.ut_thickness} onCommit={(v) => save(w, { ut_thickness: v })} /> : t(w.ut_thickness)} />
        <F label="PT/MT Prep" node={edit ? <InlineSelect value={w.pt_mt_prep} options={yn} onCommit={(v) => save(w, { pt_mt_prep: v })} /> : t(w.pt_mt_prep)} />
        <F label="PT/MT Root" node={edit ? <InlineSelect value={w.pt_mt_root} options={yn} onCommit={(v) => save(w, { pt_mt_root: v })} /> : t(w.pt_mt_root)} />
        <F label="Visual Insp." node={edit ? <InlineSelect value={w.visual_insp} options={yn} onCommit={(v) => save(w, { visual_insp: v })} /> : t(w.visual_insp)} />
        <F label="H2 Bake Out" node={edit ? <InlineSelect value={w.h2_bake_out} options={yn} onCommit={(v) => save(w, { h2_bake_out: v })} /> : t(w.h2_bake_out)} />
        <F label="Ferrite" node={edit ? <InlineText value={w.ferrite} onCommit={(v) => save(w, { ferrite: v })} /> : t(w.ferrite)} />
        <F label="PWHT Date" node={edit ? <InlineText value={w.pwht_date} date onCommit={(v) => save(w, { pwht_date: v })} /> : t(w.pwht_date)} />
        <F label="PMI Date" node={edit ? <InlineText value={w.pmi_date} date onCommit={(v) => save(w, { pmi_date: v })} /> : t(w.pmi_date)} />
        <F label="Hydro Comp. Date" node={edit ? <InlineText value={w.hydro_comp_date} date onCommit={(v) => save(w, { hydro_comp_date: v })} /> : t(w.hydro_comp_date)} />
        <F label="Inches of Defect" node={edit ? <InlineText value={w.inches_of_defect} numeric onCommit={(v) => save(w, { inches_of_defect: v == null ? null : Number(v) })} /> : t(w.inches_of_defect)} />
        <F label="Count Omission" node={edit ? <Segmented value={w.count_omission ? "1" : ""} options={[{ value: "", label: "Counted" }, { value: "1", label: "Omitted", cls: "bad" }]} onChange={(v) => save(w, { count_omission: v === "1" })} /> : (w.count_omission ? "Omitted" : "Counted")} />
        <F label="Description" node={edit ? <InlineText value={w.description} onCommit={(v) => save(w, { description: v })} /> : t(w.description)} />
        <F label="File / Comments" node={edit ? <InlineText value={w.file_location} onCommit={(v) => save(w, { file_location: v })} /> : t(w.file_location)} />
      </div>
      {editable && (
        <div className="dp-actions">
          {(w.nde_result === "Rejected" || w.rt_rejected === "Y") && (
            <button className="btn btn-sm" onClick={onRepair}><Icon name="plus" size={13} stroke={2.25} /> Repair &amp; Tracers</button>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          {w.voided_at ? (
            <>
              <span className="voided-tag" title={w.void_reason ? `Voided: ${w.void_reason}` : "Voided"}>
                Voided{w.voided_by ? ` by ${w.voided_by}` : ""}
              </span>
              {canDelete && <button className="btn btn-sm" onClick={onRestore}>Restore</button>}
              {isAdmin && <button className="btn btn-sm btn-danger" onClick={onPurge}>Purge permanently</button>}
            </>
          ) : canDelete ? (
            <>
              <button className="btn btn-sm btn-danger" onClick={onVoid} title="Keep on the record but exclude from counts (reversible)">Void weld</button>
              {isAdmin && <button className="btn btn-sm btn-ghost" onClick={onPurge} title="Permanently delete — destroys the record">Purge</button>}
            </>
          ) : (
            <span className="faint" title="Only the person who created this weld (or an admin) can void it.">
              Void restricted to its creator
            </span>
          )}
        </div>
      )}
    </div>
  );
}
