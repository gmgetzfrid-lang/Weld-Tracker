import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Weld, WeldFilter, Welder } from "../types";
import {
  ErrorBox,
  Spinner,
  StatusBadge,
  downloadCsv,
  num,
} from "../components/ui";
import { WeldEditor } from "./WeldEditor";
import { DrawingWizard } from "./DrawingWizard";
import { WorkOrderRecord } from "./WorkOrderRecord";

type View =
  | { kind: "log" }
  | { kind: "record"; wo: string }
  | { kind: "wizard"; drawingId: number | null; wo?: string };

export function WeldLog() {
  const { can } = useAuth();
  const [view, setView] = useState<View>({ kind: "log" });
  const [welds, setWelds] = useState<Weld[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [joint, setJoint] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Weld | null | undefined>(undefined);

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
      limit: 1000,
    };
    Promise.all([api.listWelds(filter), api.countWelds(filter)])
      .then(([rows, count]) => {
        setWelds(rows);
        setTotal(count);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [search, joint, status]);

  useEffect(() => {
    if (view.kind !== "log") return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load, view.kind]);

  // ---- sub-views: work-order record & guided entry wizard ----
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

  const exportCsv = () => {
    const header = [
      "Weld #", "Work Order", "Iso", "Unit", "Joint", "Material", "Sched",
      "Size", "Thk", "Weld In", "Welder", "Date Welded", "RT Date", "RT Acc",
      "RT Rej", "Status",
    ];
    const rows = welds.map((w) => [
      w.weld_number ?? "", w.work_order ?? "", w.drawing_no ?? "", w.unit ?? "",
      w.joint_type ?? "", w.material ?? "", w.schedule ?? "", w.size ?? "",
      w.thickness ?? "", w.weld_inches?.toFixed(2) ?? "", w.stamp_number ?? "",
      w.date_welded ?? "", w.rt_date ?? "", w.rt_accepted ?? "", w.rt_rejected ?? "",
      w.status ?? "",
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
              Enter the work order, drop weld bubbles on the drawing, and the rows
              fill themselves. This is the fast way.
            </div>
          </div>
          <button
            className="btn btn-accent"
            onClick={() => setView({ kind: "wizard", drawingId: null })}
          >
            + New Weld Entry
          </button>
          <button className="btn" onClick={() => setEditing(null)}>
            Quick single weld
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <input
            placeholder="Search a work order, weld #, drawing or welder…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Weld #</th>
                <th>Work Order</th>
                <th>Iso</th>
                <th>Unit</th>
                <th>Joint</th>
                <th className="num">Size</th>
                <th>Welder</th>
                <th>Date Welded</th>
                <th>RT Date</th>
                <th>RT</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {welds.length === 0 && (
                <tr>
                  <td colSpan={11} className="table-empty">
                    No welds yet.{" "}
                    {can("editor") && "Click “New Weld Entry” above to log from an isometric."}
                  </td>
                </tr>
              )}
              {welds.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => setEditing(w)}>
                  <td style={{ fontWeight: 600 }}>{w.weld_number ?? "—"}</td>
                  <td onClick={(e) => { if (w.work_order) { e.stopPropagation(); setView({ kind: "record", wo: w.work_order }); } }}>
                    {w.work_order ? <a className="wo-link">{w.work_order}</a> : "—"}
                  </td>
                  <td>{w.drawing_no ?? "—"}</td>
                  <td>{w.unit ?? "—"}</td>
                  <td>{w.joint_type ?? "—"}</td>
                  <td className="num">{w.size ?? "—"}</td>
                  <td>{w.stamp_number ?? "—"}</td>
                  <td>{w.date_welded ?? "—"}</td>
                  <td>{w.rt_date ?? "—"}</td>
                  <td>
                    {w.rt_rejected === "Y" ? <span className="badge badge-red">Reject</span>
                      : w.rt_accepted === "Y" ? <span className="badge badge-green">Accept</span>
                      : w.rt_date ? <span className="badge badge-blue">Shot</span>
                      : <span className="faint">—</span>}
                  </td>
                  <td><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <WeldEditor
          weld={editing}
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}
