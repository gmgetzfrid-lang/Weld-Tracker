import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type {
  AttentionItem, LotCard, LotConfig, LotWoChoice, NdeLot, PerformanceRow, SuggestedExam,
} from "../types";
import { ConfirmDialog, ErrorBox, Modal, Spinner, StatCard, downloadCsv, num, pct, useToast } from "../components/ui";
import { AttentionList, LotProgress, LotStatusChip, fmtD, weldSpan } from "../components/lots";
import { downloadLotPdf, openLotPdf } from "../lotPdf";
import { Icon } from "../components/Icon";

const MONTH_CHOICES = [1, 2, 3, 4, 6, 12];

/**
 * NDE Lots — the ASME B31.3 populations each welder's random-examination
 * percentage (and progressive sampling) is judged in. Lots open, fill,
 * turn over and close on their own; this page is where the shop sees where
 * every lot stands and closes the loop on what's owed.
 */
export function Lots({
  onOpenWorkOrder,
  initialLotId,
  onConsumedInitial,
}: {
  onOpenWorkOrder: (wo: string) => void;
  initialLotId?: number | null;
  onConsumedInitial?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [cfg, setCfg] = useState<LotConfig | null>(null);
  const [lots, setLots] = useState<NdeLot[] | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newLotOpen, setNewLotOpen] = useState(false);
  const [confirmTurn, setConfirmTurn] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([api.lotConfig(), api.listLots(), api.lotAttention()])
        .then(([c, l, a]) => { setCfg(c); setLots(l); setAttention(a); setError(null); })
        .catch((e) => setError(errMsg(e))),
    [],
  );
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (initialLotId != null) { setSel(initialLotId); onConsumedInitial?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLotId]);

  if (error) return <ErrorBox message={error} />;
  if (!cfg || !lots) return <Spinner />;

  if (!cfg.setup_done || !cfg.enabled) {
    return (
      <LotsSetup
        cfg={cfg}
        canAdmin={can("admin")}
        onDone={load}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
      />
    );
  }

  if (sel != null) {
    return (
      <LotDetail
        id={sel}
        onBack={() => { setSel(null); load(); }}
        onOpenWorkOrder={onOpenWorkOrder}
        onChanged={load}
      />
    );
  }

  const receiving = lots.find((l) => l.is_default) ?? null;
  const turnOver = async () => {
    setBusy(true);
    try {
      const [old, fresh] = await api.turnOverLot(null);
      toast.push("ok", `${fresh.lot_no} is now receiving welds${old ? ` · ${old.lot_no} is awaiting closeout` : ""}`);
      setConfirmTurn(false);
      await load();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="toolbar" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {cfg.target_months}-month lots · {cfg.auto_rollover ? "roll over automatically" : "you're asked at turnover"} · numbered {cfg.prefix}-YYYY-NN
            {receiving && <> · <b>{receiving.lot_no}</b> is receiving welds</>}
          </div>
        </div>
        <div className="spacer" />
        {can("editor") && receiving && (
          <button className="btn" onClick={() => setConfirmTurn(true)} title="Stop this lot taking welds and open the next one">⟳ Turn over now</button>
        )}
        {can("editor") && <button className="btn" onClick={() => setNewLotOpen(true)}><Icon name="plus" size={14} stroke={2.25} /> New lot</button>}
        {can("admin") && <button className="btn" onClick={() => setSettingsOpen(true)}><Icon name="sliders" size={14} /> Lot settings</button>}
      </div>

      {attention.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Needs attention</h3>
          <AttentionList items={attention} onOpenLot={(id) => id != null && setSel(id)} onOpenWorkOrder={onOpenWorkOrder} />
        </div>
      )}

      <div className="lot-grid">
        {lots.map((l) => <LotTile key={l.id} lot={l} onClick={() => setSel(l.id)} />)}
      </div>

      {confirmTurn && receiving && (
        <ConfirmDialog
          title={`Turn over ${receiving.lot_no}?`}
          body={
            <>
              {receiving.lot_no} stops taking welds and moves to <b>Awaiting closeout</b>; a new lot opens and receives everything from now on.
              Film for {receiving.lot_no} can still be recorded — it closes itself once every welder's coverage is met.
              {receiving.work_order_count > 0 && (
                <> Work orders still active will carry on in the new lot (a work order may span two lots).</>
              )}
            </>
          }
          confirmLabel={busy ? "Turning over…" : "Turn over"}
          onConfirm={turnOver}
          onClose={() => setConfirmTurn(false)}
        />
      )}
      {newLotOpen && <NewLotDialog onClose={() => setNewLotOpen(false)} onDone={() => { setNewLotOpen(false); load(); }} />}
      {settingsOpen && <LotSettingsModal cfg={cfg} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />}
    </div>
  );
}

