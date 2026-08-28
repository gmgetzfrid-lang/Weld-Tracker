import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Weld, WeldFilter, Welder } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, useToast } from "../components/ui";
import { WeldTable } from "../components/WeldTable";

function blankWeld(): Weld {
  return {
    id: 0, status: "Required",
    spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
    count_omission: false,
  };
}

/** The Weld Log is the searchable ledger of every weld. New entries and a work
 * order's records live in the Work Orders hub — this page routes there. */
export function WeldLog({
  onNewEntry,
  onOpenWorkOrder,
}: {
  onNewEntry: () => void;
  onOpenWorkOrder: (wo: string) => void;
}) {
  const { can } = useAuth();
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
    api.listWelders(true, "name").then(setWelders).catch(() => {});
    api.lookupsGrouped().then(setLookups).catch(() => {});
    api.pipeSizes().then(setSizes).catch(() => {});
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

  const addQuick = async () => {
    try {
      await api.createWeld(blankWeld());
      toast.push("ok", "Blank weld added — click “Edit table” to fill it in");
      load();
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const exportCsv = () => {
    const header = ["Weld #", "Work Order", "Drawing", "NDE %", "Joint Type", "Size", "Sched", "Material", "Thk", "Weld In", "Welder", "Date Welded", "NDE", "NDE Result", "NDE Date", "PWHT", "Brinnel", "Pressure", "Status"];
    const rows = welds.map((w) => [
      w.weld_number ?? "", w.work_order ?? "", w.drawing_no ?? "", w.nde_percent ?? "", w.joint_type ?? "",
      w.size ?? "", w.schedule ?? "", w.material ?? "", w.thickness ?? "", w.weld_inches ?? w.size ?? "",
      w.stamp_number ?? "", w.date_welded ?? "", w.nde_types ?? "", w.nde_result ?? "", w.nde_date ?? "",
      w.pwht_temp ?? "", w.brinnel_complete === "Y" ? `Yes ${w.brinnel_value ?? ""}` : "No",
      w.hydro_pressure ? `${w.hydro_pressure} ${w.hydro_time_held ?? ""}` : "", w.status ?? "",
    ]);
    downloadCsv("weld-log.csv", [header, ...rows]);
  };

  return (
    <div>
      {can("editor") && (
        <div className="hub-actions">
          <div>
            <div className="hub-actions-title">Log welds from an isometric</div>
            <div className="hub-actions-sub">
              A weld entry is a work order: pick or create the work order, attach the drawing,
              drop weld bubbles and the rows fill themselves. This log is every weld you've entered —
              click a work order to open its records.
            </div>
          </div>
          <button className="btn btn-accent" onClick={onNewEntry}>＋ New Weld Entry</button>
          <button className="btn" onClick={addQuick}>Quick single weld</button>
        </div>
      )}

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
        <span className="muted" style={{ fontSize: 12 }}>{num(total)} welds</span>
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
      </div>

      <ErrorBox message={error} />

      {loading ? (
        <Spinner />
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
    </div>
  );
}
