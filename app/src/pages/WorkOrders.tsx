import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Welder, WorkOrderSummary } from "../types";
import { ConfirmDialog, ErrorBox, num, useToast, SkeletonRows } from "../components/ui";
import { DrawingWizard } from "./DrawingWizard";
import { WorkOrderRecord } from "./WorkOrderRecord";
import type { WoIntent } from "../App";
import { Icon } from "../components/Icon";

type View =
  | { kind: "list" }
  | { kind: "record"; wo: string }
  | { kind: "wizard"; drawingId: number | null; wo?: string };

export function WorkOrders({
  onNewEntry,
  initial,
  onConsumedInitial,
}: {
  onNewEntry: () => void;
  initial?: WoIntent;
  onConsumedInitial?: () => void;
}) {
  const { can, user } = useAuth();
  const toast = useToast();
  // The work order's owner (its creator) or an admin may delete the whole thing.
  const canDeleteWo = (r: WorkOrderSummary) =>
    user != null && (user.role === "admin" || r.owner === user.username);
  const [view, setView] = useState<View>({ kind: "list" });
  const [rows, setRows] = useState<WorkOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [welders, setWelders] = useState<Welder[]>([]);
  const [lookups, setLookups] = useState<Lookups>({});
  const [sizes, setSizes] = useState<number[]>([]);

  // Open the view the app asked for (from the global New Weld Entry chooser, or
  // clicking a work order in the Weld Log), then clear the one-shot intent.
  useEffect(() => {
    if (!initial) return;
    if (initial.kind === "wizard") setView({ kind: "wizard", drawingId: null, wo: initial.wo });
    else if (initial.kind === "record") setView({ kind: "record", wo: initial.wo });
    onConsumedInitial?.();
  }, [initial, onConsumedInitial]);

  const [confirmDel, setConfirmDel] = useState<WorkOrderSummary | null>(null);

  const load = () => api.listWorkOrders().then(setRows).catch((e) => setError(errMsg(e)));

  const delWorkOrder = async (r: WorkOrderSummary, reason: string) => {
    try {
      const [welds, draws] = await api.deleteWorkOrder(r.work_order, reason);
      toast.push("ok", `Deleted ${r.work_order}: ${welds} weld(s), ${draws} drawing(s)`);
      load();
    } catch (err) {
      toast.push("err", errMsg(err));
    }
  };
  useEffect(() => {
    load();
    api.listWelders(true, "name").then(setWelders).catch(logErr("loading welders"));
    api.lookupsGrouped().then(setLookups).catch(logErr("loading lookups"));
    api.pipeSizes().then(setSizes).catch(logErr("loading pipe sizes"));
  }, []);

  if (view.kind === "wizard") {
    return (
      <DrawingWizard
        drawingId={view.drawingId}
        initialWorkOrder={view.wo}
        welders={welders}
        lookups={lookups}
        onClose={() => {
          load();
          setView(view.wo ? { kind: "record", wo: view.wo } : { kind: "list" });
        }}
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
        onBack={() => { load(); setView({ kind: "list" }); }}
      />
    );
  }

  const shown = (rows ?? []).filter(
    (r) => !q || r.work_order.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <input placeholder="Search work order #…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="spacer" />
        {can("editor") && (
          <button className="btn btn-accent" onClick={onNewEntry}>
            + Add Welds
          </button>
        )}
      </div>

      <ErrorBox message={error} />
      {!rows ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-ico"><Icon name="folder" size={26} /></div>
          <h4>No work orders yet</h4>
          <p>
            A work order holds its isometrics and every weld on them. Start a new
            weld entry — you'll enter the work order number, attach the iso, and
            drop weld bubbles to build the log.
          </p>
          {can("editor") && (
            <button className="btn btn-accent" onClick={() => setView({ kind: "wizard", drawingId: null })}>
              + Add Welds
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Work Order #</th><th>Unit</th>
                <th className="num">Isometrics</th><th className="num">Welds</th>
                <th>Needs data</th>
                <th>Last Activity</th><th></th>{can("editor") && <th></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.work_order} className="clickable" onClick={() => setView({ kind: "record", wo: r.work_order })}>
                  <td style={{ fontWeight: 600 }}>{r.work_order}</td>
                  <td>{r.unit ?? "—"}</td>
                  <td className="num">{num(r.drawing_count)}</td>
                  <td className="num">{num(r.weld_count)}</td>
                  <td>
                    {(r.incomplete_count ?? 0) > 0
                      ? <span className="badge badge-amber" title="Welds still missing attributes — open the record and use Fill attributes">{num(r.incomplete_count ?? 0)} incomplete</span>
                      : r.weld_count > 0 ? <span className="badge badge-green">complete</span> : <span className="faint">—</span>}
                  </td>
                  <td className="faint">{r.last_activity ?? "—"}</td>
                  <td><span className="btn btn-sm">Open records ›</span></td>
                  {can("editor") && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {canDeleteWo(r) && (
                        <button className="btn btn-sm btn-ghost-danger" title="Delete this work order and everything in it (owner/admin)" onClick={(e) => { e.stopPropagation(); setConfirmDel(r); }}><Icon name="trash" size={14} /></button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDel && (
        <ConfirmDialog
          title={`Delete work order ${confirmDel.work_order}`}
          body={`This permanently deletes ALL of it — ${confirmDel.drawing_count} drawing(s) and ${confirmDel.weld_count} weld(s) — and cannot be undone. Voiding individual welds keeps records; this does not.`}
          confirmLabel="Delete everything"
          danger
          requireReason
          reasonLabel="Reason for deleting this work order"
          onConfirm={(reason) => { const r = confirmDel; setConfirmDel(null); if (r) delWorkOrder(r, reason ?? ""); }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
