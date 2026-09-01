import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { QualityFile } from "../types";
import { ConfirmDialog, useToast } from "../components/ui";
import { fileToBase64 } from "../pdf";

// The categories a quality-package file can be filed under (mirrors
// weldcore/src/wo_files.rs CATEGORIES).
const CATEGORIES = [
  "Weld Map",
  "NDE Report",
  "UT Thickness",
  "MTR",
  "Hydro Chart",
  "PWHT Chart",
  "PMI",
  "Other",
];

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The work order's quality package: the durable job file. Upload the final weld
 * map, NDE reports, UT thickness readings, MTRs, hydro / PWHT charts and PMI
 * records here — everything that belongs to the whole work order.
 */
export function QualityPackage({ workOrder }: { workOrder: string }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const editable = can("editor");
  const [files, setFiles] = useState<QualityFile[]>([]);
  const [category, setCategory] = useState("NDE Report");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.listWoFiles(workOrder).then(setFiles).catch((e) => { logErr("loading quality package")(e); setFiles([]); });
  }, [workOrder]);
  useEffect(load, [load]);

  const canDelete = (f: QualityFile) =>
    user != null && (user.role === "admin" || f.uploaded_by === user.username);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const b64 = await fileToBase64(file);
        await api.addWoFile(workOrder, category, file.name, file.type || null, b64, null);
      }
      toast.push("ok", `Added ${list.length} file(s) to the quality package`);
      load();
    } catch (e) {
      toast.push("err", errMsg(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const view = async (f: QualityFile) => {
    try {
      const got = await api.getWoFile(f.id);
      if (!got) return;
      const [name, , b64] = got;
      // window.open / download links are inert inside the WebView — the
      // backend writes the file out and launches the OS default viewer.
      await api.saveExport(name || "file", b64, "open");
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const [confirmDel, setConfirmDel] = useState<QualityFile | null>(null);
  const del = async (f: QualityFile) => {
    try {
      await api.deleteWoFile(f.id);
      load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const byCat = CATEGORIES.map((c) => ({
    cat: c,
    items: files.filter((f) => (f.category ?? "Other") === c),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="qp">
      <div className="section-head">
        <h3>Quality package</h3>
        <span className="muted">the job file — weld map, NDE reports, UT, MTRs, hydro &amp; PWHT charts, PMI</span>
      </div>

      {editable && (
        <div
          className={`qp-drop ${dragOver ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
        >
          <div className="qp-drop-row">
            <label className="qp-cat">
              File type
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? "Uploading…" : "＋ Add files"}
            </button>
            <span className="muted qp-hint">or drag &amp; drop here</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      )}

      {files.length === 0 ? (
        <div className="empty-hint">No quality-package files yet.</div>
      ) : (
        <div className="qp-groups">
          {byCat.map((g) => (
            <div key={g.cat} className="qp-group">
              <div className="qp-group-head">{g.cat} <span className="muted">({g.items.length})</span></div>
              {g.items.map((f) => (
                <div key={f.id} className="qp-file">
                  <span className="qp-file-name" title={f.name ?? ""}>{f.name ?? "(unnamed)"}</span>
                  <span className="qp-file-meta">{fmtSize(f.size)} · {f.uploaded_by ?? "—"} · {f.uploaded_at?.slice(0, 10)}</span>
                  <div className="spacer" />
                  {f.has_file && <button className="btn btn-sm" onClick={() => view(f)}>View</button>}
                  {editable && canDelete(f) && (
                    <button className="btn btn-sm btn-danger" title="Remove (uploader or admin)" onClick={() => setConfirmDel(f)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {confirmDel && (
        <ConfirmDialog
          title={`Remove ${confirmDel.name ?? "this file"}`}
          body="The file is removed from this work order's quality package. This cannot be undone."
          confirmLabel="Remove file"
          danger
          onConfirm={() => { const f = confirmDel; setConfirmDel(null); if (f) del(f); }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
