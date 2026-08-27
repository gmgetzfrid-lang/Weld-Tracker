import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, StatusBadge, num, useToast } from "../components/ui";
import { WeldEditor } from "./WeldEditor";

export function WorkOrderRecord({
  workOrder,
  welders,
  lookups,
  sizes,
  onOpenDrawing,
  onBack,
}: {
  workOrder: string;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onOpenDrawing: (drawingId: number | null) => void;
  onBack: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [welds, setWelds] = useState<Weld[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editWeld, setEditWeld] = useState<Weld | undefined>(undefined);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.listDrawingsForWo(workOrder),
      api.listWelds({ work_order: workOrder, limit: 2000 }),
    ])
      .then(([d, w]) => {
        setDrawings(d);
        setWelds(w);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [workOrder]);
  useEffect(load, [load]);

  const delDrawing = async (d: Drawing) => {
    if (!confirm(`Delete isometric ${d.drawing_no ?? d.id}? Its welds are kept.`)) return;
    try {
      await api.deleteDrawing(d.id);
      load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div className="section-title" style={{ margin: 0 }}>
          <h3>Work Order {workOrder}</h3>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {num(drawings.length)} iso · {num(welds.length)} welds
        </span>
        <div className="spacer" />
        {can("editor") && (
          <button className="btn btn-accent" onClick={() => onOpenDrawing(null)}>
            + Add Isometric &amp; Welds
          </button>
        )}
      </div>

      <ErrorBox message={error} />
      {loading ? (
        <Spinner />
      ) : (
        <>
          <h4 className="muted" style={{ margin: "6px 0 10px" }}>Isometric Drawings</h4>
          {drawings.length === 0 ? (
            <div className="card card-pad" style={{ marginBottom: 22, color: "var(--text-muted)" }}>
              No isometrics on this work order yet.{" "}
              {can("editor") && (
                <a onClick={() => onOpenDrawing(null)} style={{ cursor: "pointer", fontWeight: 600 }}>
                  Add the first one →
                </a>
              )}
            </div>
          ) : (
            <div className="grid cols-3" style={{ marginBottom: 22 }}>
              {drawings.map((d) => (
                <div key={d.id} className="card card-pad clickable" style={{ cursor: "pointer" }} onClick={() => onOpenDrawing(d.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 20 }}>📐</span>
                    <strong style={{ color: "var(--navy)" }}>{d.drawing_no || "(untitled iso)"}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {d.line_spec ? `${d.line_spec} · ` : ""}{num(d.weld_count)} welds
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                    {d.has_pdf ? <span className="badge badge-green">PDF</span> : <span className="badge badge-gray">no PDF</span>}
                    <div className="spacer" style={{ flex: 1 }} />
                    <span className="btn btn-sm">Open ›</span>
                    {can("editor") && (
                      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); delDrawing(d); }}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h4 className="muted" style={{ margin: "6px 0 10px" }}>Welds on this work order</h4>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Weld #</th><th>Iso</th><th>Joint</th><th className="num">Size</th>
                  <th>Welder</th><th>Date</th><th>RT</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {welds.length === 0 && (
                  <tr><td colSpan={8} className="table-empty">No welds recorded on this work order yet.</td></tr>
                )}
                {welds.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => setEditWeld(w)}>
                    <td style={{ fontWeight: 600 }}>{w.weld_number ?? "—"}</td>
                    <td>{w.drawing_no ?? "—"}</td>
                    <td>{w.joint_type ?? "—"}</td>
                    <td className="num">{w.size ?? "—"}</td>
                    <td>{w.stamp_number ?? "—"}</td>
                    <td>{w.date_welded ?? "—"}</td>
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
        </>
      )}

      {editWeld !== undefined && (
        <WeldEditor
          weld={editWeld}
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          onClose={() => setEditWeld(undefined)}
          onSaved={() => { setEditWeld(undefined); load(); }}
        />
      )}
    </div>
  );
}
