import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { Coach, Stepper } from "../components/Stepper";
import { WeldAnnotator } from "./annotator/WeldAnnotator";
import { fileToBase64, loadPdf, base64ToBytes } from "../pdf";

const STEPS = ["Drawing", "Annotate", "Attributes", "Review"];

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
  welders,
  lookups,
  onClose,
}: {
  drawingId: number | null;
  welders: Welder[];
  lookups: Lookups;
  onClose: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [drawing, setDrawing] = useState<Drawing>({ ...EMPTY });
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
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← All drawings</button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          {drawing.drawing_no ? `Drawing ${drawing.drawing_no}` : "New drawing"}
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
        {step === 2 && <AttributesStep drawing={drawing} lookups={lookups} />}
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
      <Coach title="Enter the drawing header once">
        These fields cascade to <b>every weld</b> you place on this isometric, so
        you only type them a single time. The NDE % you pick becomes each weld's
        required coverage.
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
          <select value={drawing.default_material ?? ""} onChange={(e) => set("default_material", e.target.value || null)}>
            <option value="">—</option>
            {(lookups.material ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div className="field"><label>Default Schedule</label>
          <select value={drawing.default_schedule ?? ""} onChange={(e) => set("default_schedule", e.target.value || null)}>
            <option value="">—</option>
            {(lookups.schedule ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
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

function AttributesStep({ drawing, lookups }: { drawing: Drawing; lookups: Lookups }) {
  const toast = useToast();
  const [welds, setWelds] = useState<Weld[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [attrs, setAttrs] = useState<{ size: string; joint_type: string; groove_type: string; process: string; schedule: string; material: string }>(
    { size: "", joint_type: "", groove_type: "", process: "", schedule: "", material: "" }
  );

  const load = () => api.listDrawingWelds(drawing.id).then((r) => setWelds(r.sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true }))));
  useEffect(() => { load(); }, [drawing.id]);

  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allSelected = welds.length > 0 && sel.size === welds.length;

  const apply = async () => {
    if (sel.size === 0) return toast.push("err", "Select one or more welds first");
    try {
      await api.applyWeldAttributes([...sel], {
        size: attrs.size ? Number(attrs.size) : null,
        joint_type: attrs.joint_type || null,
        groove_type: attrs.groove_type || null,
        process: attrs.process || null,
        schedule: attrs.schedule || null,
        material: attrs.material || null,
      });
      toast.push("ok", `Applied to ${sel.size} weld(s)`);
      await load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const missing = (w: Weld) => !w.size || !w.joint_type;

  return (
    <>
      <Coach title="Fill what the drawing can't infer">
        Header, welder, weld number and NDE % are already set. Select a run of
        welds (they're often the same size &amp; joint), choose the values below and
        <b> apply to selection</b>. Rows still missing size or joint type are
        flagged.
      </Coach>
      <div className="card card-pad" style={{ background: "var(--surface-2)", marginBottom: 14 }}>
        <div className="form-grid cols-4" style={{ marginBottom: 10 }}>
          <div className="field"><label>Size (NPS)</label>
            <input type="number" step="any" value={attrs.size} onChange={(e) => setAttrs({ ...attrs, size: e.target.value })} /></div>
          <div className="field"><label>Joint Type</label>
            <select value={attrs.joint_type} onChange={(e) => setAttrs({ ...attrs, joint_type: e.target.value })}>
              <option value="">—</option>{(lookups.joint_type ?? []).map((v) => <option key={v}>{v}</option>)}
            </select></div>
          <div className="field"><label>Groove Type</label>
            <select value={attrs.groove_type} onChange={(e) => setAttrs({ ...attrs, groove_type: e.target.value })}>
              <option value="">—</option>{(lookups.groove_type ?? []).map((v) => <option key={v}>{v}</option>)}
            </select></div>
          <div className="field"><label>Process</label>
            <select value={attrs.process} onChange={(e) => setAttrs({ ...attrs, process: e.target.value })}>
              <option value="">—</option>{(lookups.process ?? []).map((v) => <option key={v}>{v}</option>)}
            </select></div>
          <div className="field"><label>Schedule</label>
            <select value={attrs.schedule} onChange={(e) => setAttrs({ ...attrs, schedule: e.target.value })}>
              <option value="">—</option>{(lookups.schedule ?? []).map((v) => <option key={v}>{v}</option>)}
            </select></div>
          <div className="field"><label>Material</label>
            <select value={attrs.material} onChange={(e) => setAttrs({ ...attrs, material: e.target.value })}>
              <option value="">—</option>{(lookups.material ?? []).map((v) => <option key={v}>{v}</option>)}
            </select></div>
        </div>
        <button className="btn btn-primary" onClick={apply}>Apply to {sel.size} selected</button>
        <span className="hint" style={{ marginLeft: 10 }}>Only filled fields are written.</span>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allSelected} onChange={(e) => setSel(e.target.checked ? new Set(welds.map((w) => w.id)) : new Set())} /></th>
              <th>Weld #</th><th>Welder</th><th className="num">Size</th><th>Joint</th>
              <th>Groove</th><th>Process</th><th className="num">Sched</th><th className="num">Thk</th><th></th>
            </tr>
          </thead>
          <tbody>
            {welds.map((w) => (
              <tr key={w.id} className={missing(w) ? "" : ""}>
                <td><input type="checkbox" checked={sel.has(w.id)} onChange={() => toggle(w.id)} /></td>
                <td style={{ fontWeight: 600 }}>{w.weld_number}</td>
                <td>{w.stamp_number ?? "—"}</td>
                <td className="num">{w.size ?? "—"}</td>
                <td>{w.joint_type ?? "—"}</td>
                <td>{w.groove_type ?? "—"}</td>
                <td>{w.process ?? "—"}</td>
                <td className="num">{w.schedule ?? "—"}</td>
                <td className="num">{w.thickness ?? "—"}</td>
                <td>{missing(w) && <span className="badge badge-red">needs size/joint</span>}</td>
              </tr>
            ))}
            {welds.length === 0 && <tr><td colSpan={10} className="table-empty">No bubbles placed yet — go back to Annotate.</td></tr>}
          </tbody>
        </table>
      </div>
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
