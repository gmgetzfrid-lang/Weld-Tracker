import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { WeldTable } from "../components/WeldTable";

function blankWeld(workOrder: string): Weld {
  return {
    id: 0, work_order: workOrder, status: "Required",
    spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
    count_omission: false,
  };
}

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
  const { can, user } = useAuth();
  const toast = useToast();
  const editable = can("editor");
  // Non-admins may delete only the drawings they created themselves.
  const canDeleteDrawing = (d: Drawing) =>
    user != null && (user.role === "admin" || d.created_by === user.username);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [welds, setWelds] = useState<Weld[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.listDrawingsForWo(workOrder),
      api.listWelds({ work_order: workOrder, limit: 2000 }),
    ])
      .then(([d, w]) => { setDrawings(d); setWelds(w); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [workOrder]);
  useEffect(load, [load]);

  const addWeld = async () => {
    try {
      await api.createWeld(blankWeld(workOrder));
      toast.push("ok", "Blank weld added — click “Edit table” to fill it in");
      load();
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const delDrawing = async (d: Drawing) => {
    if (!confirm(`Delete drawing ${d.drawing_no ?? d.id}? Its welds are kept.`)) return;
    try { await api.deleteDrawing(d.id); load(); } catch (e) { toast.push("err", errMsg(e)); }
  };

  return (
    <div>
      <div className="wo-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div className="wo-header-title">
          <div className="wo-eyebrow">Work Order</div>
          <h2>{workOrder}</h2>
        </div>
        <span className="badge badge-blue">{num(drawings.length)} drawings</span>
        <span className="badge badge-gray">{num(welds.length)} welds</span>
        <div className="spacer" />
        {editable && (
          <button className="btn btn-accent" onClick={() => onOpenDrawing(null)}>＋ Add Drawing &amp; Welds</button>
        )}
      </div>

      <ErrorBox message={error} />
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="section-head">
            <h3>Isometric Drawings</h3>
            <span className="muted">click a drawing to open its weld map</span>
          </div>
          {drawings.length === 0 ? (
            <div className="empty-hint">
              No isometrics yet.{" "}
              {editable && <a onClick={() => onOpenDrawing(null)} className="link">Add the first one →</a>}
            </div>
          ) : (
            <div className="grid cols-3" style={{ marginBottom: 26 }}>
              {drawings.map((d) => (
                <div key={d.id} className="drawing-card" onClick={() => onOpenDrawing(d.id)}>
                  <div className="drawing-card-top">
                    <span className="drawing-ico">📐</span>
                    <strong>{d.drawing_no || "(untitled)"}</strong>
                    {d.has_pdf ? <span className="badge badge-green">PDF</span> : <span className="badge badge-gray">no PDF</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {d.line_spec ? `${d.line_spec} · ` : ""}{num(d.weld_count)} welds
                  </div>
                  <div className="drawing-card-foot">
                    <span className="link">Open weld map ›</span>
                    {editable && canDeleteDrawing(d) && (
                      <button className="btn btn-sm btn-danger" title="Delete drawing" onClick={(e) => { e.stopPropagation(); delDrawing(d); }}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="section-head">
            <h3>Welds on this work order</h3>
          </div>
          <WeldTable
            welds={welds}
            welders={welders}
            lookups={lookups}
            sizes={sizes}
            editable={editable}
            onChanged={load}
            onAddWeld={addWeld}
          />
        </>
      )}
    </div>
  );
}
