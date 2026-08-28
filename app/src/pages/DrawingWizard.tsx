import { useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../api";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, num, useToast } from "../components/ui";
import { Coach, Stepper } from "../components/Stepper";
import { Combobox, InlineSelect, InlineText } from "../components/inline";
import { WeldAnnotator } from "./annotator/WeldAnnotator";
import { fileToBase64, loadPdf, base64ToBytes } from "../pdf";

const STEPS = ["Work Order & Iso", "Weld Map", "Weld Details", "Review"];

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
  const [sizes, setSizes] = useState<number[]>([]);
  useEffect(() => { api.pipeSizes().then(setSizes).catch(() => {}); }, []);

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
            <Coach title="Build the weld map">
              Pick a welder, click a weld joint to pull the leader line, then click
              again to drop the bubble. The <b>W-number</b> auto-increments and the
              welder stays selected — keep clicking down the line. Switch welders any
              time (or number keys 1–9). When the bubbles are down, hit{" "}
              <b>Fill details</b> to walk each weld. Each bubble is a weld in the log.
            </Coach>
            <WeldAnnotator
              drawing={drawing}
              welders={welders}
              lookups={lookups}
              sizes={sizes}
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
  const [lineSpecs, setLineSpecs] = useState<string[]>([]);
  useEffect(() => { api.distinctWeldValues("line_spec").then(setLineSpecs).catch(() => {}); }, []);
  const [showBreak, setShowBreak] = useState(!!drawing.line_spec_2);

  const NDE = ["5%", "10%", "20%", "100%"];
  const specKey = (p: string) => `spec_${p.replace("%", "")}` as keyof Drawing;
  const currentNde = NDE.find((p) => drawing[specKey(p)]);
  const setNde = (p: string) => {
    (["spec_5", "spec_10", "spec_20", "spec_25", "spec_50", "spec_100"] as (keyof Drawing)[])
      .forEach((k) => set(k, false as any));
    set(specKey(p), true as any);
  };

  return (
    <>
      <Coach title="Start with the work order, then the isometric">
        Everything ties back to the <b>work order number</b>. The work order, line
        spec and NDE coverage cascade to <b>every weld</b> you place. Size, schedule
        and (past a spec break) the alternate spec are set per weld during{" "}
        <b>Fill details</b>, since they vary along the line.
      </Coach>
      <ErrorBox message={error} />

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico">🗂️</span><h4>Work Order</h4></div>
        <div className="form-grid cols-2">
          <div className="field"><label>Work Order # *</label>
            <input className="big" value={drawing.work_order ?? ""} onChange={(e) => set("work_order", e.target.value)} placeholder="e.g. 302719" /></div>
          <div className="field"><label>Unit</label>
            <input value={drawing.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="e.g. 61 - Steam" /></div>
        </div>
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico">📐</span><h4>Isometric Details</h4></div>
        <div className="form-grid cols-3">
          <div className="field"><label>Drawing / Iso #</label>
            <input value={drawing.drawing_no ?? ""} onChange={(e) => set("drawing_no", e.target.value)} /></div>
          <div className="field"><label>Revision</label>
            <input value={drawing.revision ?? ""} onChange={(e) => set("revision", e.target.value)} /></div>
          <div className="field"><label>Title / Description</label>
            <input value={drawing.title ?? ""} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="field"><label>Line Spec <span className="faint">(autocompletes)</span></label>
            <Combobox value={drawing.line_spec ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec", v || null)} placeholder="start typing…" />
            {!showBreak && (
              <button type="button" className="filldown" style={{ marginTop: 4 }} onClick={() => setShowBreak(true)}>＋ add spec break</button>
            )}
          </div>
          <div className="field"><label>Default Material <span className="faint">(editable per weld)</span></label>
            <Combobox value={drawing.default_material ?? ""} options={lookups.material ?? []} allowCustom onChange={(v) => set("default_material", v || null)} placeholder="e.g. CS" /></div>
          {showBreak && (
            <div className="field"><label>Line Spec after break <span className="faint">(2nd spec)</span></label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Combobox value={drawing.line_spec_2 ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec_2", v || null)} placeholder="spec past the break…" />
                <button type="button" className="btn btn-sm btn-ghost" title="Remove spec break" onClick={() => { setShowBreak(false); set("line_spec_2", null); }}>✕</button>
              </div>
            </div>
          )}
        </div>
        {showBreak && (
          <p className="hint" style={{ marginTop: 8 }}>
            A <b>spec break</b> means the line changes spec partway. Welds start on the primary spec — set each
            weld to the correct side of the break (and its own schedule &amp; material) during <b>Fill details</b>.
          </p>
        )}
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico">◎</span><h4>NDE Coverage</h4><span className="muted">required RT % for welds on this line</span></div>
        <div className="nde-chips">
          {NDE.map((p) => (
            <button key={p} type="button" className={`chip lg ${currentNde === p ? "on" : ""}`} onClick={() => setNde(p)}>{p}</button>
          ))}
        </div>
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico">📎</span><h4>Isometric PDF</h4>{drawing.has_pdf && <span className="badge badge-green">attached</span>}</div>
        <DropZone file={pdfFile} onFile={setPdfFile} hasExisting={drawing.has_pdf} />
      </div>
    </>
  );
}

function DropZone({
  file,
  onFile,
  hasExisting,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  hasExisting: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f?: File | null) => {
    if (f && (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) onFile(f);
  };
  return (
    <div
      className={`dropzone ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept="application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {file ? (
        <div className="dz-file">
          <span style={{ fontSize: 22 }}>📄</span>
          <div style={{ flex: 1 }}><b>{file.name}</b><div className="muted" style={{ fontSize: 12 }}>ready to attach</div></div>
          <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onFile(null); }}>Remove</button>
        </div>
      ) : (
        <>
          <div className="dz-ico">⬆</div>
          <div className="dz-main">Drag the isometric PDF here</div>
          <div className="muted">or click to browse{hasExisting ? " · replaces the current PDF" : ""}</div>
        </>
      )}
    </div>
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
  const specOptions = [drawing.line_spec, drawing.line_spec_2].filter(Boolean) as string[];
  const hasBreak = specOptions.length > 1;

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
                {hasBreak && <th>Line Spec</th>}
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
                  <td><InlineSelect value={w.material} options={lookups.material ?? []} allowCustom onCommit={(v) => save(w, { material: v })} /></td>
                  {hasBreak && <td><InlineSelect value={w.line_spec} options={specOptions} allowCustom onCommit={(v) => save(w, { line_spec: v })} /></td>}
                  <td className="num">{w.thickness ?? "—"}</td>
                  <td>{missing(w) && <span className="badge badge-red">needs size/joint</span>}</td>
                  <td><button className="filldown" title="Copy this row's values to all welds below" onClick={() => fillDown(i)}>⭳ fill down</button></td>
                </tr>
              ))}
              {welds.length === 0 && <tr><td colSpan={hasBreak ? 12 : 11} className="table-empty">No bubbles placed yet — go back to Place Welds.</td></tr>}
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
