import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Weld, WeldFilter, Welder } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, useToast } from "../components/ui";
import { WeldTable } from "../components/WeldTable";
import { DrawingWizard } from "./DrawingWizard";
import { WorkOrderRecord } from "./WorkOrderRecord";
import { NewEntryChooser } from "../components/NewEntryChooser";

type View =
  | { kind: "log" }
  | { kind: "record"; wo: string }
  | { kind: "wizard"; drawingId: number | null; wo?: string };

function blankWeld(): Weld {
  return {
    id: 0, status: "Required",
    spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
    count_omission: false,
  };
}

export function WeldLog() {
  const { can } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: "log" });
  const [welds, setWelds] = useState<Weld[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [joint, setJoint] = useState("");
  const [status, setStatus] = useState("");
  const [chooser, setChooser] = useState(false);

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
      limit: 2000,
    };
    Promise.all([api.listWelds(filter), api.countWelds(filter)])
      .then(([rows, count]) => { setWelds(rows); setTotal(count); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [search, joint, status]);

  useEffect(() => {
    if (view.kind !== "log") return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load, view.kind]);

  if (view.kind === "wizard") {
    return (
      <DrawingWizard
        drawingId={view.drawingId}
        initialWorkOrder={view.wo}
        welders={welders}
        lookups={lookups}
        onClose={() => setView(view.wo ? { kind: "record", wo: view.wo } : { kind: "log" })}
      />
    );
  }
  if (view.kind === "record") {
    return (
      <WorkOrderRecord
        workOrder={view.wo}
        welders={welders}
        lookups={lookups}
        sizes={sizes}
        onOpenDrawing={(drawingId) => setView({ kind: "wizard", drawingId, wo: view.wo })}
        onBack={() => setView({ kind: "log" })}
      />
    );
  }

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
      {chooser && (
        <NewEntryChooser
          onClose={() => setChooser(false)}
          onExisting={(wo) => { setChooser(false); setView({ kind: "record", wo }); }}
          onNew={() => { setChooser(false); setView({ kind: "wizard", drawingId: null }); }}
        />
      )}

      {can("editor") && (
        <div className="hub-actions">
          <div>
            <div className="hub-actions-title">Log welds from an isometric</div>
            <div className="hub-actions-sub">
              Enter the work order, drop weld bubbles on the drawing, and the rows
              fill themselves — the fast way.
            </div>
          </div>
          <button className="btn btn-accent" onClick={() => setChooser(true)}>＋ New Weld Entry</button>
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
          onOpenWorkOrder={(wo) => setView({ kind: "record", wo })}
        />
      )}
    </div>
  );
}
