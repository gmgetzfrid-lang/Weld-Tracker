import { useEffect, useMemo, useState } from "react";
import { api, logErr } from "../api";
import type { WorkOrderSummary } from "../types";
import { Modal } from "./ui";

/**
 * The front door for logging welds — one smart field instead of a two-card
 * branch. Type a work order number: an existing one opens with its records, an
 * unknown one offers "Create WO …" pre-filled. Recent work orders sit right
 * below because most days you're adding to the same handful of jobs.
 */
export function NewEntryChooser({
  onExisting,
  onNew,
  onClose,
}: {
  onExisting: (workOrder: string) => void;
  /** Start the new-work-order wizard, optionally pre-filled with the typed number. */
  onNew: (workOrder?: string) => void;
  onClose: () => void;
}) {
  const [wos, setWos] = useState<WorkOrderSummary[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.listWorkOrders().then(setWos).catch(logErr("loading work orders"));
  }, []);

  const query = q.trim();
  const shown = useMemo(() => {
    const flat = (s: string) => s.replace(/[-_ /]/g, "").toLowerCase();
    const list = query
      ? wos.filter((w) => flat(w.work_order).includes(flat(query)))
      : wos;
    return list.slice(0, 7);
  }, [wos, query]);
  const exact = wos.some(
    (w) => w.work_order.trim().toLowerCase() === query.toLowerCase(),
  );

  return (
    <Modal title="Add welds" onClose={onClose}>
      <div className="field" style={{ marginBottom: 6 }}>
        <label>Work order</label>
        <input
          autoFocus
          placeholder="Type a work order number — existing or new…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !query) return;
            e.preventDefault();
            if (exact) onExisting(query);
            else if (shown.length === 1) onExisting(shown[0].work_order);
            else onNew(query);
          }}
        />
      </div>

      <div className="wo-picker-list">
        {query && !exact && (
          <button className="wo-picker-row wo-picker-create" onClick={() => onNew(query)}>
            ＋ Create work order “{query}” — attach the isometric and drop weld bubbles
          </button>
        )}
        {!query && wos.length > 0 && (
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 2px 0" }}>
            Recent work orders
          </div>
        )}
        {shown.map((w) => (
          <button key={w.work_order} className="wo-picker-row" onClick={() => onExisting(w.work_order)}>
            <b>{w.work_order}</b>
            <span className="muted">
              {w.unit ? `${w.unit} · ` : ""}
              {w.drawing_count} drawing{w.drawing_count === 1 ? "" : "s"} · {w.weld_count} weld{w.weld_count === 1 ? "" : "s"}
              {w.last_activity ? ` · ${w.last_activity}` : ""}
            </span>
            <span className="spacer" />
            <span className="link">Open ›</span>
          </button>
        ))}
        {wos.length === 0 && !query && (
          <button className="wo-picker-row wo-picker-create" onClick={() => onNew()}>
            ＋ Create your first work order
          </button>
        )}
        {query && shown.length === 0 && exact === false && wos.length > 0 && (
          <div className="muted" style={{ padding: "6px 2px", fontSize: 12 }}>
            No existing work order matches “{query}”.
          </div>
        )}
      </div>
    </Modal>
  );
}
