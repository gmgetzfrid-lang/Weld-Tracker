import { useCallback, useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { WeldTable } from "../components/WeldTable";
import { docName, RevisePanel, RevisionHistory, PackageIngest } from "../docControl";
import { QualityPackage } from "./QualityPackage";

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
  const [owner, setOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revise, setRevise] = useState<Drawing | null>(null);
  const [history, setHistory] = useState<Drawing | null>(null);
  const [ingest, setIngest] = useState(false);
  // The work order's owner (its creator) or an admin may delete the whole thing.
  const canDeleteWo =
    user != null && (user.role === "admin" || (owner != null && owner === user.username));

  const load = useCallback(() => {
    Promise.all([
      api.listDrawingsForWo(workOrder),
      api.listWelds({ work_order: workOrder, limit: 2000 }),
    ])
      .then(([d, w]) => { setDrawings(d); setWelds(w); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
    api.workOrderOwner(workOrder).then(setOwner).catch((e) => { logErr("loading work-order owner")(e); setOwner(null); });
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

  const delWorkOrder = async () => {
    if (!confirm(`Delete work order ${workOrder} and ALL of it — ${drawings.length} drawing(s) and ${welds.length} weld(s)? This cannot be undone.`)) return;
    try {
      const [w, d] = await api.deleteWorkOrder(workOrder);
      toast.push("ok", `Deleted ${workOrder}: ${w} weld(s), ${d} drawing(s)`);
      onBack();
    } catch (e) { toast.push("err", errMsg(e)); }
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
          <button className="btn" title="Upload one compiled work-package book and split it into controlled sheets by page range" onClick={() => setIngest(true)}>📚 Ingest work package</button>
        )}
        {editable && (
          <button className="btn btn-accent" onClick={() => onOpenDrawing(null)}>＋ Add Drawing &amp; Welds</button>
        )}
        {canDeleteWo && (
          <button className="btn btn-sm btn-danger" title="Delete this entire work order (owner or admin)" onClick={delWorkOrder}>🗑 Delete work order</button>
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
                    <strong>{d.doc_name || docName(d.drawing_no, d.sheet_no, d.revision)}</strong>
                    {d.has_pdf ? <span className="badge badge-green">PDF</span> : <span className="badge badge-gray">no PDF</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge badge-blue" title="effective revision">Rev {d.revision ?? "0"}</span>
                    {(d.rev_count ?? 0) > 1 && <span className="badge badge-gray" title="revision history">{d.rev_count} revs</span>}
                    <span>{d.line_spec ? `${d.line_spec} · ` : ""}{num(d.weld_count)} welds</span>
                  </div>
                  <div className="drawing-card-foot" onClick={(e) => e.stopPropagation()}>
                    <span className="link" onClick={() => onOpenDrawing(d.id)}>Open weld map ›</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {editable && <button className="btn btn-sm" title="Issue a new revision (supersede current)" onClick={() => setRevise(d)}>Revise</button>}
                      {(d.rev_count ?? 0) > 1 && <button className="btn btn-sm btn-ghost" title="Revision history" onClick={() => setHistory(d)}>History</button>}
                      {editable && canDeleteDrawing(d) && (
                        <button className="btn btn-sm btn-danger" title="Delete drawing" onClick={() => delDrawing(d)}>✕</button>
                      )}
                    </div>
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

          <div style={{ marginTop: 26 }}>
            <QualityPackage workOrder={workOrder} />
          </div>
        </>
      )}

      {revise && (
        <RevisePanel
          drawing={revise}
          onClose={() => setRevise(null)}
          onDone={() => { setRevise(null); load(); }}
        />
      )}
      {history && (
        <RevisionHistory drawing={history} onClose={() => setHistory(null)} />
      )}
      {ingest && (
        <PackageIngest
          workOrder={workOrder}
          onClose={() => setIngest(false)}
          onDone={() => { setIngest(false); load(); }}
        />
      )}
    </div>
  );
}
