import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Welder, WorkOrderSummary } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { DrawingWizard } from "./DrawingWizard";
import { WorkOrderRecord } from "./WorkOrderRecord";
import type { WoIntent } from "../App";

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
    if (initial.kind === "wizard") setView({ kind: "wizard", drawingId: null });
    else if (initial.kind === "record") setView({ kind: "record", wo: initial.wo });
    onConsumedInitial?.();
  }, [initial, onConsumedInitial]);

  const load = () => api.listWorkOrders().then(setRows).catch((e) => setError(errMsg(e)));

  const delWorkOrder = async (r: WorkOrderSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete work order ${r.work_order} and ALL of it — ${r.drawing_count} drawing(s) and ${r.weld_count} weld(s)? This cannot be undone.`)) return;
    try {
      const [welds, draws] = await api.deleteWorkOrder(r.work_order);
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
            + New Weld Entry
          </button>
        )}
      </div>

      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🗂️</div>
          <h3 style={{ marginBottom: 6 }}>No work orders yet</h3>
          <p className="muted" style={{ maxWidth: 480, margin: "0 auto 16px" }}>
            A work order holds its isometrics and every weld on them. Start a new
            weld entry — you'll enter the work order number, attach the iso, and
            drop weld bubbles to build the log.
          </p>
          {can("editor") && (
            <button className="btn btn-accent" onClick={() => setView({ kind: "wizard", drawingId: null })}>
              + New Weld Entry
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
                  <td className="faint">{r.last_activity ?? "—"}</td>
                  <td><span className="btn btn-sm">Open records ›</span></td>
                  {can("editor") && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {canDeleteWo(r) && (
                        <button className="btn btn-sm btn-danger" title="Delete this work order and everything in it (owner/admin)" onClick={(e) => delWorkOrder(r, e)}>🗑</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
