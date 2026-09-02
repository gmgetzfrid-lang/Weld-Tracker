import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { Drawing, ExceptionsSummary, Lookups, NdeLot, Weld, Welder, WoLotSummary } from "../types";
import { ConfirmDialog, ErrorBox, Modal, Spinner, num, useToast } from "../components/ui";
import { WeldTable } from "../components/WeldTable";
import { RecordNdeDialog, SingleWeldDialog } from "../components/WeldDialogs";
import { docName, RevisePanel, RevisionHistory, PackageIngest } from "../docControl";
import { QualityPackage } from "./QualityPackage";
import { isIncomplete } from "../incomplete";

type WoTab = "overview" | "drawings" | "welds" | "quality";

/**
 * One work order's whole world, under tabs: Overview (quality health from the
 * validation engine), Drawings (controlled isometrics), Welds (the grid),
 * Quality (evidence package). The user stays inside the work order — the
 * refinery's actual mental model — instead of bouncing between global pages.
 */
export function WorkOrderRecord({
  workOrder,
  welders,
  lookups,
  sizes,
  onOpenDrawing,
  onBack,
}: {
  workOrder: string;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onOpenDrawing: (drawingId: number | null) => void;
  onBack: () => void;
}) {
  const { can, user } = useAuth();
  const toast = useToast();
  const editable = can("editor");
  // Non-admins may delete only the drawings they created themselves.
  const canDeleteDrawing = (d: Drawing) =>
    user != null && (user.role === "admin" || d.created_by === user.username);
  const [tab, setTab] = useState<WoTab>("overview");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [welds, setWelds] = useState<Weld[]>([]);
  const [exc, setExc] = useState<ExceptionsSummary | null>(null);
  const [lotSum, setLotSum] = useState<WoLotSummary | null>(null);
  const [moveLot, setMoveLot] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revise, setRevise] = useState<Drawing | null>(null);
  const [history, setHistory] = useState<Drawing | null>(null);
  const [ingest, setIngest] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [ndeDialog, setNdeDialog] = useState(false);
  const [addWeldOpen, setAddWeldOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ kind: "wo" } | { kind: "drawing"; d: Drawing } | null>(null);
  // The work order's owner (its creator) or an admin may delete the whole thing.
  const canDeleteWo =
    user != null && (user.role === "admin" || (owner != null && owner === user.username));

  // Welds still missing attributes, and the drawing holding most of them (the
  // one the "need data" badge opens straight into).
  const incompleteWelds = welds.filter(isIncomplete);
  const incompleteDrawing: number | null = (() => {
    const tally = new Map<number, number>();
    for (const w of incompleteWelds) if (w.drawing_id != null) tally.set(w.drawing_id, (tally.get(w.drawing_id) ?? 0) + 1);
    let best: number | null = null, n = 0;
    for (const [id, c] of tally) if (c > n) { best = id; n = c; }
    return best;
  })();

  // Monotonic request token: only the NEWEST load may write state, so a slow
  // response can't overwrite a fresher one (rapid autosaves, or switching to
  // another work order while this component stays mounted).
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    Promise.all([
      api.listDrawingsForWo(workOrder),
      api.listWelds({ work_order: workOrder, limit: 2000 }),
    ])
      .then(([d, w]) => {
        if (seq !== loadSeq.current) return;
        setDrawings(d); setWelds(w); setError(null);
      })
      .catch((e) => { if (seq === loadSeq.current) setError(errMsg(e)); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
    api.workOrderOwner(workOrder)
      .then((o) => { if (seq === loadSeq.current) setOwner(o); })
      .catch((e) => { logErr("loading work-order owner")(e); if (seq === loadSeq.current) setOwner(null); });
    api.woLotSummary(workOrder)
      .then((x) => { if (seq === loadSeq.current) setLotSum(x); })
      .catch(logErr("loading lot summary"));
    api.weldExceptions(workOrder)
      .then((x) => { if (seq === loadSeq.current) setExc(x); })
      .catch(logErr("loading WO exceptions"));
  }, [workOrder]);
  useEffect(load, [load]);
  // Switching to a different WO while mounted: show a spinner, not the old
  // WO's records under the new header.
  useEffect(() => {
    setLoading(true); setExc(null); setTab("overview");
  }, [workOrder]);

  const runDelete = async (reason?: string) => {
    if (!confirmDel) return;
    const act = confirmDel;
    setConfirmDel(null);
    try {
      if (act.kind === "wo") {
        const [w, d] = await api.deleteWorkOrder(workOrder, reason ?? "");
        toast.push("ok", `Deleted ${workOrder}: ${w} weld(s), ${d} drawing(s)`);
        onBack();
      } else {
        await api.deleteDrawing(act.d.id);
        load();
      }
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const errorsN = exc?.errors ?? 0;
  const warningsN = exc?.warnings ?? 0;
  const openItems = exc?.welds.slice(0, 6) ?? [];

  const drawingsBody = (
    <>
      <div className="section-head">
        <h3>Isometric Drawings</h3>
        <span className="muted">click a drawing to open its weld map</span>
        <div className="spacer" />
        {editable && (
          <button className="btn btn-sm" title="Upload one compiled work-package book and split it into controlled sheets by page range" onClick={() => setIngest(true)}>📚 Ingest work package</button>
        )}
      </div>
      {drawings.length === 0 ? (
        <div className="empty-hint">
          No isometrics yet.{" "}
          {editable && <a onClick={() => onOpenDrawing(null)} className="link">Add the first one →</a>}
        </div>
      ) : (
        <div className="grid cols-3" style={{ marginBottom: 26 }}>
          {drawings.map((d) => (
            <div key={d.id} className="drawing-card" onClick={() => onOpenDrawing(d.id)}>
              <div className="drawing-card-top">
                <span className="drawing-ico">📐</span>
                <strong>{d.doc_name || docName(d.drawing_no, d.sheet_no, d.revision)}</strong>
                {d.has_pdf ? <span className="badge badge-green">PDF</span> : <span className="badge badge-gray">no PDF</span>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {d.revision
                  ? <span className="badge badge-blue" title="effective revision">Rev {d.revision}</span>
                  : <span className="badge badge-gray" title="No revision recorded — open the drawing and enter it from the title block">rev not set</span>}
                {(d.rev_count ?? 0) > 1 && <span className="badge badge-gray" title="revision history">{d.rev_count} revs</span>}
                <span>{d.line_spec ? `${d.line_spec} · ` : ""}{num(d.weld_count)} welds</span>
              </div>
              <div className="drawing-card-foot" onClick={(e) => e.stopPropagation()}>
                <span className="link" onClick={() => onOpenDrawing(d.id)}>Open weld map ›</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {editable && <button className="btn btn-sm" title="Issue a new revision (supersede current)" onClick={() => setRevise(d)}>Revise</button>}
                  {(d.rev_count ?? 0) > 1 && <button className="btn btn-sm btn-ghost" title="Revision history" onClick={() => setHistory(d)}>History</button>}
                  {editable && canDeleteDrawing(d) && (
                    <button className="btn btn-sm btn-ghost-danger" title="Delete drawing" onClick={() => setConfirmDel({ kind: "drawing", d })}>✕</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const weldsBody = (
    <>
      <div className="section-head">
        <h3>Welds on this work order</h3>
        <div className="spacer" />
        {editable && welds.length > 0 && (
          <button className="btn btn-sm" title="Record one NDE report's results across several welds at once" onClick={() => setNdeDialog(true)}>
            📋 Record NDE results
          </button>
        )}
      </div>
      <WeldTable
        welds={welds}
        welders={welders}
        lookups={lookups}
        sizes={sizes}
        editable={editable}
        onChanged={load}
        onAddWeld={() => setAddWeldOpen(true)}
      />
    </>
  );

  return (
    <div>
      <div className="wo-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div className="wo-header-title">
          <div className="wo-eyebrow">Work Order</div>
          <h2>{workOrder}</h2>
        </div>
        <span className="badge badge-blue">{num(drawings.length)} drawings</span>
        <span className="badge badge-gray">{num(welds.length)} welds</span>
        {errorsN > 0 && <span className="badge badge-red" title="Validation errors on this work order — see Overview">{num(errorsN)} errors</span>}
        {incompleteWelds.length > 0 && (
          <button className="badge badge-amber" style={{ border: 0, cursor: "pointer" }} title="Welds still missing attributes — open the drawing and use Fill attributes"
            onClick={() => onOpenDrawing(incompleteDrawing)}>
            {num(incompleteWelds.length)} need data
          </button>
        )}
        <div className="spacer" />
        {editable && (
          <button className="btn btn-accent" onClick={() => onOpenDrawing(null)}>＋ Add Drawing &amp; Welds</button>
        )}
        {(editable || canDeleteWo) && (
          <div className="wo-more">
            <button className="btn btn-sm" onClick={() => setMoreOpen((v) => !v)} title="More actions">⋯</button>
            {moreOpen && (
              <div className="wo-more-menu" onMouseLeave={() => setMoreOpen(false)}>
                {editable && (
                  <button onClick={() => { setMoreOpen(false); setIngest(true); }}>📚 Ingest work package</button>
                )}
                {editable && (
                  <button onClick={() => { setMoreOpen(false); setNdeDialog(true); }}>📋 Record NDE results</button>
                )}
                {editable && lotSum?.enabled && (
                  <button onClick={() => { setMoreOpen(false); setMoveLot(true); }}>▦ Move to NDE lot…</button>
                )}
                {canDeleteWo && (
                  <button className="danger" onClick={() => { setMoreOpen(false); setConfirmDel({ kind: "wo" }); }}>
                    🗑 Delete work order
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {lotSum?.enabled && (
        <div className={`wo-lot-banner ${lotSum.total_owed_here > 0 ? "owed" : ""}`}>
          <span className="wo-lot-chips">
            {lotSum.lots.length === 0 && <span className="muted">Not in an NDE lot yet</span>}
            {lotSum.lots.map((l) => (
              <span key={l.lot_id} className={`lot-chip ${l.status.toLowerCase()}`} title={`${num(l.weld_count)} welds of this work order are in ${l.lot_no}`}>
                {l.lot_no} · {num(l.weld_count)}
              </span>
            ))}
            {lotSum.pinned_lot_id != null && <span className="badge badge-blue" title="New welds on this work order go to the pinned lot">pinned</span>}
          </span>
          {lotSum.total_owed_here > 0 ? (
            <>
              <span>
                <b>{num(lotSum.total_owed_here)} NDE examination{lotSum.total_owed_here === 1 ? "" : "s"} can be shot on this work order</b>
                <span className="muted"> — {lotSum.owed.map((o) => `${o.name || o.stamp} ${o.spec}: ${num(o.owed)} owed, ${num(o.candidates_here)} candidate${o.candidates_here === 1 ? "" : "s"} here (${o.lot_no})`).join(" · ")}</span>
              </span>
              <div className="spacer" />
              {editable && <button className="btn btn-sm btn-accent" onClick={() => setNdeDialog(true)}>📋 Record NDE results</button>}
            </>
          ) : (
            <span className="muted">No NDE owed on this work order right now</span>
          )}
        </div>
      )}

      <div className="wo-tabs">
        {([
          ["overview", "Overview"],
          ["drawings", `Drawings (${drawings.length})`],
          ["welds", `Welds (${welds.length})`],
          ["quality", "Quality package"],
        ] as [WoTab, string][]).map(([k, label]) => (
          <button key={k} className={`wo-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <ErrorBox message={error} />
      {loading ? (
        <Spinner />
      ) : tab === "overview" ? (
        <>
          <div className="exc-tiles">
            <button className={`exc-tile sev-error ${errorsN ? "" : "quiet"}`} onClick={() => setTab("welds")}
              title="Validation errors on this work order's welds">
              <span className="exc-num">{num(errorsN)}</span>
              <span className="exc-cap">Errors</span>
            </button>
            <button className={`exc-tile sev-warning ${warningsN ? "" : "quiet"}`} onClick={() => setTab("welds")}
              title="Warnings — below-spec NDE, missing fields, PWHT/PMI owed">
              <span className="exc-num">{num(warningsN)}</span>
              <span className="exc-cap">Warnings</span>
            </button>
            <button className="exc-tile" onClick={() => setTab("welds")}>
              <span className="exc-num">{num(exc?.flagged ?? 0)}</span>
              <span className="exc-cap">Flagged welds</span>
              <span className="exc-sub">of {num(exc?.population ?? welds.length)}</span>
            </button>
            <button className="exc-tile" onClick={() => setTab("drawings")}>
              <span className="exc-num">{num(drawings.length)}</span>
              <span className="exc-cap">Drawings</span>
            </button>
          </div>

          {incompleteWelds.length > 0 && (
            <div className="lot-banner warn" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span>
                  <b>{num(incompleteWelds.length)} weld{incompleteWelds.length === 1 ? "" : "s"} still missing attributes</b>
                  <span className="muted"> — welder, date, size, joint or NDE not filled in. They stay flagged here and on the dashboard until they are.</span>
                </span>
                <div className="spacer" />
                {editable && incompleteDrawing != null && (
                  <button className="btn btn-sm btn-accent" onClick={() => onOpenDrawing(incompleteDrawing)}>▶ Fill attributes</button>
                )}
              </div>
            </div>
          )}
          {openItems.length > 0 ? (
            <div className="card card-pad" style={{ marginTop: 14 }}>
              <h3>Open items</h3>
              <div className="exc-list" style={{ marginTop: 8 }}>
                {openItems.map((w) => (
                  <div key={w.weld_id} className={`exc-row sev-${w.severity}`}>
                    <div className="exc-row-head">
                      <span className={`exc-dot sev-${w.severity}`} />
                      <span className="exc-weld">{w.weld_number ?? `#${w.weld_id}`}</span>
                      {w.drawing_no && <span className="muted">· {w.drawing_no}</span>}
                      {w.stamp_number && <span className="muted">· {w.stamp_number}</span>}
                    </div>
                    <ul className="exc-findings">
                      {w.findings.map((f, i) => <li key={i} className={`sev-${f.severity}`}>{f.message}</li>)}
                    </ul>
                  </div>
                ))}
                {(exc?.flagged ?? 0) > openItems.length && (
                  <div className="muted" style={{ padding: "4px 2px", fontSize: 12 }}>
                    +{(exc?.flagged ?? 0) - openItems.length} more — see the Welds tab
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card card-pad" style={{ marginTop: 14, textAlign: "center" }}>
              <div style={{ fontSize: 30 }}>✓</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>No open quality items</div>
              <div className="muted">Every weld on this work order passes validation.</div>
            </div>
          )}
        </>
      ) : tab === "drawings" ? (
        drawingsBody
      ) : tab === "welds" ? (
        weldsBody
      ) : (
        <QualityPackage workOrder={workOrder} />
      )}

      {revise && (
        <RevisePanel
          drawing={revise}
          onClose={() => setRevise(null)}
          onDone={() => { setRevise(null); load(); }}
        />
      )}
      {history && (
        <RevisionHistory drawing={history} onClose={() => setHistory(null)} />
      )}
      {ingest && (
        <PackageIngest
          workOrder={workOrder}
          onClose={() => setIngest(false)}
          onDone={() => { setIngest(false); load(); }}
        />
      )}
      {ndeDialog && (
        <RecordNdeDialog
          welds={welds}
          onClose={() => setNdeDialog(false)}
          onDone={() => { setNdeDialog(false); load(); }}
        />
      )}
      {moveLot && (
        <MoveToLotDialog
          workOrder={workOrder}
          current={lotSum}
          onClose={() => setMoveLot(false)}
          onDone={() => { setMoveLot(false); load(); }}
        />
      )}
      {addWeldOpen && (
        <SingleWeldDialog
          workOrder={workOrder}
          welders={welders}
          lookups={lookups}
          sizes={sizes}
          onClose={() => setAddWeldOpen(false)}
          onCreated={() => { setAddWeldOpen(false); load(); }}
        />
      )}
      {confirmDel && (confirmDel.kind === "wo" ? (
        <ConfirmDialog
          title={`Delete work order ${workOrder}`}
          body={`This permanently deletes ALL of it — ${drawings.length} drawing(s) and ${welds.length} weld(s) — and cannot be undone. Voiding individual welds keeps records; this does not.`}
          confirmLabel="Delete everything"
          danger
          requireReason
          reasonLabel="Reason for deleting this work order"
          onConfirm={(reason) => runDelete(reason)}
          onClose={() => setConfirmDel(null)}
        />
      ) : (
        <ConfirmDialog
          title={`Delete drawing ${confirmDel.d.drawing_no ?? confirmDel.d.id}`}
          body="The drawing and its revision history are removed; its welds are kept on the work order."
          confirmLabel="Delete drawing"
          danger
          onConfirm={() => runDelete()}
          onClose={() => setConfirmDel(null)}
        />
      ))}
    </div>
  );
}


/** Move this work order's welds into another lot, optionally pinning it there. */
function MoveToLotDialog({
  workOrder, current, onClose, onDone,
}: {
  workOrder: string;
  current: WoLotSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [lots, setLots] = useState<NdeLot[] | null>(null);
  const [lotId, setLotId] = useState<number | null>(null);
  const [pin, setPin] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.listLots()
      .then((ls) => {
        const open = ls.filter((l) => l.status !== "Closed");
        setLots(open);
        setLotId(open.find((l) => l.is_default)?.id ?? open[0]?.id ?? null);
      })
      .catch(logErr("loading lots"));
  }, []);
  const target = lots?.find((l) => l.id === lotId) ?? null;
  const canPin = target?.status === "Open";
  const go = async () => {
    if (lotId == null) return;
    setBusy(true);
    try {
      const moved = pin && canPin
        ? await api.pinWorkOrder(workOrder, lotId)
        : await api.moveWorkOrderToLot(workOrder, lotId);
      toast.push("ok", `${num(moved)} weld${moved === 1 ? "" : "s"} moved to ${target?.lot_no ?? "the lot"}${pin && canPin ? " · work order pinned" : ""}`);
      onDone();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  const unpin = async () => {
    setBusy(true);
    try { await api.unpinWorkOrder(workOrder); toast.push("ok", "Work order unpinned — new welds follow the receiving lot"); onDone(); }
    catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Move ${workOrder} to an NDE lot`} onClose={onClose}
      footer={
        <>
          {current?.pinned_lot_id != null && <button className="btn" disabled={busy} onClick={unpin}>Unpin</button>}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || lotId == null} onClick={go}>{busy ? "Moving…" : "Move"}</button>
        </>
      }>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Every live weld on this work order moves into the chosen lot. Welds already frozen in a closed lot stay where they are.
      </p>
      {lots == null ? <Spinner /> : lots.length === 0 ? <p className="muted">No open lots.</p> : (
        <>
          <div className="field">
            <label>Lot</label>
            <select value={lotId ?? ""} onChange={(e) => setLotId(Number(e.target.value))}>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_no}{l.label ? ` · ${l.label}` : ""} — {l.is_default ? "receiving" : l.status === "Open" ? "open" : "awaiting closeout"} · {num(l.weld_count)} welds
                </option>
              ))}
            </select>
          </div>
          <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={pin && canPin} disabled={!canPin} onChange={(e) => setPin(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <b>Pin the work order here.</b> New welds on it go to this lot too, not the receiving lot.
              {!canPin && <span className="muted"> (Only an Open lot can be pinned to — this one no longer takes new welds.)</span>}
            </span>
          </label>
        </>
      )}
    </Modal>
  );
}
