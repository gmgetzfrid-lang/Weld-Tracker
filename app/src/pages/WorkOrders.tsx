import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Welder, WorkOrderSummary } from "../types";
import { ErrorBox, Spinner, num } from "../components/ui";
import { DrawingWizard } from "./DrawingWizard";
import { WorkOrderRecord } from "./WorkOrderRecord";
import { NewEntryChooser } from "../components/NewEntryChooser";

type View =
  | { kind: "list" }
  | { kind: "record"; wo: string }
  | { kind: "wizard"; drawingId: number | null; wo?: string };

export function WorkOrders() {
  const { can } = useAuth();
  const [view, setView] = useState<View>({ kind: "list" });
  const [rows, setRows] = useState<WorkOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [welders, setWelders] = useState<Welder[]>([]);
  const [lookups, setLookups] = useState<Lookups>({});
  const [sizes, setSizes] = useState<number[]>([]);
  const [chooser, setChooser] = useState(false);

  const load = () => api.listWorkOrders().then(setRows).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    api.listWelders(true, "name").then(setWelders).catch(() => {});
    api.lookupsGrouped().then(setLookups).catch(() => {});
    api.pipeSizes().then(setSizes).catch(() => {});
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
          <button className="btn btn-accent" onClick={() => setChooser(true)}>
            + New Weld Entry
          </button>
        )}
      </div>
      {chooser && (
        <NewEntryChooser
          onClose={() => setChooser(false)}
          onExisting={(wo) => { setChooser(false); setView({ kind: "record", wo }); }}
          onNew={() => { setChooser(false); setView({ kind: "wizard", drawingId: null }); }}
        />
      )}

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
                <th>Last Activity</th><th></th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
