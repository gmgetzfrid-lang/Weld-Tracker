import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Spinner, useToast } from "../components/ui";
import { Coach, Stepper } from "../components/Stepper";
import { Combobox } from "../components/inline";
import { WeldAnnotator } from "./annotator/WeldAnnotator";
import { WeldTable } from "../components/WeldTable";
import { fileToBase64, loadPdf, base64ToBytes } from "../pdf";

const STEPS = ["Work Order & Iso", "Weld Map & Fill", "Review & Edit"];

const EMPTY: Drawing = {
  id: 0,
  spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
  has_pdf: false, page_count: 0, weld_count: 0,
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
  const [drawing, setDrawing] = useState<Drawing>({ ...EMPTY, work_order: initialWorkOrder ?? null });
  const [drawNos, setDrawNos] = useState<string[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!drawingId);
  const [sizes, setSizes] = useState<number[]>([]);
  useEffect(() => { api.pipeSizes().then(setSizes).catch(() => {}); }, []);

  useEffect(() => {
    if (drawingId) {
      api.getDrawing(drawingId)
        .then((d) => { setDrawing(d); setDrawNos(d.drawing_no ? [d.drawing_no] : []); setStep(1); })
        .catch((e) => setError(errMsg(e)))
        .finally(() => setLoading(false));
    }
  }, [drawingId]);

  const set = <K extends keyof Drawing>(k: K, v: Drawing[K]) => setDrawing((p) => ({ ...p, [k]: v }));

  // Step 0 -> save the header. One drawing per drawing-number (a work order can
  // have several); annotate the first, the rest wait under the work order.
  const saveHeaderAndNext = async () => {
    setError(null);
    setBusy(true);
    try {
      const nums = drawNos.length ? drawNos : [drawing.drawing_no ?? ""].filter(Boolean);
      let firstId = drawing.id;
      if (drawing.id) {
        await api.updateDrawing({ ...drawing, drawing_no: nums[0] ?? drawing.drawing_no ?? null });
      } else {
        firstId = await api.createDrawing({ ...drawing, drawing_no: nums[0] ?? null });
        for (let i = 1; i < nums.length; i++) {
          await api.createDrawing({ ...drawing, id: 0, drawing_no: nums[i] });
        }
      }
      if (pdfFile) {
        const b64 = await fileToBase64(pdfFile);
        let pages = 0;
        try { pages = (await loadPdf(base64ToBytes(b64))).numPages; } catch { /* non-fatal */ }
        await api.setDrawingPdf(firstId, pdfFile.name, b64, pages);
      }
      const fresh = await api.getDrawing(firstId);
      setDrawing(fresh);
      setPdfFile(null);
      if (nums.length > 1)
        toast.push("ok", `${nums.length} drawings created — annotating ${nums[0]}. The rest are ready under this work order.`);
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
          <HeaderStep drawing={drawing} set={set} lookups={lookups} drawNos={drawNos} setDrawNos={setDrawNos} pdfFile={pdfFile} setPdfFile={setPdfFile} error={error} />
        )}
        {step === 1 && (
          <>
            <Coach title="Map the welds, then Fill attributes">
              Pick a welder, click a joint then click to drop the bubble — the <b>W-number</b>
              auto-increments and the welder stays selected, so keep clicking down the line (switch
              welders any time or press 1–9). When the bubbles are down, hit <b>Fill attributes ▶</b>:
              the map jumps to each weld, pulses it, and pops a card right beside it. Enter or
              <b> Save &amp; next</b> moves to the following weld.
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
        {step === 2 && (
          <ReviewEdit drawing={drawing} welders={welders} lookups={lookups} sizes={sizes} />
        )}

        <div className="wizard-foot">
          <div>
            {step === 1 && <button className="btn" onClick={() => setStep(0)}>Back to header</button>}
            {step === 2 && <button className="btn" onClick={() => setStep(1)}>Back to map</button>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step === 0 && (
              <button className="btn btn-primary" onClick={saveHeaderAndNext} disabled={busy}>
                {busy ? "Saving…" : "Save & map welds →"}
              </button>
            )}
            {step === 1 && (
              <button className="btn btn-primary" onClick={() => setStep(2)}>Review &amp; edit →</button>
            )}
            {step === 2 && (
              <button className="btn btn-accent" onClick={onClose}>Finish ✓</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderStep({
  drawing, set, lookups, drawNos, setDrawNos, pdfFile, setPdfFile, error,
}: {
  drawing: Drawing;
  set: <K extends keyof Drawing>(k: K, v: Drawing[K]) => void;
  lookups: Lookups;
  drawNos: string[];
  setDrawNos: (f: (p: string[]) => string[]) => void;
  pdfFile: File | null;
  setPdfFile: (f: File | null) => void;
  error: string | null;
}) {
  const [lineSpecs, setLineSpecs] = useState<string[]>([]);
  useEffect(() => { api.distinctWeldValues("line_spec").then(setLineSpecs).catch(() => {}); }, []);
  const [showBreak, setShowBreak] = useState(!!drawing.line_spec_2);
  const [noText, setNoText] = useState("");

  const addNo = () => {
    const v = noText.trim();
    if (!v) return;
    setDrawNos((p) => (p.includes(v) ? p : [...p, v]));
    setNoText("");
  };

  return (
    <>
      <Coach title="Start with the work order, then the isometric">
        Everything ties back to the <b>work order number</b>. The work order and line spec cascade to
        the welds you place. Size, schedule, material and NDE are set per weld while you fill and
        review — they vary along the line.
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
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Drawing / Iso # <span className="faint">— add one or several (a work order can span many)</span></label>
            <div className="chip-input">
              {drawNos.map((n, i) => (
                <span key={i} className="chip on sm">{n}
                  <button type="button" onClick={() => setDrawNos((p) => p.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              <input
                value={noText}
                onChange={(e) => setNoText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNo(); } }}
                placeholder={drawNos.length ? "add another…" : "type a drawing #, Enter to add"}
              />
              {noText.trim() && <button type="button" className="btn btn-sm" onClick={addNo}>+ Add</button>}
            </div>
          </div>
          <div className="field"><label>Revision</label>
            <input value={drawing.revision ?? ""} onChange={(e) => set("revision", e.target.value)} /></div>
          <div className="field"><label>Line Spec <span className="faint">(autocompletes)</span></label>
            <Combobox value={drawing.line_spec ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec", v || null)} placeholder="start typing…" />
            {!showBreak && (
              <button type="button" className="filldown" style={{ marginTop: 4 }} onClick={() => setShowBreak(true)}>＋ add spec break</button>
            )}
          </div>
          {showBreak && (
            <div className="field"><label>Line Spec after break <span className="faint">(2nd spec)</span></label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Combobox value={drawing.line_spec_2 ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec_2", v || null)} placeholder="spec past the break…" />
                <button type="button" className="btn btn-sm btn-ghost" title="Remove spec break" onClick={() => { setShowBreak(false); set("line_spec_2", null); }}>✕</button>
              </div>
            </div>
          )}
          <div className="field"><label>Default Material <span className="faint">(editable per weld)</span></label>
            <Combobox value={drawing.default_material ?? ""} options={lookups.material ?? []} allowCustom onChange={(v) => set("default_material", v || null)} placeholder="e.g. CS" /></div>
          <div className="field"><label>Title / Description</label>
            <input value={drawing.title ?? ""} onChange={(e) => set("title", e.target.value)} /></div>
        </div>
        {showBreak && (
          <p className="hint" style={{ marginTop: 8 }}>
            A <b>spec break</b> means the line changes spec partway. Welds start on the primary spec — set each
            weld to the correct side of the break during <b>Fill attributes</b>.
          </p>
        )}
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico">📎</span><h4>Isometric PDF</h4>{drawing.has_pdf && <span className="badge badge-green">attached</span>}</div>
        <DropZone file={pdfFile} onFile={setPdfFile} hasExisting={drawing.has_pdf} />
      </div>
    </>
  );
}

function DropZone({ file, onFile, hasExisting }: { file: File | null; onFile: (f: File | null) => void; hasExisting: boolean }) {
  const [over, setOver] = useState(false);
  let ref: HTMLInputElement | null = null;
  const pick = (f?: File | null) => {
    if (f && (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) onFile(f);
  };
  return (
    <div
      className={`dropzone ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
      onClick={() => ref?.click()}
    >
      <input ref={(r) => (ref = r)} type="file" accept="application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
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

function ReviewEdit({
  drawing, welders, lookups, sizes,
}: {
  drawing: Drawing;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
}) {
  const [welds, setWelds] = useState<Weld[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () =>
    api.listDrawingWelds(drawing.id).then((r) => {
      setWelds(r.sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true })));
      setLoading(false);
    });
  useEffect(() => { load(); }, [drawing.id]);

  return (
    <>
      <Coach title="Review &amp; edit — every cell is editable">
        These are the welds you mapped, now in the log. The table is in <b>edit mode</b>: click any
        cell to change it — size, joint type, schedule, material, NDE %, NDE type, the X-ray result,
        pressure test, status. Use the <b>▸</b> chevron on a row for the cert, line spec and the rest.
      </Coach>
      {loading ? <Spinner /> : (
        <WeldTable
          welds={welds}
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          editable
          initialEdit
          onChanged={load}
        />
      )}
    </>
  );
}
