import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { AttentionItem, AuditEntry, ExceptionsSummary, NdeComplianceReport, NdeLot, SummaryReport } from "../types";
import { BarChart, ErrorBox, Spinner, StatCard, localTime, num, pct } from "../components/ui";
import { AttentionList } from "../components/lots";
import { Icon } from "../components/Icon";

export function Dashboard({
  onNavigate, onNewEntry, onOpenWorkOrder, onOpenLot,
}: {
  onNavigate: (p: any) => void;
  onNewEntry: () => void;
  onOpenWorkOrder: (wo: string) => void;
  onOpenLot: (id: number | null) => void;
}) {
  const { user, can } = useAuth();
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [lots, setLots] = useState<NdeLot[] | null>(null);
  const [rep, setRep] = useState<SummaryReport | null>(null);
  const [nde, setNde] = useState<NdeComplianceReport | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [exc, setExc] = useState<ExceptionsSummary | null>(null);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reportSummary().then(setRep).catch((e) => setError(errMsg(e)));
    api.reportNdeCompliance().then(setNde).catch(logErr("loading NDE compliance"));
    api.listDrawings().then((d) => setDrawingCount(d.length)).catch(logErr("loading drawings"));
    api.weldExceptions(null).then(setExc).catch(logErr("loading exceptions"));
    api.recentActivity(null, 8).then(setActivity).catch(logErr("loading activity"));
    api.lotAttention().then(setAttention).catch(logErr("loading lot attention"));
    api.lotConfig()
      .then((c) => (c.enabled ? api.listLots().then(setLots) : setLots([])))
      .catch(logErr("loading lots"));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rep) return <Spinner />;

  const t = rep.total;
  const fresh = t.welds === 0;
  const ndeOwed = nde ? nde.by_spec.reduce((a, sp) => a + sp.shortfall, 0) : 0;
  // With lots on, "owed" means owed in the lots still taking results — the
  // number that actually drives the next film request.
  const lotsOn = (lots?.length ?? 0) > 0;
  const receiving = lots?.find((l) => l.is_default) ?? null;
  const lotOwed = lots ? lots.filter((l) => l.status !== "Closed").reduce((a, l) => a + l.owed, 0) : 0;

  const steps = [
    {
      done: rep.welder_count > 0,
      title: "Add welders & their certs",
      body: "Add each welder with their stamp, then their WPQ certs (alias + document). The app tracks continuity automatically and you pick a cert per weld.",
      cta: "Open Welder Roster",
      go: "roster",
    },
    {
      done: drawingCount > 0,
      title: "Start a Weld Entry",
      body: "Hit “New Weld Entry” — create a work order (or add to one), attach the drawing, drop a bubble on each joint, then Fill attributes to walk each weld. Everything is scoped to the work order.",
      cta: "Add Welds",
      go: "weldlog",
      entry: true,
    },
    {
      done: t.welds > 0,
      title: "Record X-rays & watch the stats",
      body: "As welds are inspected, open them in the Weld Log and record the NDE result. Compliance, welder continuity and every report update automatically.",
      cta: "Open Work Orders",
      go: "workorders",
    },
  ];

  return (
    <div className="grid" style={{ gap: 20 }}>
      {fresh && (
        <div className="card card-pad guide">
          <h3 style={{ fontSize: 16, textTransform: "none", color: "var(--navy)", letterSpacing: 0 }}>
            Welcome{user ? `, ${user.display_name || user.username}` : ""} — here's how to get going
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Three steps. Do them in order and the whole log fills itself.
          </p>
          <div className="grid cols-3" style={{ marginTop: 6 }}>
            {steps.map((s, i) => (
              <div key={i} className={`guide-step ${s.done ? "done" : ""}`}>
                <div className="guide-num">{s.done ? <Icon name="check" size={14} stroke={2.5} /> : i + 1}</div>
                <div className="guide-title">{s.title}</div>
                <div className="guide-body">{s.body}</div>
                <button
                  className={`btn btn-sm ${i === 1 ? "btn-accent" : ""}`}
                  onClick={() => ("entry" in s && s.entry ? onNewEntry() : onNavigate(s.go))}
                >
                  {s.cta} <Icon name="arrowRight" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!fresh && (
        <div className="card card-pad">
          <div className="toolbar" style={{ marginBottom: attention.length ? 10 : 0 }}>
            <h3 style={{ margin: 0 }}>{attention.length ? "Needs attention" : "Nothing needs attention"}</h3>
            <div className="spacer" />
            {can("editor") && <button className="btn btn-accent" onClick={onNewEntry}><Icon name="plus" size={14} stroke={2.25} /> Add Welds</button>}
          </div>
          {attention.length > 0
            ? <AttentionList items={attention} max={6} onOpenLot={onOpenLot} onOpenWorkOrder={onOpenWorkOrder} />
            : <p className="muted" style={{ margin: 0 }}>Every lot is on track and every weld has its data.</p>}
        </div>
      )}

      {!fresh && (
        <div className="grid cols-4">
          <StatCard
            label="Errors to clear"
            value={<span style={{ color: exc?.errors ? "var(--danger)" : "var(--ok)" }}>{num(exc?.errors ?? 0)}</span>}
            sub={exc?.warnings ? `${num(exc.warnings)} warning${exc.warnings === 1 ? "" : "s"} too` : "nothing blocking"}
            onClick={() => onNavigate("exceptions")}
          />
          <StatCard
            label="NDE exams owed"
            value={<span style={{ color: (lotsOn ? lotOwed : ndeOwed) ? "var(--warn-text)" : "var(--ok)" }}>{num(lotsOn ? lotOwed : ndeOwed)}</span>}
            sub={lotsOn ? (receiving ? `${receiving.lot_no} · day ${num(receiving.age_days)} of ${num(receiving.target_days)}` : "no receiving lot") : "to keep every welder at spec"}
            onClick={() => (lotsOn ? onOpenLot(receiving?.id ?? null) : onNavigate("statistics"))}
          />
          <StatCard label="RT coverage" value={pct(t.rt_pct)} sub={`${num(t.rt)} of ${num(t.welds)} welds`} onClick={() => onNavigate("statistics")} />
          <StatCard label="Reject rate" value={pct(t.reject_rate)} sub={`${num(t.rejected)} rejected of ${num(t.rt)}`} onClick={() => onNavigate("statistics")} />
        </div>
      )}

      {!fresh && nde && nde.welder_count > 0 && (
        <NdeQuickRef nde={nde} onNavigate={onNavigate} />
      )}

      <details className="card dash-details">
        <summary className="card-pad" style={{ paddingBottom: 12, cursor: "pointer" }}>
          <h3 style={{ display: "inline" }}>More</h3>
          <span className="muted" style={{ marginLeft: 10 }}>
            {num(t.welds)} welds · {num(t.inches, 1)} in · {num(rep.current_cert_welder_count)} of {num(rep.active_welder_count)} welders with current certs · activity and joint-type breakdown
          </span>
        </summary>
      <div className="grid cols-2" style={{ padding: "0 20px 20px" }}>
        <div className="card card-pad">
          <h3>Welds by Joint Type</h3>
          <BarChart
            data={rep.by_joint.map((j) => ({
              label: j.joint_type || "(none)",
              value: j.welds,
            }))}
            format={(n) => num(n)}
          />
        </div>
        <div className="card card-pad">
          <h3>Recent Activity</h3>
          {activity.length === 0 ? (
            <p className="faint">No activity recorded yet.</p>
          ) : (
            <div className="dash-activity">
              {activity.map((a) => (
                <div key={a.id} className="dash-act-row">
                  <span className="dash-act-ts">{localTime(a.ts)}</span>
                  <span className="dash-act-body">
                    <b>{a.username ?? "—"}</b> {a.action ?? ""} {a.entity ?? ""}
                    {a.entity_id ? ` #${a.entity_id}` : ""}
                    {a.detail ? ` — ${a.detail.length > 80 ? a.detail.slice(0, 80) + "…" : a.detail}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

        <div className="table-wrap" style={{ margin: "0 20px 20px" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Joint Type</th>
                <th className="num">Welds</th>
                <th className="num">RT'd</th>
                <th className="num">Accepted</th>
                <th className="num">Rejected</th>
                <th className="num">PT/MT</th>
                <th className="num">RT %</th>
                <th className="num">Reject Rate</th>
                <th className="num">Weld Inches</th>
              </tr>
            </thead>
            <tbody>
              {rep.by_joint.map((j) => (
                <tr key={j.joint_type || "none"}>
                  <td>{j.joint_type || "(none)"}</td>
                  <td className="num">{num(j.welds)}</td>
                  <td className="num">{num(j.rt)}</td>
                  <td className="num">{num(j.accepted)}</td>
                  <td className="num">{num(j.rejected)}</td>
                  <td className="num">{num(j.pt_mt)}</td>
                  <td className="num">{pct(j.rt_pct)}</td>
                  <td className="num">{pct(j.reject_rate)}</td>
                  <td className="num">{num(j.inches, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{num(t.welds)}</td>
                <td className="num">{num(t.rt)}</td>
                <td className="num">{num(t.accepted)}</td>
                <td className="num">{num(t.rejected)}</td>
                <td className="num">{num(t.pt_mt)}</td>
                <td className="num">{pct(t.rt_pct)}</td>
                <td className="num">{pct(t.reject_rate)}</td>
                <td className="num">{num(t.inches, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </div>
  );
}

function NdeQuickRef({
  nde,
  onNavigate,
}: {
  nde: NdeComplianceReport;
  onNavigate: (p: any) => void;
}) {
  const owed = nde.by_spec.reduce((a, s) => a + s.shortfall, 0);
  const below = nde.noncompliant_count;
  const worst = nde.welders.filter((w) => !w.compliant).slice(0, 4);
  return (
    <div className={`lot-banner ${below ? "danger" : "ok"}`} style={{ marginBottom: 0, flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", color: below ? "var(--danger)" : "var(--ok)" }}>{below ? <Icon name="alert" size={18} /> : <Icon name="checkCircle" size={18} />}</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        <b>{below ? `${num(below)} welder${below === 1 ? "" : "s"} below NDE spec` : "Every welder at or above NDE spec"}</b>
        {below > 0 && worst.length > 0 && (
          <span className="muted">
            {" — "}
            {worst.map((w, i) => (
              <span key={w.stamp}>{i > 0 && ", "}<strong>{w.name || w.stamp}</strong> (owe {num(w.worst_gap)})</span>
            ))}
            {nde.noncompliant_count > worst.length && ` +${nde.noncompliant_count - worst.length} more`}
          </span>
        )}
        {below === 0 && owed > 0 && <span className="muted"> — {num(owed)} examination{owed === 1 ? "" : "s"} still owed</span>}
      </span>
      <button className="btn btn-sm" onClick={() => onNavigate("statistics")}>NDE Statistics <Icon name="arrowRight" size={13} /></button>
    </div>
  );
}
