import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Drawing, Lookups, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { DrawingWizard } from "./DrawingWizard";

export function Drawings() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Drawing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: number | null } | null>(null);
  const [welders, setWelders] = useState<Welder[]>([]);
  const [lookups, setLookups] = useState<Lookups>({});

  const load = () => api.listDrawings().then(setRows).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    api.listWelders(true, "name").then(setWelders).catch(() => {});
    api.lookupsGrouped().then(setLookups).catch(() => {});
  }, []);

  const del = async (d: Drawing) => {
    if (!confirm(`Delete drawing ${d.drawing_no ?? d.id}? Its ${d.weld_count} weld(s) are kept but detached.`)) return;
    try {
      await api.deleteDrawing(d.id);
      toast.push("ok", "Drawing deleted");
      load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  if (open) {
    return (
      <DrawingWizard
        drawingId={open.id}
        welders={welders}
        lookups={lookups}
        onClose={() => {
          setOpen(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      <div className="toolbar">
        <div className="section-title" style={{ margin: 0 }}><h3>Isometric Drawings</h3></div>
        <div className="spacer" />
        {can("editor") && (
          <button className="btn btn-primary" onClick={() => setOpen({ id: null })}>
            + New Drawing
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📐</div>
          <h3 style={{ marginBottom: 6 }}>No drawings yet</h3>
          <p className="muted" style={{ maxWidth: 460, margin: "0 auto 16px" }}>
            Create a drawing, attach its isometric PDF, and place weld bubbles to
            build the weld log and the field map at the same time.
          </p>
          {can("editor") && (
            <button className="btn btn-accent" onClick={() => setOpen({ id: null })}>
              + New Drawing
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Drawing / Iso #</th>
                <th>Work Order</th>
                <th>Unit</th>
                <th>Line Spec</th>
                <th className="num">Welds</th>
                <th>PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setOpen({ id: d.id })}>
                  <td style={{ fontWeight: 600 }}>{d.drawing_no ?? "—"}</td>
                  <td>{d.work_order ?? "—"}</td>
                  <td>{d.unit ?? "—"}</td>
                  <td>{d.line_spec ?? "—"}</td>
                  <td className="num">{num(d.weld_count)}</td>
                  <td>{d.has_pdf ? <span className="badge badge-green">attached</span> : <span className="faint">—</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {can("editor") && (
                      <button className="btn btn-sm btn-danger" onClick={() => del(d)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
