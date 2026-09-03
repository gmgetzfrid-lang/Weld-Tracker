import { useCallback, useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Weld, WeldFilter, Welder } from "../types";
import { ErrorBox, downloadCsv, num, useToast, SkeletonRows } from "../components/ui";
import { WeldTable } from "../components/WeldTable";
import { SingleWeldDialog } from "../components/WeldDialogs";
import { Icon } from "../components/Icon";

/** The Weld Log is the searchable ledger of every weld. New entries and a work
 * order's records live in the Work Orders hub — this page routes there. */
export function WeldLog({
  onNewEntry,
  onOpenWorkOrder,
}: {
  onNewEntry: () => void;
  onOpenWorkOrder: (wo: string) => void;
}) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [welds, setWelds] = useState<Weld[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [joint, setJoint] = useState("");
  const [status, setStatus] = useState("");
  const [showVoided, setShowVoided] = useState(false);

  const [welders, setWelders] = useState<Welder[]>([]);
  const [lookups, setLookups] = useState<Lookups>({});
  const [sizes, setSizes] = useState<number[]>([]);

  useEffect(() => {
    api.listWelders(true, "name").then(setWelders).catch(logErr("loading welders"));
    api.lookupsGrouped().then(setLookups).catch(logErr("loading lookups"));
    api.pipeSizes().then(setSizes).catch(logErr("loading pipe sizes"));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const filter: WeldFilter = {
      search: search || undefined,
      joint_type: joint || undefined,
      status: status || undefined,
      include_voided: showVoided,
      limit: 2000,
    };
    Promise.all([api.listWelds(filter), api.countWelds(filter)])
      .then(([rows, count]) => { setWelds(rows); setTotal(count); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [search, joint, status, showVoided]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const [singleOpen, setSingleOpen] = useState(false);

  const exportCsv = () => {
    const header = ["Weld #", "Work Order", "Drawing", "NDE %", "Joint Type", "Size", "Sched", "Material", "Thk", "Weld Inches", "Welder", "Date Welded", "NDE Methods", "NDE Result", "NDE Date", "PWHT", "Brinell", "Pressure", "Status"];
    const rows = welds.map((w) => [
      w.weld_number ?? "", w.work_order ?? "", w.drawing_no ?? "", w.nde_percent ?? "", w.joint_type ?? "",
      w.size ?? "", w.schedule ?? "", w.material ?? "", w.thickness ?? "", w.weld_inches ?? w.size ?? "",
      w.stamp_number ?? "", w.date_welded ?? "", w.nde_types ?? "", w.nde_result ?? "", w.nde_date ?? "",
      w.pwht_temp ?? "", w.brinnel_complete === "Y" ? `Yes ${w.brinnel_value ?? ""}` : "No",
      w.hydro_pressure ? `${w.hydro_pressure} ${w.hydro_time_held ?? ""}` : "", w.status ?? "",
    ]);
    const filters = [
      search && `search "${search}"`,
      joint && `joint ${joint}`,
      status && `status ${status}`,
      showVoided ? "incl. voided" : null,
    ].filter(Boolean).join(", ") || "none";
    downloadCsv("weld-log.csv", [header, ...rows], { user: user?.display_name || user?.username, filters });
  };

  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <input placeholder="Search a work order, weld #, drawing or welder…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={joint} onChange={(e) => setJoint(e.target.value)} className="btn" style={{ padding: "7px 10px" }}>
          <option value="">All joints</option>
          {(lookups.joint_type ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="btn" style={{ padding: "7px 10px" }}>
          <option value="">All statuses</option>
          {(lookups.status ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="btn" style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          title="Show voided (soft-deleted) welds — retained on the record but excluded from counts">
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show voided
        </label>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{num(total)} welds</span>
        <button className="btn" onClick={exportCsv}><Icon name="download" size={14} /> Export CSV</button>
        {can("editor") && <button className="btn" onClick={() => setSingleOpen(true)}>Single weld</button>}
        {can("editor") && <button className="btn btn-accent" onClick={onNewEntry}><Icon name="plus" size={14} stroke={2.25} /> Add Welds</button>}
      </div>

      <ErrorBox message={error} />

      {loading ? (
        <SkeletonRows />
      ) : (
        <WeldTable
          welds={welds}
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          editable={can("editor")}
          onChanged={load}
          showWorkOrder
          onOpenWorkOrder={onOpenWorkOrder}
        />
      )}
      {singleOpen && (
        <SingleWeldDialog
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          onClose={() => setSingleOpen(false)}
          onCreated={() => { setSingleOpen(false); load(); }}
        />
      )}
    </div>
  );
}
