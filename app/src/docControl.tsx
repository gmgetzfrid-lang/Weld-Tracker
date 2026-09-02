import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "./api";
import type { Drawing, DrawingRevision } from "./types";
import { ErrorBox, Modal, Spinner, useToast } from "./components/ui";
import { fileToBase64, loadPdf, base64ToBytes } from "./pdf";
import { openBase64File } from "./continuity";

/** The composed controlled-document name, e.g. "ISO-1042 SHT 2 Rev A". */
export function docName(
  drawingNo?: string | null,
  sheetNo?: string | null,
  rev?: string | null
): string {
  let s = (drawingNo ?? "").trim() || "(untitled)";
  const sh = (sheetNo ?? "").trim();
  if (sh) s += ` SHT ${sh}`;
  const r = (rev ?? "").trim();
  if (r) s += ` Rev ${r}`;
  return s;
}

async function fileToPdf(f: File): Promise<{ b64: string; pages: number }> {
  const b64 = await fileToBase64(f);
  let pages = 1;
  try { pages = (await loadPdf(base64ToBytes(b64))).numPages; } catch { /* non-fatal */ }
  return { b64, pages };
}

/** Issue a new revision of one sheet: supersede the current, make this Effective. */
export function RevisePanel({
  drawing, onClose, onDone,
}: {
  drawing: Drawing;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [rev, setRev] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!rev.trim()) { setError("Enter the new revision label."); return; }
    setBusy(true); setError(null);
    try {
      let pkgId: number | null = null;
      let from: number | null = null;
      let to: number | null = null;
      if (file) {
        const { b64, pages } = await fileToPdf(file);
        pkgId = await api.createPackage(drawing.work_order ?? null, file.name, b64, pages);
        from = 1; to = pages;
      }
      await api.reviseDrawing(drawing.id, rev.trim(), reason.trim() || null, pkgId, from, to);
      toast.push("ok", `Issued Rev ${rev.trim()} — previous revision superseded`);
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Revise ${docName(drawing.drawing_no, drawing.sheet_no, drawing.revision)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Issuing…" : "Issue revision"}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <p className="hint" style={{ marginTop: 0 }}>
        The current revision <b>{drawing.revision ? `Rev ${drawing.revision}` : "(no rev recorded)"}</b> will be marked
        <b> Superseded</b> and kept on record. This new revision becomes the effective drawing;
        its welds carry over.
      </p>
      <div className="form-grid cols-2">
        <div className="field"><label>New revision *</label>
          <input value={rev} onChange={(e) => setRev(e.target.value)} placeholder="e.g. A or 1" /></div>
        <div className="field"><label>Reason / description</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. client redline, spec change" /></div>
      </div>
      <div className="field">
        <label>Revised drawing file <span className="faint">(the new controlled copy)</span></label>
        {file ? (
          <div className="dz-file">
            <span style={{ fontSize: 20 }}>📄</span>
            <div style={{ flex: 1 }}><b>{file.name}</b></div>
            <button className="btn btn-sm btn-danger" onClick={() => setFile(null)}>Remove</button>
          </div>
        ) : (
          <label className="btn" style={{ cursor: "pointer" }}>
            ⬆ Choose revised PDF
            <input type="file" hidden accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <p className="hint" style={{ marginTop: 6 }}>
          Optional — you can bump the revision without a new file (e.g. an admin correction).
        </p>
      </div>
    </Modal>
  );
}

/** The retained revision history for one sheet; view any superseded copy. */
export function RevisionHistory({ drawing, onClose }: { drawing: Drawing; onClose: () => void }) {
  const toast = useToast();
  const [revs, setRevs] = useState<DrawingRevision[] | null>(null);

  const load = useCallback(() => {
    api.listDrawingRevisions(drawing.id).then(setRevs).catch((e) => toast.push("err", errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id]);
  useEffect(load, [load]);

  const view = async (r: DrawingRevision) => {
    try {
      const pdf = await api.getRevisionPdf(r.id);
      if (!pdf) { toast.push("err", "No controlled copy on this revision"); return; }
      openBase64File(pdf[0] || "revision.pdf", pdf[1]);
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  return (
    <Modal
      title={`Revision history — ${docName(drawing.drawing_no, drawing.sheet_no)}`}
      onClose={onClose}
      wide
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      {!revs ? <Spinner /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Rev</th><th>Status</th><th>Reason</th><th>Pages</th><th>Issued</th><th>By</th><th></th></tr></thead>
            <tbody>
              {revs.length === 0 && <tr><td colSpan={7} className="table-empty">No revisions.</td></tr>}
              {revs.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>Rev {r.rev ?? "—"}</td>
                  <td>
                    {r.status === "Effective"
                      ? <span className="badge badge-green">Effective</span>
                      : <span className="badge badge-gray">Superseded</span>}
                  </td>
                  <td>{r.reason ?? <span className="faint">—</span>}</td>
                  <td>{r.has_pdf ? r.page_count : <span className="faint">no file</span>}</td>
                  <td className="faint">{r.issued_date ?? r.created_at ?? "—"}</td>
                  <td className="faint">{r.created_by ?? "—"}</td>
                  <td>{r.has_pdf && <button className="btn btn-sm" onClick={() => view(r)}>View</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

type SheetRow = { drawing_no: string; sheet_no: string; revision: string; page_from: number; page_to: number };

/** Ingest one compiled work-package book: upload once, define the sheets and
 * their page ranges, and create every controlled sheet in one action. */
export function PackageIngest({
  workOrder, lineSpec, onClose, onDone,
}: {
  workOrder: string;
  lineSpec?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File | null) => {
    setFile(f);
    setPages(0);
    if (!f) return;
    try {
      const { pages } = await fileToPdf(f);
      setPages(pages);
      // Seed one sheet per page as a sensible starting point. Rev is left
      // blank on purpose — it comes off each title block, never invented.
      setRows(Array.from({ length: pages }, (_, i) => ({
        drawing_no: "", sheet_no: String(i + 1), revision: "", page_from: i + 1, page_to: i + 1,
      })));
    } catch (e) { setError(errMsg(e)); }
  };

  const setRow = (i: number, patch: Partial<SheetRow>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((p) => [...p, { drawing_no: p[p.length - 1]?.drawing_no ?? "", sheet_no: "", revision: p[p.length - 1]?.revision ?? "", page_from: 1, page_to: pages || 1 }]);
  const delRow = (i: number) => setRows((p) => p.filter((_, j) => j !== i));

  const submit = async () => {
    if (!file) { setError("Upload the work-package PDF first."); return; }
    const usable = rows.filter((r) => r.drawing_no.trim());
    if (usable.length === 0) { setError("Give at least one sheet a drawing number."); return; }
    setBusy(true); setError(null);
    try {
      const { b64, pages: pc } = await fileToPdf(file);
      const pkgId = await api.createPackage(workOrder, file.name, b64, pc);
      for (const r of usable) {
        const id = await api.createDrawing({
          id: 0, work_order: workOrder, drawing_no: r.drawing_no.trim(),
          sheet_no: r.sheet_no.trim() || null, revision: r.revision.trim() || null,
          line_spec: lineSpec ?? null,
          spec_5: false, spec_10: false, spec_20: false, spec_25: false, spec_50: false, spec_100: false,
          has_pdf: false, page_count: 0, weld_count: 0,
        });
        const from = Math.max(1, Math.min(r.page_from, pc));
        const to = Math.max(from, Math.min(r.page_to, pc));
        await api.setEffectiveSource(id, pkgId, from, to);
      }
      toast.push("ok", `Ingested ${usable.length} sheet(s) from ${file.name}`);
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Ingest work package — WO ${workOrder}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !file}>
            {busy ? "Creating…" : "Create sheets"}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <p className="hint" style={{ marginTop: 0 }}>
        Upload the compiled book once. Each row below becomes one controlled sheet that references
        its page range inside the book — no splitting, no per-sheet files. Give each sheet its
        drawing number (sheets of the same drawing share the number, different sheet numbers).
      </p>

      <div className="field">
        {file ? (
          <div className="dz-file">
            <span style={{ fontSize: 20 }}>📚</span>
            <div style={{ flex: 1 }}><b>{file.name}</b><div className="muted" style={{ fontSize: 12 }}>{pages} page(s)</div></div>
            <button className="btn btn-sm btn-danger" onClick={() => onFile(null)}>Remove</button>
          </div>
        ) : (
          <label className="btn" style={{ cursor: "pointer" }}>
            ⬆ Choose the work-package PDF
            <input type="file" hidden accept="application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      {file && (
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table className="data">
            <thead><tr><th>Drawing #</th><th>Sheet #</th><th>Rev</th><th>Page from</th><th>Page to</th><th></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input value={r.drawing_no} onChange={(e) => setRow(i, { drawing_no: e.target.value })} placeholder="ISO-1042" style={{ width: 130 }} /></td>
                  <td><input value={r.sheet_no} onChange={(e) => setRow(i, { sheet_no: e.target.value })} style={{ width: 60 }} /></td>
                  <td><input value={r.revision} onChange={(e) => setRow(i, { revision: e.target.value })} style={{ width: 50 }} /></td>
                  <td><input type="number" min={1} max={pages} value={r.page_from} onChange={(e) => setRow(i, { page_from: Number(e.target.value) })} style={{ width: 70 }} /></td>
                  <td><input type="number" min={1} max={pages} value={r.page_to} onChange={(e) => setRow(i, { page_to: Number(e.target.value) })} style={{ width: 70 }} /></td>
                  <td><button className="btn btn-sm btn-ghost-danger" title="Remove row" onClick={() => delRow(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={addRow}>+ Add sheet</button>
        </div>
      )}
    </Modal>
  );
}
