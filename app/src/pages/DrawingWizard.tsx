import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { Coach, Stepper } from "../components/Stepper";
import { Combobox, InlineSelect, InlineText } from "../components/inline";
import { WeldAnnotator } from "./annotator/WeldAnnotator";
import { fileToBase64, loadPdf, base64ToBytes } from "../pdf";

const STEPS = ["Work Order & Iso", "Place Welds", "Details", "Review"];

const EMPTY: Drawing = {
  id: 0,
  spec_5: false,
  spec_10: false,
  spec_20: false,
  spec_25: false,
  spec_50: false,
  spec_100: false,
  has_pdf: false,
  page_count: 0,
  weld_count: 0,
};

export function DrawingWizard({
  drawingId,
  initialWorkOrder,
  welders,
  lookups,
  onClose,
}: {
  drawingId: number | null;
  initialWorkOrder?: string;
  welders: Welder[];
  lookups: Lookups;
  onClose: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [drawing, setDrawing] = useState<Drawing>({
    ...EMPTY,
    work_order: initialWorkOrder ?? null,
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!drawingId);

  useEffect(() => {
    if (drawingId) {
      api
        .getDrawing(drawingId)
        .then((d) => {
          setDrawing(d);
          setStep(1);
        })
        .catch((e) => setError(errMsg(e)))
        .finally(() => setLoading(false));
    }
  }, [drawingId]);

  const set = <K extends keyof Drawing>(k: K, v: Drawing[K]) =>
    setDrawing((p) => ({ ...p, [k]: v }));

  // Step 0 -> save header (+ pdf), ensure the drawing exists, then annotate.
  const saveHeaderAndNext = async () => {
    setError(null);
    setBusy(true);
    try {
      let id = drawing.id;
      if (id) {
        await api.updateDrawing(drawing);
      } else {
        id = await api.createDrawing(drawing);
      }
      if (pdfFile) {
        const b64 = await fileToBase64(pdfFile);
        let pages = 0;
        try {
          const doc = await loadPdf(base64ToBytes(b64));
          pages = doc.numPages;
        } catch {
          /* non-fatal: store anyway */
        }
        await api.setDrawingPdf(id, pdfFile.name, b64, pages);
      }
      const fresh = await api.getDrawing(id);
      setDrawing(fresh);
      setPdfFile(null);
      setStep(1);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back</button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          {drawing.work_order ? `WO ${drawing.work_order}` : "New entry"}
          {drawing.drawing_no ? ` · Iso ${drawing.drawing_no}` : ""}
          {drawing.weld_count ? ` · ${drawing.weld_count} welds` : ""}
        </span>
      </div>

      <div className="card card-pad">
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <HeaderStep drawing={drawing} set={set} lookups={lookups} pdfFile={pdfFile} setPdfFile={setPdfFile} error={error} />
        )}
        {step === 1 && (
          <>
            <Coach title="Place the weld bubbles">
              Pick a welder, click a weld joint on the isometric to pull the leader
              line, then click again to drop the bubble. The weld number
              auto-increments and the welder stays selected — keep clicking down the
              line, press <b>Enter</b> to end a run. Each bubble creates a weld row.
            </Coach>
            <WeldAnnotator
              drawing={drawing}
              welders={welders}
              onChange={() => api.getDrawing(drawing.id).then(setDrawing).catch(() => {})}
            />
          </>
        )}
        {step === 2 && <AttributesStep drawing={drawing} lookups={lookups} welders={welders} />}
        {step === 3 && <ReviewStep drawing={drawing} onClose={onClose} />}

        <div className="wizard-foot">
          <div>
            {step > 0 && step !== 1 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>Back</button>
            )}
            {step === 1 && (
              <button className="btn" onClick={() => setStep(0)}>Back to header</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step === 0 && (
              <button className="btn btn-primary" onClick={saveHeaderAndNext} disabled={busy}>
                {busy ? "Saving…" : "Save & annotate →"}
              </button>
            )}
            {step === 1 && (
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                Fill attributes →
              </button>
            )}
            {step === 2 && (
              <button className="btn btn-primary" onClick={() => setStep(3)}>Review →</button>
            )}
            {step === 3 && (
              <button className="btn btn-accent" onClick={onClose}>Finish ✓</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderStep({
  drawing,
  set,
  lookups,
  pdfFile,
  setPdfFile,
  error,
}: {
  drawing: Drawing;
  set: <K extends keyof Drawing>(k: K, v: Drawing[K]) => void;
  lookups: Lookups;
  pdfFile: File | null;
  setPdfFile: (f: File | null) => void;
  error: string | null;
}) {
  const nde: [keyof Drawing, string][] = [
    ["spec_5", "5%"],
    ["spec_10", "10%"],
    ["spec_20", "20%"],
    ["spec_25", "25%"],
    ["spec_50", "50%"],
    ["spec_100", "100%"],
  ];
  return (
    <>
      <Coach title="Start with the work order, then the isometric">
        Everything ties back to the <b>work order number</b>. Enter it (and the iso
        details) once here — it cascades to <b>every weld</b> you place, so you never
        retype it. The NDE % you pick becomes each weld's required coverage.
      </Coach>
      <ErrorBox message={error} />
      <div className="form-grid cols-3">
        <div className="field"><label>Work Order #</label>
          <input value={drawing.work_order ?? ""} onChange={(e) => set("work_order", e.target.value)} /></div>
        <div className="field"><label>Drawing / Iso #</label>
          <input value={drawing.drawing_no ?? ""} onChange={(e) => set("drawing_no", e.target.value)} /></div>
        <div className="field"><label>Unit</label>
          <input value={drawing.unit ?? ""} onChange={(e) => set("unit", e.target.value)} /></div>
        <div className="field"><label>Line Spec</label>
          <input value={drawing.line_spec ?? ""} onChange={(e) => set("line_spec", e.target.value)} /></div>
        <div className="field"><label>Revision</label>
          <input value={drawing.revision ?? ""} onChange={(e) => set("revision", e.target.value)} /></div>
        <div className="field"><label>Title</label>
          <input value={drawing.title ?? ""} onChange={(e) => set("title", e.target.value)} /></div>
        <div className="field"><label>Default Material</label>
          <Combobox value={drawing.default_material ?? ""} options={lookups.material ?? []} allowCustom onChange={(v) => set("default_material", v || null)} placeholder="e.g. CS" /></div>
        <div className="field"><label>Default Schedule</label>
          <Combobox value={drawing.default_schedule ?? ""} options={lookups.schedule ?? []} allowCustom onChange={(v) => set("default_schedule", v || null)} placeholder="e.g. STD/40s" /></div>
      </div>
      <div className="field">
        <label>NDE requirement (RT coverage)</label>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
          {nde.map(([k, label]) => (
            <label className="checkline" key={k as string} style={{ margin: 0 }}>
              <input type="checkbox" checked={Boolean(drawing[k])} onChange={(e) => set(k, e.target.checked as any)} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Isometric PDF {drawing.has_pdf && <span className="badge badge-green">attached</span>}</label>
        <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
        {pdfFile && <div className="hint">Selected: {pdfFile.name}</div>}
      </div>
    </>
  );
}

function AttributesStep({
  drawing,
  lookups,
  welders,
}: {
  drawing: Drawing;
  lookups: Lookups;
  welders: Welder[];
}) {
  const toast = useToast();
  const [welds, setWelds] = useState<Weld[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api.listDrawingWelds(drawing.id).then((r) => {
      setWelds(
        r.sort((a, b) =>
          (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true })
        )
      );
      setLoading(false);
    });
  useEffect(() => { load(); }, [drawing.id]);

  // Inline edit: optimistic local patch, then persist (thickness/inches recompute).
  const save = async (w: Weld, changes: Partial<Weld>) => {
    const updated = { ...w, ...changes };
    setWelds((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    try {
      await api.updateWeld(updated);
      const fresh = await api.getWeld(w.id);
      setWelds((prev) => prev.map((x) => (x.id === w.id ? fresh : x)));
    } catch (e) {
      toast.push("err", errMsg(e));
      load();
    }
  };

  const fillDown = async (i: number) => {
    const src = welds[i];
    const below = welds.slice(i + 1).map((w) => w.id);
    if (below.length === 0) return toast.push("ok", "Nothing below to fill");
    try {
      await api.applyWeldAttributes(below, {
        size: src.size ?? null,
        joint_type: src.joint_type ?? null,
        groove_type: src.groove_type ?? null,
        process: src.process ?? null,
        schedule: src.schedule ?? null,
        material: src.material ?? null,
      });
      toast.push("ok", `Copied to ${below.length} weld(s) below`);
      await load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const stamps = welders.map((w) => w.stamp);
  const missing = (w: Weld) => !w.size || !w.joint_type;

  return (
    <>
      <Coach title="Click any cell to edit — no selecting first">
        Fill what the drawing can't infer. <b>Click a cell, type or pick, done.</b>{" "}
        Welds usually run the same, so use <b>⭳ fill down</b> on a row to copy its
        values to every weld below it. Thickness auto-computes from size + schedule.
      </Coach>
      {loading ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Weld #</th><th>Welder</th><th className="num">Size</th><th>Joint</th>
                <th>Groove</th><th>Process</th><th>Sched</th><th>Material</th>
                <th className="num">Thk</th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {welds.map((w, i) => (
                <tr key={w.id}>
                  <td style={{ fontWeight: 600 }}>{w.weld_number}</td>
                  <td><InlineSelect value={w.stamp_number} options={stamps} onCommit={(v) => save(w, { stamp_number: v })} /></td>
                  <td className="num"><InlineText value={w.size} numeric align="right" onCommit={(v) => save(w, { size: v == null ? null : Number(v) })} /></td>
                  <td><InlineSelect value={w.joint_type} options={lookups.joint_type ?? []} onCommit={(v) => save(w, { joint_type: v })} /></td>
                  <td><InlineSelect value={w.groove_type} options={lookups.groove_type ?? []} onCommit={(v) => save(w, { groove_type: v })} /></td>
                  <td><InlineSelect value={w.process} options={lookups.process ?? []} onCommit={(v) => save(w, { process: v })} /></td>
                  <td><InlineSelect value={w.schedule} options={lookups.schedule ?? []} onCommit={(v) => save(w, { schedule: v })} /></td>
                  <td><InlineSelect value={w.material} options={lookups.material ?? []} onCommit={(v) => save(w, { material: v })} /></td>
                  <td className="num">{w.thickness ?? "—"}</td>
                  <td>{missing(w) && <span className="badge badge-red">needs size/joint</span>}</td>
                  <td><button className="filldown" title="Copy this row's values to all welds below" onClick={() => fillDown(i)}>⭳ fill down</button></td>
                </tr>
              ))}
              {welds.length === 0 && <tr><td colSpan={11} className="table-empty">No bubbles placed yet — go back to Place Welds.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReviewStep({ drawing, onClose }: { drawing: Drawing; onClose: () => void }) {
  const [welds, setWelds] = useState<Weld[]>([]);
  useEffect(() => { api.listDrawingWelds(drawing.id).then(setWelds); }, [drawing.id]);
  const missing = welds.filter((w) => !w.size || !w.joint_type).length;
  const withWelder = welds.filter((w) => w.stamp_number).length;
  const stats = useMemo(() => {
    const byJoint: Record<string, number> = {};
    welds.forEach((w) => { const k = w.joint_type || "(unset)"; byJoint[k] = (byJoint[k] || 0) + 1; });
    return byJoint;
  }, [welds]);

  return (
    <>
      <Coach title="Review & finish">
        The welds below are now in the log and mapped on the drawing. You can add
        NDE results later from the Weld Log as inspections happen.
      </Coach>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">Welds Placed</div><div className="value">{num(welds.length)}</div></div>
        <div className="stat"><div className="label">Welder Assigned</div><div className="value">{num(withWelder)}</div></div>
        <div className="stat"><div className="label">Needs Attributes</div><div className="value" style={{ color: missing ? "var(--st-required)" : undefined }}>{num(missing)}</div></div>
        <div className="stat"><div className="label">Drawing</div><div className="value" style={{ fontSize: 18 }}>{drawing.drawing_no || "—"}</div></div>
      </div>
      <div className="card card-pad">
        <h3>By Joint Type</h3>
        {Object.entries(stats).map(([k, v]) => (
          <div className="bar-row" key={k}>
            <div className="bar-label">{k}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / Math.max(1, welds.length)) * 100}%` }} /></div>
            <div className="bar-val">{v}</div>
          </div>
        ))}
      </div>
      {missing > 0 && (
        <div className="error-box" style={{ marginTop: 14 }}>
          {missing} weld(s) still need a size or joint type — you can finish now and
          complete them later in the Weld Log or the Attributes step.
        </div>
      )}
    </>
  );
}
