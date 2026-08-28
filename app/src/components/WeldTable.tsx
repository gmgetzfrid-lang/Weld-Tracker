import { Fragment, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { Lookups, Weld, Welder } from "../types";
import { useAuth } from "../auth";
import { StatusBadge, useToast } from "./ui";
import { InlineMulti, InlineSelect, InlineText, Segmented } from "./inline";

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
}) {
  const toast = useToast();
  const { user } = useAuth();
  // Non-admins may delete only the welds they created themselves.
  const canDelete = (w: Weld) =>
    user != null && (user.role === "admin" || w.created_by === user.username);
  const [rows, setRows] = useState<Weld[]>(welds);
  const [edit, setEdit] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => setRows(welds), [welds]);

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

  const save = async (w: Weld, changes: Partial<Weld>) => {
    const updated = { ...w, ...changes };
    setRows((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    try {
      await api.updateWeld(updated);
      const fresh = await api.getWeld(w.id);
      setRows((prev) => prev.map((x) => (x.id === w.id ? fresh : x)));
      onChanged?.();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const del = async (w: Weld) => {
    if (!confirm(`Delete weld ${w.weld_number ?? w.id}?`)) return;
    try { await api.deleteWeld(w.id); onChanged?.(); } catch (e) { toast.push("err", errMsg(e)); }
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
  const cols = showWorkOrder ? 19 : 18;

  return (
    <div className="weldtable">
      <div className="wt-bar">
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} welds</span>
        <div className="spacer" />
        {onAddWeld && editable && <button className="btn btn-sm" onClick={onAddWeld}>＋ Add Weld</button>}
        {editable && (
          <button className={`btn btn-sm ${edit ? "btn-primary" : ""}`} onClick={() => setEdit((e) => !e)}>
            {edit ? "✓ Done editing" : "✎ Edit table"}
          </button>
        )}
      </div>
      {edit && <div className="wt-editing">Edit mode — click any cell to change it. Changes save automatically. Use the ▸ chevron for more fields, repair &amp; delete.</div>}

      <div className="table-wrap wt-scroll">
        <table className="data wt">
          <thead>
            <tr>
              <th style={{ width: 26 }}></th>
              <th className="sortable" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>Weld # {sortDir === "asc" ? "▲" : "▼"}</th>
              {showWorkOrder && <th>Work Order</th>}
              <th>Drawings</th><th>NDE %</th><th>Joint Type</th><th className="num">Size</th>
              <th>Schedule</th><th>Material</th><th className="num">Thk</th><th className="num">Weld In</th>
              <th>Welder</th><th>Date Welded</th><th>NDE</th><th>NDE Result</th>
              <th>PWHT</th><th>Brinnel</th><th>Pressure Test</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={cols} className="table-empty">No welds yet.</td></tr>}
            {sorted.map((w) => {
              const rt = w.nde_result === "Rejected" ? "Rejected" : w.nde_result === "Accepted" ? "Accepted" : "";
              const isOpen = open.has(w.id);
              const warn = specWarning(w);
              return (
                <Fragment key={w.id}>
                  <tr className={isOpen ? "wt-open" : ""}>
                    <td><button className="chev" onClick={() => toggleOpen(w.id)}>{isOpen ? "▾" : "▸"}</button></td>
                    <td style={{ fontWeight: 600 }}>{w.weld_number ?? "—"}</td>
                    {showWorkOrder && (
                      <td onClick={() => w.work_order && onOpenWorkOrder?.(w.work_order)}>
                        {w.work_order ? <a className="wo-link">{w.work_order}</a> : "—"}
                      </td>
                    )}
                    <td>{txt(w.drawing_no)}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {edit ? <InlineSelect value={w.nde_percent} options={opt("nde_percent")} allowCustom onCommit={(v) => save(w, { nde_percent: v })} /> : txt(w.nde_percent)}
                        {warn && <span className="spec-warn" title={warn}>⚠</span>}
                      </span>
                    </td>
                    <td>{edit ? <InlineSelect value={w.joint_type} options={opt("joint_type")} onCommit={(v) => save(w, { joint_type: v })} /> : txt(w.joint_type)}</td>
                    <td className="num">{edit ? <InlineSelect value={w.size?.toString()} options={sizeStr} allowCustom onCommit={(v) => save(w, { size: v == null ? null : Number(v) })} /> : txt(w.size)}</td>
                    <td>{edit ? <InlineSelect value={w.schedule} options={opt("schedule")} onCommit={(v) => save(w, { schedule: v })} /> : txt(w.schedule)}</td>
                    <td>{edit ? <InlineSelect value={w.material} options={opt("material")} allowCustom onCommit={(v) => save(w, { material: v })} /> : txt(w.material)}</td>
                    <td className="num" title="auto from pipe table">{txt(w.thickness)}</td>
                    <td className="num" title="diameter inches = NPS">{txt(w.weld_inches ?? w.size)}</td>
                    <td>{edit ? <InlineSelect value={w.stamp_number} options={stamps} onCommit={(v) => save(w, { stamp_number: v })} /> : txt(w.stamp_number)}</td>
                    <td>{edit ? <InlineText value={w.date_welded} date onCommit={(v) => save(w, { date_welded: v })} /> : txt(w.date_welded)}</td>
                    <td>{edit ? <InlineMulti value={w.nde_types} options={opt("nde_type")} onCommit={(v) => save(w, { nde_types: v })} /> : <InlineMulti readOnly value={w.nde_types} options={[]} onCommit={() => {}} />}</td>
                    <td>
                      {edit ? (
                        <div className="stack">
                          <Segmented value={rt} options={[{ value: "", label: "—" }, { value: "Accepted", label: "Accept", cls: "ok" }, { value: "Rejected", label: "Reject", cls: "bad" }]} onChange={(v) => save(w, { nde_result: v || null })} />
                          <InlineText value={w.nde_date} date onCommit={(v) => save(w, { nde_date: v })} />
                        </div>
                      ) : rt ? <span className={`badge ${rt === "Rejected" ? "badge-red" : "badge-green"}`}>{rt}{w.nde_date ? ` · ${w.nde_date}` : ""}</span> : <span className="faint">—</span>}
                    </td>
                    <td>{edit ? <InlineText value={w.pwht_temp} placeholder="N/A" onCommit={(v) => save(w, { pwht_temp: v })} /> : (w.pwht_temp ? String(w.pwht_temp) : <span className="faint">N/A</span>)}</td>
                    <td>
                      {edit ? (
                        <div className="stack">
                          <Segmented value={w.brinnel_complete === "Y" ? "Y" : ""} options={[{ value: "", label: "No" }, { value: "Y", label: "Yes", cls: "ok" }]} onChange={(v) => save(w, { brinnel_complete: v || null })} />
                          {w.brinnel_complete === "Y" && <InlineText value={w.brinnel_value} placeholder="value" onCommit={(v) => save(w, { brinnel_value: v })} />}
                        </div>
                      ) : w.brinnel_complete === "Y" ? `Yes${w.brinnel_value ? ` (${w.brinnel_value})` : ""}` : <span className="faint">No</span>}
                    </td>
                    <td>
                      {edit ? (
                        <div className="stack">
                          <InlineText value={w.hydro_pressure} placeholder="pressure" onCommit={(v) => save(w, { hydro_pressure: v })} />
                          <InlineText value={w.hydro_time_held} placeholder="time held" onCommit={(v) => save(w, { hydro_time_held: v })} />
                        </div>
                      ) : w.hydro_pressure ? `${w.hydro_pressure}${w.hydro_time_held ? ` · ${w.hydro_time_held}` : ""}` : <span className="faint">N/A</span>}
                    </td>
                    <td>{edit ? <InlineSelect value={w.status} options={opt("status")} onCommit={(v) => save(w, { status: v ?? "" })} render={(s) => <StatusBadge status={s} />} /> : <StatusBadge status={w.status} />}</td>
                  </tr>
                  {isOpen && (
                    <tr className="wt-detail">
                      <td colSpan={cols}>
                        <DetailPanel w={w} edit={edit} editable={editable} lookups={lookups} save={save}
                          canDelete={canDelete(w)} onRepair={() => repair(w)} onDelete={() => del(w)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * When a weld's logged NDE % contradicts the facility rule for its
 * shop/field/tie-in status, returns an explanatory message; otherwise null.
 * The backend supplies `expected_nde_percent` from the rule.
 */
function specWarning(w: Weld): string | null {
  const exp = w.expected_nde_percent;
  if (!exp) return null;
  const actual = w.nde_percent ?? "";
  if (actual.toLowerCase() === exp.toLowerCase()) return null;
  const kind =
    (w.old_to_new ?? "").toUpperCase() === "Y" ? "new-to-old tie-in"
    : (w.shop_or_field ?? "").toUpperCase() === "SHOP" ? "shop weld"
    : "field weld";
  return actual
    ? `Facility rule: a ${kind} is ${exp} NDE — this weld is logged at ${actual}.`
    : `Facility rule: a ${kind} is ${exp} NDE — this weld has no NDE % set.`;
}

function DetailPanel({
  w, edit, editable, lookups, save, canDelete, onRepair, onDelete,
}: {
  w: Weld; edit: boolean; editable: boolean; lookups: Lookups;
  save: (w: Weld, c: Partial<Weld>) => void; canDelete: boolean; onRepair: () => void; onDelete: () => void;
}) {
  // The welder's cert aliases feed the Cert dropdown (which cert this weld used).
  const [certAliases, setCertAliases] = useState<string[]>([]);
  useEffect(() => {
    if (w.stamp_number) api.welderCertAliases(w.stamp_number).then(setCertAliases).catch(() => setCertAliases([]));
    else setCertAliases([]);
  }, [w.stamp_number]);
  const opt = (k: string) => lookups[k] ?? [];
  const F = ({ label, node }: { label: string; node: React.ReactNode }) => (
    <div className="dp-field"><span className="dp-label">{label}</span><span className="dp-val">{node}</span></div>
  );
  const t = (v: unknown) => (v == null || v === "" ? <span className="faint">—</span> : String(v));
  const yn = ["Y"];
  return (
    <div className="detail-panel">
      <div className="dp-grid">
        <F label="Unit" node={edit ? <InlineText value={w.unit} onCommit={(v) => save(w, { unit: v })} /> : t(w.unit)} />
        <F label="Line Spec" node={edit ? <InlineText value={w.line_spec} onCommit={(v) => save(w, { line_spec: v })} /> : t(w.line_spec)} />
        <F label="Shop / Field" node={edit ? <InlineSelect value={w.shop_or_field} options={opt("shop_field")} onCommit={(v) => save(w, { shop_or_field: v })} /> : t(w.shop_or_field)} />
        <F label="Old → New" node={edit ? <InlineSelect value={w.old_to_new} options={opt("old_to_new")} onCommit={(v) => save(w, { old_to_new: v })} /> : t(w.old_to_new)} />
        <F label="Groove Type" node={edit ? <InlineSelect value={w.groove_type} options={opt("groove_type")} onCommit={(v) => save(w, { groove_type: v })} /> : t(w.groove_type)} />
        <F label="Process" node={edit ? <InlineSelect value={w.process} options={opt("process")} onCommit={(v) => save(w, { process: v })} /> : t(w.process)} />
        <F label="Cert (WPQ)" node={edit ? <InlineSelect value={w.cert_alias} options={certAliases} allowCustom onCommit={(v) => save(w, { cert_alias: v })} /> : t(w.cert_alias)} />
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
            <button className="btn btn-sm" onClick={onRepair}>＋ Repair &amp; Tracers</button>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          {canDelete ? (
            <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete weld</button>
          ) : (
            <span className="faint" title="Only the person who created this weld (or an admin) can delete it.">
              Delete restricted to its creator
            </span>
          )}
        </div>
      )}
    </div>
  );
}