function LotTile({ lot: l, onClick }: { lot: NdeLot; onClick: () => void }) {
  return (
    <button className={`lot-tile status-${l.status.toLowerCase()} ${l.is_default ? "receiving" : ""}`} onClick={onClick}>
      <div className="lot-tile-head">
        <span className="lot-no">{l.lot_no}</span>
        <LotStatusChip lot={l} />
      </div>
      {l.label && <div className="lot-label">{l.label}</div>}
      {l.status === "Open" && <LotProgress lot={l} />}
      <div className="lot-tile-dates">
        {l.status === "Open"
          ? <>Opened {fmtD(l.opened_on)} · day {num(l.age_days)} of {num(l.target_days)}{l.overdue_days > 0 && <span className="warn"> · {num(l.overdue_days)} over</span>}</>
          : l.status === "Closing"
            ? <>Stopped taking welds {fmtD(l.closing_on)} · ran {num(l.age_days)} days</>
            : <>Closed {fmtD(l.closed_on)} · ran {num(l.age_days)} days</>}
      </div>
      <div className="lot-tile-facts">
        <span><b>{num(l.weld_count)}</b> welds</span>
        <span><b>{num(l.weld_inches, 1)}</b> in</span>
        <span><b>{num(l.welder_count)}</b> welders</span>
        <span><b>{num(l.work_order_count)}</b> WOs</span>
      </div>
      <div className="lot-tile-foot">
        {l.owed > 0
          ? <span className="badge badge-amber">{num(l.owed)} NDE owed</span>
          : l.weld_count > 0 && <span className="badge badge-green">Coverage met</span>}
        {l.unresolved > 0 && <span className="badge badge-red">{num(l.unresolved)} unresolved</span>}
        {l.status === "Closed" && (l.closed_short
          ? <span className="badge badge-red">Closed short</span>
          : <span className="badge badge-green">Closed clean</span>)}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

type Dialog = null | "turn" | "stop" | "close" | "closeShort" | "reopen" | "pin" | "notes";

function LotDetail({
  id, onBack, onOpenWorkOrder, onChanged,
}: {
  id: number;
  onBack: () => void;
  onOpenWorkOrder: (wo: string) => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [card, setCard] = useState<LotCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [suggest, setSuggest] = useState<SuggestedExam[] | null>(null);
  const [suggestStamp, setSuggestStamp] = useState("");
  const [company, setCompany] = useState("SENTRIX");
  const editor = can("editor");

  const load = useCallback(
    () => api.getLotCard(id).then((c) => { setCard(c); setError(null); }).catch((e) => setError(errMsg(e))),
    [id],
  );
  useEffect(() => {
    load();
    api.getSettings().then((s) => setCompany(s.company_name || s.app_title || "SENTRIX")).catch(() => {});
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast.push("ok", done);
      setDialog(null);
      setSuggest(null);
      await load();
      onChanged();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(null); }
  };

  if (error) return <div><button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> All lots</button><ErrorBox message={error} /></div>;
  if (!card) return <Spinner />;
  const lot = card.lot;
  const rep = card.report;
  const owedRows = rep.rows.flatMap((r) => r.specs.filter((s) => s.shortfall > 0).map((s) => ({ r, s })));
  const snapshot = parseSnapshot(lot.shortfall_snapshot);
  const spanNote = card.spanning_work_orders > 0
    ? `${num(card.spanning_work_orders)} also in other lots`
    : undefined;

  const exportCsv = () => {
    const header = ["Lot", "Welder", "Stamp", "Welds", "Weld Inches", "Spec", "Population", "Required", "Examined", "Actual %", "Owed", "Sampling", "Verdict"];
    const rows = rep.rows.flatMap((r) =>
      (r.specs.length ? r.specs : [null]).map((s) => [
        lot.lot_no, r.name, r.stamp, r.weld_count, r.weld_inches.toFixed(1),
        s?.spec ?? "—", s?.population ?? "", s?.required ?? "", s?.examined ?? "",
        s ? s.actual_pct.toFixed(0) + "%" : "", s?.shortfall ?? "", s?.sampling_level ?? "",
        s ? (s.compliant ? "MET" : "OWED") : "—",
      ]),
    );
    downloadCsv(`nde-lot-${lot.lot_no}.csv`, [header, ...rows]);
  };
  const pdf = async (open: boolean) => {
    setBusy("pdf");
    try {
      const path = open ? await openLotPdf(card, company) : await downloadLotPdf(card, company);
      toast.push("ok", `${open ? "Opened" : "Saved"} ${path}`);
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(null); }
  };
  const doSuggest = async () => {
    setBusy("suggest");
    try { setSuggest(await api.suggestExaminations(lot.id, suggestStamp || null)); }
    catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(null); }
  };
  const suggestCsv = () => {
    if (!suggest) return;
    const header = ["Lot", "Weld", "Work Order", "Drawing", "Welder", "Stamp", "Spec", "Joint", "NPS", "Welded", "Method", "Why"];
    downloadCsv(`rt-request-${lot.lot_no}.csv`, [header, ...suggest.map((x) => [
      lot.lot_no, x.weld_number ?? "", x.work_order ?? "", x.drawing_no ?? "", x.name, x.stamp, x.spec,
      x.joint_type ?? "", x.size ?? "", x.date_welded ?? "", x.required_nde_method ?? "", x.reason,
    ])]);
  };

  return (
    <div>
      <div className="wo-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> All lots</button>
        <div className="wo-header-title">
          <div className="wo-eyebrow">NDE Lot</div>
          <h2>{lot.lot_no}{lot.label && <span className="lot-h-label"> · {lot.label}</span>}</h2>
        </div>
        <LotStatusChip lot={lot} />
        <div className="spacer" />
        {editor && lot.status === "Open" && lot.is_default && (
          <button className="btn" onClick={() => setDialog("turn")}><Icon name="refresh" size={14} /> Turn over</button>
        )}
        {editor && lot.status === "Open" && !lot.is_default && (
          <button className="btn" onClick={() => setDialog("stop")}><Icon name="square" size={12} /> Stop taking welds</button>
        )}
        {editor && lot.status !== "Closed" && (
          <button className={`btn ${card.clean ? "btn-primary" : ""}`} onClick={() => setDialog(card.clean ? "close" : "closeShort")}>
            <Icon name="check" size={14} /> Close lot
          </button>
        )}
        {can("admin") && lot.status === "Closed" && (
          <button className="btn" onClick={() => setDialog("reopen")}><Icon name="rotateCcw" size={14} /> Reopen</button>
        )}
        {editor && lot.status !== "Closed" && (
          <button className="btn" onClick={() => setDialog("pin")}>{lot.status === "Open" ? <><Icon name="pin" size={14} /> Pin work orders…</> : <><Icon name="arrowRight" size={14} /> Move work orders in…</>}</button>
        )}
        {editor && <button className="btn btn-icon" title="Label and notes" aria-label="Label and notes" onClick={() => setDialog("notes")}><Icon name="pencil" size={14} /></button>}
        <button className="btn" onClick={exportCsv}><Icon name="download" size={14} /> CSV</button>
        <button className="btn" onClick={() => pdf(true)} disabled={busy === "pdf"}><Icon name="printer" size={14} /> Open / Print</button>
        <button className="btn btn-accent" onClick={() => pdf(false)} disabled={busy === "pdf"}><Icon name="download" size={14} /> Closeout PDF</button>
      </div>

      {/* Status banner */}
      {lot.status === "Closed" ? (
        lot.closed_short ? (
          <div className="lot-banner danger">
            <div><b>Closed short</b> on {fmtD(lot.closed_on)} by {lot.closed_by ?? "?"} — {lot.close_reason}</div>
            {snapshot && (
              <div className="muted" style={{ fontSize: 12.5 }}>
                At close: {num(snapshot.owed)} examination{snapshot.owed === 1 ? "" : "s"} owed
                {snapshot.unresolved ? `, ${num(snapshot.unresolved)} unresolved` : ""} —{" "}
                {snapshot.welders.map((w) => `${w.name || w.stamp} ${w.spec}: ${w.owed}`).join(" · ")}
              </div>
            )}
          </div>
        ) : (
          <div className="lot-banner ok"><b>Closed clean</b> on {fmtD(lot.closed_on)} by {lot.closed_by ?? "?"} — every welder met coverage.</div>
        )
      ) : lot.status === "Closing" ? (
        card.clean ? (
          <div className="lot-banner ok">
            <b>Coverage complete.</b> Nothing owed and nothing unresolved — this lot closes itself on the next check{editor && <>, or <button className="link" onClick={() => setDialog("close")}>close it now</button></>}.
          </div>
        ) : (
          <div className={`lot-banner ${card.unresolved ? "danger" : "warn"}`}>
            <b>Awaiting closeout.</b> Stopped taking welds {fmtD(lot.closing_on)} · {num(card.owed)} examination{card.owed === 1 ? "" : "s"} owed
            {card.unresolved > 0 && <> · {num(card.unresolved)} weld{card.unresolved === 1 ? "" : "s"} can't be scored (fix their Table 4 drivers)</>}.
            Record the NDE below and it closes on its own.
          </div>
        )
      ) : (
        <div className={`lot-banner ${lot.overdue_days > 0 ? "warn" : "info"}`}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              <b>{lot.is_default ? "Receiving welds" : "Open"}</b> since {fmtD(lot.opened_on)} · day {num(lot.age_days)} of {num(lot.target_days)}
              {lot.overdue_days > 0 && <> · <b>{num(lot.overdue_days)} days past the expected length — time to turn over</b></>}
            </span>
            <span style={{ flex: 1, minWidth: 160 }}><LotProgress lot={lot} /></span>
          </div>
        </div>
      )}
      {lot.notes && <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{lot.notes}</p>}

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <StatCard label="Welds" value={num(lot.weld_count)} sub={`${num(lot.weld_inches, 1)} weld inches`} />
        <StatCard
          label="Examined"
          value={num(lot.examined)}
          sub={card.nde_by_type.length ? card.nde_by_type.map((t) => `${t.method} ${num(t.count)}`).join(" · ") : "no NDE recorded yet"}
        />
        <StatCard label="Rejects" value={num(lot.rejects)} sub={`${pct(lot.examined ? lot.rejects / lot.examined : 0)} of examined`} />
        <StatCard
          label="NDE owed"
          value={<span style={{ color: card.owed ? "var(--warn)" : "var(--ok)" }}>{num(card.owed)}</span>}
          sub={card.owed ? `${owedRows.length} welder/spec line${owedRows.length === 1 ? "" : "s"} short` : lot.weld_count ? "every welder at or above spec" : "—"}
        />
        <StatCard label="Welders" value={num(lot.welder_count)} />
        <StatCard label="Work orders" value={num(lot.work_order_count)} sub={spanNote} />
        <StatCard
          label="Unresolved"
          value={<span style={{ color: card.unresolved ? "var(--danger)" : undefined }}>{num(card.unresolved)}</span>}
          sub={card.unresolved ? "required % unknown — blocks a clean close" : "all requirements resolved"}
        />
        <StatCard
          label="Weld dates"
          value={<span style={{ fontSize: 15 }}>{lot.first_weld ? `${fmtD(lot.first_weld)} → ${fmtD(lot.last_weld ?? lot.first_weld)}` : "—"}</span>}
          sub={lot.first_weld ? weldSpan(lot).split(" · ").pop() : "no welds yet"}
        />
      </div>

      {/* Welders */}
      <div className="section-head">
        <h3>Welders in this lot</h3>
        <span className="muted">Required includes B31.3 progressive sampling: a reject adds two more of that welder's welds here, a second adds two more, a third means all of them.</span>
      </div>
      <div className="table-wrap" style={{ marginBottom: 22 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Welder</th><th>Stamp</th><th className="num">Welds</th><th className="num">Inches</th>
              <th>Spec</th><th className="num">Welds</th><th className="num">Required</th><th className="num">Examined</th>
              <th className="num">Actual</th><th className="num">Owed</th><th>Sampling</th><th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rep.rows.length === 0 && <tr><td colSpan={12} className="table-empty">No welds with a welder in this lot yet.</td></tr>}
            {rep.rows.map((r) => <WelderRows key={r.stamp} r={r} />)}
          </tbody>
        </table>
      </div>

      {/* Suggest */}
      {lot.status !== "Closed" && (
        <div className="card card-pad" style={{ marginBottom: 22 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>Welds to shoot</h3>
              <div className="muted" style={{ fontSize: 12 }}>Random picks from each welder's un-examined welds to cover what's owed. A helper, not a cage — re-roll anytime.</div>
            </div>
            <div className="spacer" />
            <div className="field" style={{ margin: 0 }}>
              <select value={suggestStamp} onChange={(e) => setSuggestStamp(e.target.value)}>
                <option value="">Every welder short</option>
                {rep.rows.filter((r) => !r.in_spec).map((r) => <option key={r.stamp} value={r.stamp}>{r.name || r.stamp} · {r.stamp}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={doSuggest} disabled={busy === "suggest" || card.owed === 0}>
              {busy === "suggest" ? "Picking…" : suggest ? <><Icon name="shuffle" size={14} /> Re-roll</> : <><Icon name="shuffle" size={14} /> Suggest welds</>}
            </button>
            {suggest && suggest.length > 0 && <button className="btn" onClick={suggestCsv}><Icon name="download" size={14} /> RT request list</button>}
          </div>
          {card.owed === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing owed — no picks needed.</p>
          ) : suggest == null ? null : suggest.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No un-examined welds with a resolved requirement to pick from.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Weld</th><th>Work order</th><th>Drawing</th><th>Welder</th><th>Spec</th><th>Joint</th><th className="num">NPS</th><th>Welded</th><th>Method</th><th>Why</th></tr></thead>
                <tbody>
                  {suggest.map((x) => (
                    <tr key={x.weld_id}>
                      <td style={{ fontWeight: 600 }}>{x.weld_number ?? `#${x.weld_id}`}</td>
                      <td>{x.work_order ? <button className="link" onClick={() => onOpenWorkOrder(x.work_order!)}>{x.work_order}</button> : "—"}</td>
                      <td className="faint">{x.drawing_no ?? "—"}</td>
                      <td>{x.name || x.stamp} <span className="faint">{x.stamp}</span></td>
                      <td>{x.spec}</td>
                      <td>{x.joint_type ?? "—"}</td>
                      <td className="num">{x.size ?? "—"}</td>
                      <td className="faint">{fmtD(x.date_welded)}</td>
                      <td className="faint">{x.required_nde_method ?? "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{x.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Work orders */}
      <div className="section-head"><h3>Work orders in this lot</h3>{spanNote && <span className="muted">{spanNote} — a job that crossed a turnover</span>}</div>
      <div className="table-wrap" style={{ marginBottom: 22 }}>
        <table className="data">
          <thead><tr><th>Work order</th><th className="num">Welds</th><th className="num">Inches</th><th className="num">Examined</th><th className="num">Rejects</th><th>Weld dates</th><th>Welders</th><th></th></tr></thead>
          <tbody>
            {card.work_orders.length === 0 && <tr><td colSpan={8} className="table-empty">No welds in this lot yet.</td></tr>}
            {card.work_orders.map((w) => (
              <tr key={w.work_order}>
                <td style={{ fontWeight: 600 }}><button className="link" onClick={() => onOpenWorkOrder(w.work_order)}>{w.work_order}</button></td>
                <td className="num">{num(w.weld_count)}</td>
                <td className="num">{num(w.weld_inches, 1)}</td>
                <td className="num">{num(w.examined)}</td>
                <td className="num">{num(w.rejects)}</td>
                <td className="faint">{weldSpan(w)}</td>
                <td className="faint">{w.welders || "—"}</td>
                <td>{w.spans_other_lots && <span className="badge badge-gray" title="This work order also has welds in another lot">spans lots</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Record */}
      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>Lot record</h3>
        <div className="lot-record">
          <div><span className="muted">Opened</span><b>{fmtD(lot.opened_on)}</b><span className="faint">by {lot.created_by ?? "system"}</span></div>
          <div><span className="muted">Expected length</span><b>{num(lot.target_days)} days</b><span className="faint">due {fmtD(lot.due_on)}</span></div>
          <div><span className="muted">Stopped taking welds</span><b>{fmtD(lot.closing_on)}</b></div>
          <div><span className="muted">Closed</span><b>{fmtD(lot.closed_on)}</b>{lot.closed_by && <span className="faint">by {lot.closed_by}</span>}</div>
          {lot.close_reason && <div><span className="muted">Reason</span><b>{lot.close_reason}</b></div>}
          <div><span className="muted">Generated</span><b>{card.generated_on}</b></div>
        </div>
      </div>

      {/* Dialogs */}
      {dialog === "turn" && (
        <ConfirmDialog
          title={`Turn over ${lot.lot_no}?`}
          body={<>It stops taking welds and moves to <b>Awaiting closeout</b>; a new lot opens and receives everything from now on. Film for this lot can still be recorded — it closes itself once coverage is met.{card.work_orders.length > 0 && <> Active work orders carry on in the new lot.</>}</>}
          confirmLabel={busy ? "Turning over…" : "Turn over"}
          onConfirm={() => run("turn", async () => {
            const [, fresh] = await api.turnOverLot(null);
            toast.push("ok", `${fresh.lot_no} is now receiving welds`);
          }, `${lot.lot_no} is awaiting closeout`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "stop" && (
        <ConfirmDialog
          title={`Stop ${lot.lot_no} taking welds?`}
          body="New welds on its pinned work orders will go to the receiving lot instead. NDE results can still be recorded here until it closes."
          confirmLabel={busy ? "Stopping…" : "Stop taking welds"}
          onConfirm={() => run("stop", () => api.stopLotIntake(lot.id), `${lot.lot_no} is awaiting closeout`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "close" && (
        <ConfirmDialog
          title={`Close ${lot.lot_no} clean?`}
          body={<>Every welder met their coverage and nothing is unresolved. The lot becomes a frozen record: {num(lot.weld_count)} welds, {num(lot.examined)} examined, {num(lot.rejects)} rejected.{lot.is_default && <> Since this is the receiving lot, it is turned over first so new welds have somewhere to go.</>}</>}
          confirmLabel={busy ? "Closing…" : "Close lot"}
          onConfirm={() => run("close", () => api.closeLot(lot.id, null, false), `${lot.lot_no} closed clean`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "closeShort" && (
        <ConfirmDialog
          title={`Close ${lot.lot_no} short?`}
          danger
          requireReason
          reasonLabel="Why is this lot closing with NDE owed?"
          body={
            <>
              <b>Strongly discouraged.</b> {num(card.owed)} examination{card.owed === 1 ? "" : "s"} still owed
              {card.unresolved > 0 && <> and {num(card.unresolved)} weld{card.unresolved === 1 ? "" : "s"} can't be scored</>}.
              The shortfall is frozen onto the lot record and stays visible forever:
              <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                {owedRows.map(({ r, s }) => <li key={r.stamp + s.spec}>{r.name || r.stamp} · {s.spec}: {num(s.shortfall)} owed ({num(s.examined)} of {num(s.required)} required{s.progressive_extra ? `, ${s.sampling_level}` : ""})</li>)}
              </ul>
              The better path is to record the outstanding NDE — use <i>Welds to shoot</i> to pick them.
            </>
          }
          confirmLabel={busy ? "Closing…" : "Close short anyway"}
          onConfirm={(reason) => run("close", () => api.closeLot(lot.id, reason ?? "", true), `${lot.lot_no} closed short — recorded`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "reopen" && (
        <ConfirmDialog
          title={`Reopen ${lot.lot_no}?`}
          requireReason
          reasonLabel="Why is this lot being reopened?"
          body="It comes back as Awaiting closeout: NDE results can be recorded and work orders moved in, but it will not receive new welds. The reopening is written to the audit trail."
          confirmLabel={busy ? "Reopening…" : "Reopen"}
          onConfirm={(reason) => run("reopen", () => api.reopenLot(lot.id, reason ?? ""), `${lot.lot_no} reopened`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "pin" && (
        <PinDialog lot={lot} mode={lot.status === "Open" ? "pin" : "move"} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); onChanged(); }} />
      )}
      {dialog === "notes" && (
        <NotesDialog lot={lot} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); onChanged(); }} />
      )}
    </div>
  );
}

function WelderRows({ r }: { r: PerformanceRow }) {
  const owed = r.specs.reduce((a, s) => a + s.shortfall, 0);
  const specs = r.specs.length ? r.specs : [null];
  return (
    <>
      {specs.map((s, i) => (
        <tr key={s?.spec ?? "none"} className={i > 0 ? "lot-cont" : ""}>
          {i === 0 && (
            <>
              <td rowSpan={specs.length} style={{ fontWeight: 600, verticalAlign: "top" }}>{r.name || <span className="faint">(unknown)</span>}</td>
              <td rowSpan={specs.length} style={{ verticalAlign: "top" }}>{r.stamp}</td>
              <td rowSpan={specs.length} className="num" style={{ verticalAlign: "top" }}>{num(r.weld_count)}</td>
              <td rowSpan={specs.length} className="num" style={{ verticalAlign: "top" }}>{num(r.weld_inches, 1)}</td>
            </>
          )}
          {s ? (
            <>
              <td>{s.spec}</td>
              <td className="num">{num(s.population)}</td>
              <td className="num">{num(s.required)}{s.progressive_extra ? <span className="warn" title="Progressive sampling added"> (+{s.progressive_extra})</span> : null}</td>
              <td className="num">{num(s.examined)}{s.rejected ? <span className="faint"> · {num(s.rejected)} rej</span> : null}</td>
              <td className="num">{s.actual_pct.toFixed(0)}%</td>
              <td className="num" style={{ color: s.shortfall ? "var(--warn)" : undefined, fontWeight: s.shortfall ? 700 : undefined }}>{num(s.shortfall)}</td>
              <td className={s.progressive_extra ? "warn" : "faint"} style={{ fontSize: 12 }}>{s.sampling_level ?? "Random"}</td>
              <td>{s.compliant ? <span className="badge badge-green">MET</span> : <span className="badge badge-amber">OWED</span>}</td>
            </>
          ) : (
            <td colSpan={8} className="faint">No coverage spec on these welds{owed ? "" : ""}</td>
          )}
        </tr>
      ))}
    </>
  );
}

interface Snapshot {
  owed: number;
  unresolved: number;
  welders: { stamp: string; name: string; spec: string; owed: number }[];
}
function parseSnapshot(s?: string | null): Snapshot | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return { owed: Number(v.owed ?? 0), unresolved: Number(v.unresolved ?? 0), welders: Array.isArray(v.welders) ? v.welders : [] };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function PinDialog({ lot, mode, onClose, onDone }: { lot: NdeLot; mode: "pin" | "move"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<LotWoChoice[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.lotWorkOrderChoices().then(setRows).catch(logErr("loading work orders")); }, []);
  const shown = useMemo(
    () => (rows ?? []).filter((r) => !q || r.work_order.toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );
  const toggle = (wo: string) => setSel((s) => { const n = new Set(s); if (n.has(wo)) n.delete(wo); else n.add(wo); return n; });
  const apply = async () => {
    setBusy(true);
    try {
      let moved = 0;
      for (const wo of sel) {
        moved += mode === "pin" ? await api.pinWorkOrder(wo, lot.id) : await api.moveWorkOrderToLot(wo, lot.id);
      }
      toast.push("ok", `${sel.size} work order${sel.size === 1 ? "" : "s"} ${mode === "pin" ? "pinned" : "moved"} to ${lot.lot_no} · ${moved} weld${moved === 1 ? "" : "s"} moved`);
      onDone();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  const unpin = async (wo: string) => {
    try { await api.unpinWorkOrder(wo); setRows((r) => r?.map((x) => x.work_order === wo ? { ...x, pinned_lot_id: null } : x) ?? null); toast.push("ok", `${wo} unpinned`); }
    catch (e) { toast.push("err", errMsg(e)); }
  };
  return (
    <Modal
      title={mode === "pin" ? `Pin work orders to ${lot.lot_no}` : `Move work orders into ${lot.lot_no}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || sel.size === 0} onClick={apply}>
            {busy ? "Working…" : mode === "pin" ? `Pin ${sel.size || ""}` : `Move ${sel.size || ""}`}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {mode === "pin"
          ? "A pinned work order's welds — existing and new — belong to this lot instead of the receiving lot. Welds already frozen in a closed lot stay where they are."
          : "Existing welds move into this lot (it no longer takes new welds, so nothing is pinned). Welds frozen in a closed lot stay where they are."}
      </p>
      <input placeholder="Filter work orders…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10, width: "100%" }} autoFocus />
      {rows == null ? <Spinner /> : (
        <div className="table-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
          <table className="data">
            <thead><tr><th></th><th>Work order</th><th className="num">Welds</th><th>Currently in</th><th>Pinned</th><th>Last activity</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="table-empty">No work orders match.</td></tr>}
              {shown.map((r) => {
                const here = r.pinned_lot_id === lot.id;
                return (
                  <tr key={r.work_order} onClick={() => toggle(r.work_order)} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={sel.has(r.work_order)} onChange={() => toggle(r.work_order)} onClick={(e) => e.stopPropagation()} /></td>
                    <td style={{ fontWeight: 600 }}>{r.work_order}</td>
                    <td className="num">{num(r.weld_count)}</td>
                    <td className="faint">{r.lots.length ? r.lots.join(", ") : "no lot"}</td>
                    <td>
                      {here ? <span className="badge badge-blue">this lot <button className="link" onClick={(e) => { e.stopPropagation(); unpin(r.work_order); }} aria-label="Unpin"><Icon name="x" size={11} /></button></span>
                        : r.pinned_lot_id ? <span className="badge badge-gray">another lot</span> : <span className="faint">—</span>}
                    </td>
                    <td className="faint">{fmtD(r.last_activity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function NotesDialog({ lot, onClose, onDone }: { lot: NdeLot; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(lot.label ?? "");
  const [notes, setNotes] = useState(lot.notes ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.updateLotNotes(lot.id, label || null, notes || null); toast.push("ok", "Saved"); onDone(); }
    catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`${lot.lot_no} — label & notes`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="field"><label>Label (optional)</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Q3 shop lot, Unit 12 turnaround" autoFocus /></div>
      <div className="field" style={{ marginBottom: 0 }}><label>Notes</label><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </Modal>
  );
}

function NewLotDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const l = await api.createLot(label || null, makeDefault);
      toast.push("ok", `${l.lot_no} opened${makeDefault ? " and is now receiving welds" : ""}`);
      onDone();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="New lot" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "Opening…" : "Open lot"}</button></>}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        The lot number is assigned automatically. A side lot only receives welds from work orders you pin to it — use it for a contractor crew or a job you want judged on its own.
      </p>
      <div className="field"><label>Label (optional)</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Contractor crew — Unit 12" autoFocus /></div>
      <label className="check" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        Make it the receiving lot (the current receiving lot moves to Awaiting closeout)
      </label>
    </Modal>
  );
}

function LotSettingsModal({ cfg, onClose, onSaved }: { cfg: LotConfig; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [c, setC] = useState<LotConfig>({ ...cfg });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.setLotConfig({ ...c, setup_done: true }); toast.push("ok", "Lot settings saved"); onSaved(); }
    catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Lot settings" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <label className="check" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} />
        <span><b>NDE lots on.</b> Off keeps existing lots but new welds are no longer placed in one.</span>
      </label>
      <div className="field">
        <label>Expected lot length</label>
        <select value={c.target_months} onChange={(e) => setC({ ...c, target_months: Number(e.target.value) })}>
          {MONTH_CHOICES.map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"}</option>)}
        </select>
        <div className="hint">Applies to the lots currently open too.</div>
      </div>
      <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={c.auto_rollover} onChange={(e) => setC({ ...c, auto_rollover: e.target.checked })} style={{ marginTop: 3 }} />
        <span><b>Roll over automatically.</b> At the expected length the lot stops taking welds and the next one opens, no questions asked. Unchecked, you're prompted at sign-in instead and can decline.</span>
      </label>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Lot number prefix</label>
        <input value={c.prefix} onChange={(e) => setC({ ...c, prefix: e.target.value })} style={{ width: 160 }} />
        <div className="hint">Lots are numbered {c.prefix || "LOT"}-YYYY-NN.</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function LotsSetup({
  cfg, canAdmin, onDone, onOpenSettings, settingsOpen, onCloseSettings,
}: {
  cfg: LotConfig;
  canAdmin: boolean;
  onDone: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
}) {
  const toast = useToast();
  const [months, setMonths] = useState(cfg.target_months || 3);
  const [auto, setAuto] = useState(cfg.auto_rollover);
  const [prefix, setPrefix] = useState(cfg.prefix || "LOT");
  const [history, setHistory] = useState<"all" | "from" | "none">("all");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const [lot, swept] = await api.setupLots(
        { enabled: true, target_months: months, auto_rollover: auto, prefix, snooze_until: null, setup_done: true },
        history === "from" ? `from:${fromDate}` : history,
      );
      toast.push("ok", `Lots are on — ${lot.lot_no} is receiving welds${swept ? ` (${swept} existing welds placed in it)` : ""}`);
      onDone();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 860 }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{cfg.setup_done ? "NDE lots are turned off" : "Set up NDE lots"}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          A lot is the population a welder's random-examination percentage is measured against (ASME B31.3). Without lots the
          denominator grows forever: 5% of everything a welder ever did can mean hundreds of welds before the next film.
          A lot bounds it — the shop convention is one every three months — and is where progressive sampling escalates
          when a radiograph fails.
        </p>
        <ul className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          <li>New welds land in the current lot on their own. Pin a work order to a side lot when a job should be judged separately.</li>
          <li>At the expected length the lot turns over — automatically, or you're asked. Film can still be recorded against it; it closes itself once coverage is met.</li>
          <li>Closing short is allowed but never silent: a reason is required and the shortfall stays on the record.</li>
        </ul>
        {!canAdmin ? (
          <p className="muted" style={{ marginBottom: 0 }}>An administrator needs to {cfg.setup_done ? "turn lots back on in Lot settings" : "set up lots"}.</p>
        ) : cfg.setup_done ? (
          <button className="btn btn-primary" onClick={onOpenSettings}><Icon name="sliders" size={14} /> Lot settings</button>
        ) : (
          <>
            <div className="grid cols-2" style={{ gap: 14 }}>
              <div className="field">
                <label>Expected lot length</label>
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {MONTH_CHOICES.map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"}{m === 3 ? " (recommended)" : ""}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Lot number prefix</label>
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                <div className="hint">Lots are numbered {prefix || "LOT"}-YYYY-NN, automatically.</div>
              </div>
            </div>
            <div className="field">
              <label>At the end of a lot</label>
              <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 6 }}>
                <input type="radio" checked={!auto} onChange={() => setAuto(false)} style={{ marginTop: 3 }} />
                <span><b>Ask me.</b> At sign-in you're prompted to turn over; you can put it off. Good while the team gets used to lots.</span>
              </label>
              <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <input type="radio" checked={auto} onChange={() => setAuto(true)} style={{ marginTop: 3 }} />
                <span><b>Roll over automatically.</b> The lot stops taking welds and the next opens, no clicks. Anything owed shows up as attention until it's recorded.</span>
              </label>
            </div>
            <div className="field">
              <label>Welds already in the system</label>
              <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 6 }}>
                <input type="radio" checked={history === "all"} onChange={() => setHistory("all")} style={{ marginTop: 3 }} />
                <span><b>Put them all in the first lot.</b> It opens at the earliest weld date, so you'll likely be asked to turn it over right away and close out history properly.</span>
              </label>
              <label className="check" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                <input type="radio" checked={history === "from"} onChange={() => setHistory("from")} />
                <span>Only welds from</span>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={history !== "from"} style={{ width: 160 }} />
              </label>
              <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <input type="radio" checked={history === "none"} onChange={() => setHistory("none")} style={{ marginTop: 3 }} />
                <span><b>Start fresh.</b> Older welds stay outside lots; date-window reports still cover them.</span>
              </label>
            </div>
            <button className="btn btn-accent" onClick={start} disabled={busy}>{busy ? "Starting…" : "Start lots"}</button>
          </>
        )}
      </div>
      {settingsOpen && <LotSettingsModal cfg={cfg} onClose={onCloseSettings} onSaved={() => { onCloseSettings(); onDone(); }} />}
    </div>
  );
}
