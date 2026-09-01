import { useEffect, useState } from "react";
import { api, logErr } from "../api";
import type { WorkOrderSummary } from "../types";
import { Modal, num } from "./ui";

/** Front door for logging welds: add to an existing work order, or start a new
 * one. This is the first choice — the flow is about the work order, not a file. */
export function NewEntryChooser({
  onExisting,
  onNew,
  onClose,
}: {
  onExisting: (workOrder: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "existing">("choose");
  const [wos, setWos] = useState<WorkOrderSummary[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (mode === "existing") api.listWorkOrders().then(setWos).catch(logErr("loading work orders"));
  }, [mode]);

  const shown = wos.filter((w) => !q || w.work_order.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal title="New weld entry" onClose={onClose}>
      {mode === "choose" ? (
        <div className="chooser-grid">
          <button className="chooser-card" onClick={() => setMode("existing")}>
            <div className="ico">➕🗂️</div>
            <h4>Add welds to an existing work order</h4>
            <p>Pick a work order you've already started and add another isometric or more welds to it.</p>
          </button>
          <button className="chooser-card" onClick={onNew}>
            <div className="ico">🆕</div>
            <h4>Create a new work order</h4>
            <p>Start fresh — enter the work order number, attach the isometric, and drop weld bubbles.</p>
          </button>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setMode("choose")}>← Back</button>
            <div className="search" style={{ flex: 1 }}>
              <input autoFocus placeholder="Search work order #…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {wos.length === 0 ? (
            <p className="muted">No work orders yet. <a style={{ cursor: "pointer", fontWeight: 600 }} onClick={onNew}>Create a new one →</a></p>
          ) : (
            <div className="wo-picklist">
              {shown.map((w) => (
                <div key={w.work_order} className="wo-pick" onClick={() => onExisting(w.work_order)}>
                  <span style={{ fontSize: 20 }}>🗂️</span>
                  <div style={{ flex: 1 }}>
                    <div className="wo-name">{w.work_order}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {w.unit ? `Unit ${w.unit} · ` : ""}{num(w.drawing_count)} iso · {num(w.weld_count)} welds
                    </div>
                  </div>
                  <span className="btn btn-sm">Open ›</span>
                </div>
              ))}
              {shown.length === 0 && <div className="wo-pick muted">No match.</div>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
