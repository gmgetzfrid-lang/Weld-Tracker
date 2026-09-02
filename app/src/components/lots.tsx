import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { AttentionItem, LotStatus, MaintainOutcome, NdeLot } from "../types";
import { Modal, num, useToast } from "./ui";

/** Status chip: Receiving / Open / Awaiting closeout / Closed / Closed short. */
export function LotStatusChip({
  lot,
}: {
  lot: { status: LotStatus; is_default?: boolean; closed_short?: boolean };
}) {
  const cls =
    lot.status === "Open"
      ? `lot-chip open ${lot.is_default ? "receiving" : ""}`
      : lot.status === "Closing"
        ? "lot-chip closing"
        : lot.closed_short
          ? "lot-chip closed short"
          : "lot-chip closed";
  const label =
    lot.status === "Open"
      ? lot.is_default ? "Receiving" : "Open"
      : lot.status === "Closing"
        ? "Awaiting closeout"
        : lot.closed_short
          ? "Closed short"
          : "Closed";
  return <span className={cls}>{label}</span>;
}

export function fmtD(d?: string | null): string {
  return d ? d.slice(0, 10) : "—";
}

/** "2026-05-01 → 2026-07-14 (75 days)" from a lot's first and last weld. */
export function weldSpan(l: { first_weld?: string | null; last_weld?: string | null }): string {
  if (!l.first_weld) return "No welds yet";
  const a = new Date(l.first_weld.slice(0, 10));
  const b = new Date((l.last_weld ?? l.first_weld).slice(0, 10));
  const days = Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000)) + 1;
  return l.last_weld && l.last_weld !== l.first_weld
    ? `${fmtD(l.first_weld)} → ${fmtD(l.last_weld)} · ${days} day${days === 1 ? "" : "s"}`
    : `${fmtD(l.first_weld)} · 1 day`;
}

/** Age against the expected lot length. */
export function LotProgress({ lot }: { lot: NdeLot }) {
  const pct = Math.min(100, Math.round((lot.age_days / Math.max(1, lot.target_days)) * 100));
  const over = lot.overdue_days > 0;
  return (
    <div
      className="lot-progress"
      title={`${lot.age_days} of ${lot.target_days} days${over ? ` · ${lot.overdue_days} over` : ""}`}
    >
      <div className={`lot-progress-bar ${over ? "over" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The "don't let me forget" list — dashboard and lots page. */
export function AttentionList({
  items,
  onOpenLot,
  onOpenWorkOrder,
  max,
}: {
  items: AttentionItem[];
  onOpenLot: (id: number | null) => void;
  onOpenWorkOrder: (wo: string) => void;
  max?: number;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max ?? items.length);
  return (
    <div className="attn-list">
      {shown.map((it, i) => (
        <button
          key={`${it.kind}-${it.lot_id ?? ""}-${it.work_order ?? ""}-${i}`}
          className={`attn-item sev-${it.severity}`}
          onClick={() => (it.work_order ? onOpenWorkOrder(it.work_order) : onOpenLot(it.lot_id ?? null))}
        >
          <span className={`attn-dot sev-${it.severity}`} />
          <span className="attn-body">
            <b>{it.title}</b>
            <span className="attn-detail">{it.detail}</span>
          </span>
          <span className="attn-go">→</span>
        </button>
      ))}
      {items.length > shown.length && (
        <div className="muted" style={{ fontSize: 12, padding: "2px 4px" }}>
          +{items.length - shown.length} more on the NDE Lots page
        </div>
      )}
    </div>
  );
}

/** Topbar badge with the count of lot items needing action. */
export function AttentionBadge({ tick, onClick }: { tick: unknown; onClick: () => void }) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.lotAttention().then((x) => { if (alive) setItems(x); }).catch(() => {});
    load();
    const t = setInterval(load, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, [tick]);
  const acting = items.filter((i) => i.severity !== "info");
  if (acting.length === 0) return null;
  const worst = acting.some((i) => i.severity === "error") ? "error" : "warning";
  return (
    <button
      className={`topbar-attn sev-${worst}`}
      onClick={onClick}
      title={acting.slice(0, 6).map((i) => `• ${i.title}`).join("\n")}
    >
      ⚠ {acting.length} need{acting.length === 1 ? "s" : ""} attention
    </button>
  );
}

/**
 * The autonomous pass plus the turnover prompt. Runs once per sign-in: makes
 * sure a receiving lot exists, rolls over and closes lots per configuration,
 * says what it did, and — when the shop chose to be asked — asks whether to
 * turn the current lot over.
 */
export function LotMaintenance({ onOpenLots, onChanged }: { onOpenLots: () => void; onChanged: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [due, setDue] = useState<NdeLot | null>(null);
  const [busy, setBusy] = useState(false);
  const editor = can("editor");

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .lotsAutoMaintain()
      .then((o: MaintainOutcome) => {
        if (!alive || !o.enabled) return;
        if (o.created_default) toast.push("ok", `Opened ${o.created_default} as the receiving NDE lot`);
        if (o.turned_over) {
          toast.push("ok", `Lot ${o.turned_over[0]} turned over automatically — ${o.turned_over[1]} is now receiving welds`);
        }
        for (const l of o.auto_closed) toast.push("ok", `Lot ${l} closed clean — coverage complete`);
        if (o.created_default || o.turned_over || o.auto_closed.length) onChanged();
        if (o.turnover_due && editor) setDue(o.turnover_due);
      })
      .catch(logErr("lot maintenance"));
    return () => { alive = false; };
    // Once per signed-in user; the pass is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.push("ok", done);
      setDue(null);
      onChanged();
    } catch (e) {
      toast.push("err", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!due) return null;
  const months = Math.max(1, Math.round(due.target_days / 30));
  return (
    <Modal
      title={`${due.lot_no} has run ${due.age_days} days — turn it over?`}
      onClose={() => setDue(null)}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => act(() => api.snoozeTurnover(30), "Okay — I'll ask again in a month")}>
            Not this time
          </button>
          <button className="btn" disabled={busy} onClick={() => act(() => api.snoozeTurnover(14), "Reminder set for two weeks")}>
            Remind me in 2 weeks
          </button>
          <button
            className="btn btn-accent"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const [old, fresh] = await api.turnOverLot(null);
                toast.push("ok", `${fresh.lot_no} is now receiving welds${old ? ` · ${old.lot_no} is awaiting closeout` : ""}`);
                onOpenLots();
              }, "Lot turned over")
            }
          >
            {busy ? "Turning over…" : "Turn over now"}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Your expected lot length is {months} month{months === 1 ? "" : "s"}. Turning over freezes this population
        — each welder's NDE percentage is judged on what's in the lot — and opens a fresh lot for everything
        from now on. Film can still be recorded against the old lot; it closes itself once coverage is met.
      </p>
      <div className="lot-prompt-facts">
        <span><b>{num(due.weld_count)}</b> welds</span>
        <span><b>{num(due.weld_inches, 1)}</b> weld inches</span>
        <span><b>{num(due.welder_count)}</b> welders</span>
        <span><b>{num(due.work_order_count)}</b> work orders</span>
        <span className={due.owed ? "warn" : "ok"}><b>{num(due.owed)}</b> NDE owed</span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Letting a lot run long is allowed — B31.3 leaves the lot definition to you — but the longer it runs, the
        more welds it takes to trigger the next examination. Turning over on schedule is encouraged.
      </p>
    </Modal>
  );
}
