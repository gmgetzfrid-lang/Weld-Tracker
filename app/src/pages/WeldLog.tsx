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

export function WeldLog() {
  const { can } = useAuth();
  const [welds, setWelds] = useState<Weld[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [joint, setJoint] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Weld | null | undefined>(undefined); // undefined = closed

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
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const exportCsv = () => {
    const header = [
      "Weld #", "Unit", "Work Order", "Drawing", "Joint", "Material",
      "Sched", "Size", "Thk", "Weld In", "Welder", "Date Welded",
      "RT Date", "RT Acc", "RT Rej", "Status",
    ];
    const rows = welds.map((w) => [
      w.weld_number ?? "", w.unit ?? "", w.work_order ?? "", w.drawing_no ?? "",
      w.joint_type ?? "", w.material ?? "", w.schedule ?? "", w.size ?? "",
      w.thickness ?? "", w.weld_inches?.toFixed(2) ?? "", w.stamp_number ?? "",
      w.date_welded ?? "", w.rt_date ?? "", w.rt_accepted ?? "", w.rt_rejected ?? "",
      w.status ?? "",
    ]);
    downloadCsv("weld-log.csv", [header, ...rows]);
  };

  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <input
            placeholder="Search weld #, WO, drawing, welder…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={joint} onChange={(e) => setJoint(e.target.value)} className="btn" style={{ padding: "7px 10px" }}>
          <option value="">All joints</option>
          {(lookups.joint_type ?? []).map((j) => (
            <option key={j} value={j}>{j}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="btn" style={{ padding: "7px 10px" }}>
          <option value="">All statuses</option>
          {(lookups.status ?? []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          {num(total)} welds
        </span>
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
        {can("editor") && (
          <button className="btn btn-primary" onClick={() => setEditing(null)}>
            + New Weld
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
                <th>Weld #</th>
                <th>Unit</th>
                <th>Work Order</th>
                <th>Drawing</th>
                <th>Joint</th>
                <th>Matl</th>
                <th className="num">Size</th>
                <th className="num">Sched</th>
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
                  <td colSpan={13} className="table-empty">
                    No welds yet. {can("editor") && "Click “New Weld” to add one."}
                  </td>
                </tr>
              )}
              {welds.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => setEditing(w)}>
                  <td style={{ fontWeight: 600 }}>{w.weld_number ?? "—"}</td>
                  <td>{w.unit ?? "—"}</td>
                  <td>{w.work_order ?? "—"}</td>
                  <td>{w.drawing_no ?? "—"}</td>
                  <td>{w.joint_type ?? "—"}</td>
                  <td>{w.material ?? "—"}</td>
                  <td className="num">{w.size ?? "—"}</td>
                  <td className="num">{w.schedule ?? "—"}</td>
                  <td>{w.stamp_number ?? "—"}</td>
                  <td>{w.date_welded ?? "—"}</td>
                  <td>{w.rt_date ?? "—"}</td>
                  <td>
                    {w.rt_rejected === "Y" ? (
                      <span className="badge badge-red">Reject</span>
                    ) : w.rt_accepted === "Y" ? (
                      <span className="badge badge-green">Accept</span>
                    ) : w.rt_date ? (
                      <span className="badge badge-blue">Shot</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
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
