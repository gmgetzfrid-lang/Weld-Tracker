import { useCallback, useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import type { Drawing, Lookups, Weld, Welder } from "../types";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { Coach, Stepper } from "../components/Stepper";
import { Combobox } from "../components/inline";
import { WeldAnnotator } from "./annotator/WeldAnnotator";
import { isIncomplete } from "../incomplete";
import { WeldTable } from "../components/WeldTable";
import { fileToBase64, loadPdf, base64ToBytes } from "../pdf";
import { docName } from "../docControl";
import { Icon } from "../components/Icon";

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
  // Sheet and rev start EMPTY on purpose: they come off the title block, and a
  // pre-filled value reads as already answered — people would skip right past.
  const [drawing, setDrawing] = useState<Drawing>({ ...EMPTY, work_order: initialWorkOrder ?? null });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!drawingId);
  const [sizes, setSizes] = useState<number[]>([]);
  useEffect(() => { api.pipeSizes().then(setSizes).catch(logErr("loading pipe sizes")); }, []);
  // Welds on this sheet still missing attributes — shown while you work and
  // checked before you leave, so a half-filled map is never walked away from
  // silently.
  const [incompleteN, setIncompleteN] = useState(0);
  const [exitPrompt, setExitPrompt] = useState(false);
  const refreshIncomplete = useCallback((id: number) => {
    api.listDrawingWelds(id).then((rows) => setIncompleteN(rows.filter(isIncomplete).length)).catch(logErr("counting incomplete welds"));
  }, []);
  useEffect(() => { if (drawing.id) refreshIncomplete(drawing.id); }, [drawing.id, step, refreshIncomplete]);
  const guardedClose = () => { if (incompleteN > 0 && step > 0) setExitPrompt(true); else onClose(); };

  useEffect(() => {
    if (drawingId) {
      api.getDrawing(drawingId)
        .then((d) => { setDrawing(d); setStep(1); })
        .catch((e) => setError(errMsg(e)))
        .finally(() => setLoading(false));
    }
  }, [drawingId]);

  const set = <K extends keyof Drawing>(k: K, v: Drawing[K]) => setDrawing((p) => ({ ...p, [k]: v }));

  // Step 0 -> save the sheet (drawing # + sheet # + rev). One controlled sheet;
  // multi-sheet work packages are ingested from the work-order record.
  const saveHeaderAndNext = async () => {
    setError(null);
    setBusy(true);
    try {
      let id = drawing.id;
      if (drawing.id) {
        await api.updateDrawing(drawing);
      } else {
        id = await api.createDrawing(drawing);
      }
      if (pdfFile) {
        const b64 = await fileToBase64(pdfFile);
        let pages = 0;
        try { pages = (await loadPdf(base64ToBytes(b64))).numPages; } catch { /* non-fatal */ }
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

  // Start a fresh drawing/sheet under the same work order, carrying the shared
  // header (WO, unit, line spec, material) and bumping the sheet number.
  const addAnother = () => {
    const nextSheet = drawing.sheet_no && /^\d+$/.test(drawing.sheet_no.trim())
      ? String(parseInt(drawing.sheet_no, 10) + 1)
      : "";
    setDrawing({
      ...EMPTY,
      work_order: drawing.work_order ?? null,
      unit: drawing.unit ?? null,
      line_spec: drawing.line_spec ?? null,
      line_spec_2: drawing.line_spec_2 ?? null,
      default_material: drawing.default_material ?? null,
      drawing_no: drawing.drawing_no ?? null, // same drawing, next sheet by default
      sheet_no: nextSheet || null,
      // Carry the rev the user actually typed — sheets of one issued set share
      // an issue rev. Never invent one.
      revision: drawing.revision ?? null,
    });
    setPdfFile(null);
    setError(null);
    setStep(0);
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={guardedClose}><Icon name="arrowLeft" size={14} /> Back</button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {drawing.work_order ? `WO ${drawing.work_order}` : "New entry"}
          {drawing.drawing_no ? ` · Iso ${drawing.drawing_no}` : ""}
          {drawing.weld_count ? ` · ${drawing.weld_count} welds` : ""}
        </span>
      </div>

      <div className={`card ${step === 1 ? "wiz-flush" : "card-pad"}`}>
        {step !== 1 && <Stepper steps={STEPS} current={step} />}

        {step === 0 && (
          <HeaderStep drawing={drawing} set={set} lookups={lookups} pdfFile={pdfFile} setPdfFile={setPdfFile} error={error} />
        )}
        {step === 1 && (
          <WeldAnnotator
            drawing={drawing}
            welders={welders}
            lookups={lookups}
            sizes={sizes}
            onChange={(rows) => { setIncompleteN(rows.filter(isIncomplete).length); api.getDrawing(drawing.id).then(setDrawing).catch(logErr("refreshing drawing")); }}
            onComplete={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <ReviewEdit drawing={drawing} welders={welders} lookups={lookups} sizes={sizes} />
        )}

        <div className={`wizard-foot ${step === 1 ? "wiz-flush-foot" : ""}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {step > 0 && incompleteN > 0 && (
              <span className="badge badge-amber" title="These welds are flagged on the dashboard and the work order until they are filled in">
                {incompleteN} weld{incompleteN === 1 ? "" : "s"} still need attributes
              </span>
            )}
            {step === 1 && <button className="btn" onClick={() => setStep(0)}>Back to header</button>}
            {step === 2 && <button className="btn" onClick={() => setStep(1)}>Back to map</button>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step === 0 && (
              <button className="btn btn-primary" onClick={saveHeaderAndNext} disabled={busy}>
                {busy ? "Saving…" : <>{"Save & map welds"} <Icon name="arrowRight" size={14} /></>}
              </button>
            )}
            {step === 1 && (
              <button className="btn btn-ghost" title="Jump to the table without walking each weld (Fill attributes takes you here automatically when you finish)" onClick={() => setStep(2)}>Skip to review table →</button>
            )}
            {step === 2 && (
              <>
                <button className="btn" onClick={addAnother} title="Save this and start another drawing or sheet on the same work order">
                  <Icon name="plus" size={13} stroke={2.25} /> Add another drawing / sheet
                </button>
                <button className="btn btn-accent" onClick={guardedClose}>Finish <Icon name="check" size={14} /></button>
              </>
            )}
          </div>
        </div>
      </div>
      {exitPrompt && (
        <Modal
          title={`${incompleteN} weld${incompleteN === 1 ? "" : "s"} still need attributes`}
          onClose={() => setExitPrompt(false)}
          footer={
            <>
              <button className="btn" onClick={() => { setExitPrompt(false); onClose(); }}>Leave — keep them flagged</button>
              <button className="btn btn-accent" onClick={() => { setExitPrompt(false); setStep(1); }}>Finish them now</button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            You can leave and come back — nothing is lost. Until they're filled in, these welds stay marked <b>?</b> on the map and
            the work order and dashboard keep a <b>"{incompleteN} missing attributes"</b> notice, so they can't be forgotten.
          </p>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            <b>Fill attributes</b> on the map starts at the first weld that needs data and skips the ones already done.
          </p>
        </Modal>
      )}
    </div>
  );
}

function HeaderStep({
  drawing, set, lookups, pdfFile, setPdfFile, error,
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
  const composed = docName(drawing.drawing_no, drawing.sheet_no, drawing.revision);
  // Which identity parts are still blank — surfaced so sheet/rev read as real
  // inputs to fill from the title block, not pre-answered boxes to skip.
  const sheetBlank = !String(drawing.sheet_no ?? "").trim();
  const revBlank = !String(drawing.revision ?? "").trim();
  const idNeeded = [sheetBlank && "sheet", revBlank && "rev"].filter(Boolean) as string[];

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Start with the <b>work order</b> and the isometric. Size, schedule, material and NDE are set
        per weld while you fill &amp; review — they vary along the line.
      </p>
      <ErrorBox message={error} />

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico"><Icon name="folder" size={16} /></span><h4>Work Order</h4></div>
        <div className="wrow">
          <div className="field" style={{ flex: "0 0 220px" }}>
            <label>Work Order # *</label>
            <input className="big" value={drawing.work_order ?? ""} onChange={(e) => set("work_order", e.target.value)} placeholder="e.g. 302719" /></div>
          <div className="field" style={{ flex: "0 0 200px" }}>
            <label>Unit</label>
            <input value={drawing.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="e.g. 61 - Steam" /></div>
        </div>
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico"><Icon name="ruler" size={16} /></span><h4>Drawing (controlled document)</h4>
          {composed && <span className="badge badge-blue" style={{ marginLeft: "auto" }}>{composed}</span>}</div>
        <div className="field span-full" style={{ maxWidth: 560 }}>
          <label>Drawing identity <span className="faint">— number, sheet and revision form one document name</span></label>
          <div className="seg">
            <div className="seg-part grow">
              <span className="seg-lab">Drawing / Iso #</span>
              <input value={drawing.drawing_no ?? ""} onChange={(e) => set("drawing_no", e.target.value)} placeholder="ISO-1042" />
            </div>
            <div className={`seg-part narrow ${sheetBlank ? "seg-need" : ""}`}>
              <span className="seg-lab">Sheet</span>
              <input value={drawing.sheet_no ?? ""} onChange={(e) => set("sheet_no", e.target.value)}
                title="Sheet number from the title block (leave blank only for a single-sheet iso)" />
            </div>
            <div className={`seg-part narrow ${revBlank ? "seg-need" : ""}`}>
              <span className="seg-lab">Rev</span>
              <input value={drawing.revision ?? ""} onChange={(e) => set("revision", e.target.value)}
                title="Revision from the title block — type 0 if it's the original issue" />
            </div>
          </div>
          <div className="hint">
            Reads as <b>{composed || "…"}</b>
            {idNeeded.length > 0 && (
              <span className="id-need"> — enter the {idNeeded.join(" and ")} from the title block</span>
            )}

          </div>
        </div>

        <div className="wrow">
          <div className="field" style={{ flex: "0 0 210px" }}>
            <label>Line Spec <span className="faint">(autocompletes)</span></label>
            <Combobox value={drawing.line_spec ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec", v || null)} placeholder="start typing…" />
            {!showBreak && (
              <button type="button" className="filldown" style={{ marginTop: 4 }} onClick={() => setShowBreak(true)}>+ add spec break</button>
            )}
          </div>
          {showBreak && (
            <div className="field" style={{ flex: "0 0 250px" }}>
              <label>Line Spec after break <span className="faint">(2nd spec)</span></label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Combobox value={drawing.line_spec_2 ?? ""} options={lineSpecs} allowCustom onChange={(v) => set("line_spec_2", v || null)} placeholder="spec past the break…" />
                </div>
                <button type="button" className="btn btn-sm btn-ghost" title="Remove spec break" onClick={() => { setShowBreak(false); set("line_spec_2", null); }}><Icon name="x" size={13} /></button>
              </div>
            </div>
          )}
          <div className="field" style={{ flex: "0 0 150px" }}>
            <label>Default Material <span className="faint">(per weld)</span></label>
            <Combobox value={drawing.default_material ?? ""} options={lookups.material ?? []} allowCustom onChange={(v) => set("default_material", v || null)} placeholder="e.g. CS" />
          </div>
        </div>
        <div className="field span-full" style={{ maxWidth: 540 }}>
          <label>Title / Description</label>
          <input value={drawing.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 8&quot; steam header, unit 61" />
        </div>
        {showBreak && (
          <p className="hint" style={{ marginTop: 8 }}>
            A <b>spec break</b> means the line changes spec partway. Welds start on the primary spec — set each
            weld to the correct side of the break during <b>Fill attributes</b>.
          </p>
        )}
      </div>

      <div className="wsection">
        <div className="wsection-head"><span className="wsection-ico"><Icon name="paperclip" size={16} /></span><h4>Controlled copy (this sheet's PDF)</h4>{drawing.has_pdf && <span className="badge badge-green">attached</span>}</div>
        <DropZone file={pdfFile} onFile={setPdfFile} hasExisting={drawing.has_pdf} />
        <p className="hint" style={{ marginTop: 8 }}>
          This is one sheet. If your drawings came as a <b>compiled work-package book</b>, skip this and
          use <b>“Ingest work package”</b> on the work order — upload the book once and split it into
          sheets by page range. To issue a later revision, use <b>Revise</b> on the sheet.
        </p>
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
          <span className="dz-ico"><Icon name="file" size={22} /></span>
          <div style={{ flex: 1 }}><b>{file.name}</b><div className="muted" style={{ fontSize: 13 }}>ready to attach</div></div>
          <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onFile(null); }}>Remove</button>
        </div>
      ) : (
        <>
          <div className="dz-ico"><Icon name="upload" size={26} /></div>
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
        pressure test, status. Use the chevron on a row for the cert, line spec and the rest.
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
