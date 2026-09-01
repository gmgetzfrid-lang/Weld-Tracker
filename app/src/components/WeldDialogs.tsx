import { useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { Lookups, Weld, Welder } from "../types";
import { Modal, useToast } from "./ui";

/**
 * Record one NDE report across many welds — the way results actually arrive:
 * "RT-1042 came back, covering these twelve welds". Shared report number,
 * method(s) and date; per-weld Accepted/Rejected. Everything flows through the
 * audited batch command.
 */
export function RecordNdeDialog({
  welds,
  onClose,
  onDone,
}: {
  welds: Weld[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reportNo, setReportNo] = useState("");
  const [types, setTypes] = useState("RT");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  // weld id -> "Accepted" | "Rejected"; absent = not in this report.
  const [picks, setPicks] = useState<Map<number, string>>(new Map());

  const candidates = useMemo(
    () =>
      welds
        .filter((w) => !w.voided_at)
        .sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true })),
    [welds],
  );

  const toggle = (id: number) =>
    setPicks((prev) => {
      const n = new Map(prev);
      if (n.has(id)) n.delete(id);
      else n.set(id, "Accepted");
      return n;
    });
  const setResult = (id: number, result: string) =>
    setPicks((prev) => {
      const n = new Map(prev);
      n.set(id, result);
      return n;
    });

  const save = async () => {
    const entries = [...picks.entries()].map(([id, result]) => ({ id, result }));
    if (entries.length === 0) { toast.push("err", "Select at least one weld"); return; }
    if (!types.trim()) { toast.push("err", "Enter the NDE method(s)"); return; }
    if (!date.trim()) { toast.push("err", "Enter the examination date"); return; }
    setBusy(true);
    try {
      const n = await api.recordNdeBatch(entries, types.trim(), date, reportNo.trim() || null);
      toast.push("ok", `Recorded ${reportNo.trim() || "NDE results"} on ${n} weld${n === 1 ? "" : "s"}`);
      onDone();
    } catch (e) {
      toast.push("err", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record NDE results"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || picks.size === 0} onClick={save}>
            {busy ? "Recording…" : `Record on ${picks.size} weld${picks.size === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="form-grid cols-3">
        <div className="field"><label>Report #</label>
          <input autoFocus value={reportNo} onChange={(e) => setReportNo(e.target.value)} placeholder="RT-1042" /></div>
        <div className="field"><label>Method(s)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={types} onChange={(e) => setTypes(e.target.value)} placeholder="RT" style={{ flex: 1 }} />
            {["RT", "PT", "MT", "UT"].map((m) => (
              <button key={m} type="button" className="btn btn-sm" onClick={() => setTypes(m)}>{m}</button>
            ))}
          </div>
        </div>
        <div className="field"><label>Examination date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <div className="nde-batch-list">
        {candidates.length === 0 && <p className="muted">No welds available.</p>}
        {candidates.map((w) => {
          const picked = picks.has(w.id);
          const result = picks.get(w.id);
          return (
            <div key={w.id} className={`nde-batch-row ${picked ? "picked" : ""}`}>
              <label className="nde-batch-pick">
                <input type="checkbox" checked={picked} onChange={() => toggle(w.id)} />
                <b>{w.weld_number ?? `#${w.id}`}</b>
                <span className="muted">{w.stamp_number ?? "—"}{w.nde_percent ? ` · ${w.nde_percent}` : ""}</span>
                {w.nde_result && <span className={`badge ${w.nde_result === "Rejected" ? "badge-red" : "badge-green"}`}>{w.nde_result}</span>}
              </label>
              {picked && (
                <span className="nde-batch-result">
                  <button type="button" className={`seg-mini ok ${result === "Accepted" ? "on" : ""}`} onClick={() => setResult(w.id, "Accepted")}>Accept</button>
                  <button type="button" className={`seg-mini bad ${result === "Rejected" ? "on" : ""}`} onClick={() => setResult(w.id, "Rejected")}>Reject</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Create a single weld through a small form — the record only exists once Save
 * is pressed (no blank rows sitting in the log half-filled).
 */
export function SingleWeldDialog({
  workOrder,
  welders,
  lookups,
  sizes,
  onClose,
  onCreated,
}: {
  /** Fixed work order (in a WO record) or undefined to ask for one. */
  workOrder?: string;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [wo, setWo] = useState(workOrder ?? "");
  const [number, setNumber] = useState("");
  const [stamp, setStamp] = useState("");
  const [dateWelded, setDateWelded] = useState("");
  const [joint, setJoint] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!wo.trim()) { toast.push("err", "Work order is required"); return; }
    setBusy(true);
    try {
      await api.createWeld({
        id: 0,
        status: "Required",
        spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
        count_omission: false,
        work_order: wo.trim(),
        weld_number: number.trim() || null,
        stamp_number: stamp || null,
        date_welded: dateWelded || null,
        joint_type: joint || null,
        size: size ? Number(size) : null,
      } as Weld);
      toast.push("ok", `Weld ${number.trim() || ""} added to WO ${wo.trim()}`);
      onCreated();
    } catch (e) {
      toast.push("err", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a single weld"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save weld"}</button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        For the odd manual record. The standard path — work order → drawing →
        weld map — fills most of this automatically.
      </p>
      <div className="form-grid cols-2">
        <div className="field"><label>Work order</label>
          <input autoFocus={!workOrder} value={wo} disabled={!!workOrder} onChange={(e) => setWo(e.target.value)} /></div>
        <div className="field"><label>Weld #</label>
          <input autoFocus={!!workOrder} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="W1" /></div>
        <div className="field"><label>Welder</label>
          <select value={stamp} onChange={(e) => setStamp(e.target.value)}>
            <option value="">—</option>
            {welders.map((w) => <option key={w.stamp} value={w.stamp}>{w.stamp} — {w.name}</option>)}
          </select></div>
        <div className="field"><label>Date welded</label>
          <input type="date" value={dateWelded} onChange={(e) => setDateWelded(e.target.value)} /></div>
        <div className="field"><label>Joint type</label>
          <select value={joint} onChange={(e) => setJoint(e.target.value)}>
            <option value="">—</option>
            {(lookups.joint_type ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
          </select></div>
        <div className="field"><label>Size (NPS)</label>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">—</option>
            {sizes.map((s) => <option key={s} value={String(s)}>{s}</option>)}
          </select></div>
      </div>
      <p className="hint">Everything else — service, class, material, NDE — is filled in the weld grid or guided fill, where the Table 4 requirement computes live.</p>
    </Modal>
  );
}
