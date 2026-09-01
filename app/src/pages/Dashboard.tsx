import { useEffect, useState } from "react";
import { api, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import type { AuditEntry, ExceptionsSummary, NdeComplianceReport, SummaryReport } from "../types";
import { BarChart, ErrorBox, Spinner, StatCard, localTime, num, pct } from "../components/ui";

export function Dashboard({ onNavigate, onNewEntry }: { onNavigate: (p: any) => void; onNewEntry: () => void }) {
  const { user } = useAuth();
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
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rep) return <Spinner />;

  const t = rep.total;
  const fresh = t.welds === 0;
  const ndeOwed = nde ? nde.by_spec.reduce((a, sp) => a + sp.shortfall, 0) : 0;

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
      cta: "New Weld Entry",
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
            👋 Welcome{user ? `, ${user.display_name || user.username}` : ""} — here's how to get going
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Three steps. Do them in order and the whole log fills itself.
          </p>
          <div className="grid cols-3" style={{ marginTop: 6 }}>
            {steps.map((s, i) => (
              <div key={i} className={`guide-step ${s.done ? "done" : ""}`}>
                <div className="guide-num">{s.done ? "✓" : i + 1}</div>
                <div className="guide-title">{s.title}</div>
                <div className="guide-body">{s.body}</div>
                <button
                  className={`btn btn-sm ${i === 1 ? "btn-accent" : ""}`}
                  onClick={() => ("entry" in s && s.entry ? onNewEntry() : onNavigate(s.go))}
                >
                  {s.cta} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!fresh && (
        <div className="quick-row">
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Quick actions:</span>
          <button className="btn btn-accent btn-sm" onClick={onNewEntry}>+ New Weld Entry</button>
          <button className="btn btn-sm" onClick={() => onNavigate("workorders")}>🗂️ Work Orders</button>
          <button className="btn btn-sm" onClick={() => onNavigate("roster")}>☺ Welder Roster</button>
        </div>
      )}

      {!fresh && exc && nde && (
        <div className="exc-tiles" style={{ marginBottom: 0 }}>
          <button className={`exc-tile sev-error ${exc.errors ? "" : "quiet"}`} onClick={() => onNavigate("exceptions")}
            title="Validation errors — unresolved NDE requirements, unrepaired rejects, contradictions. Click to work the list.">
            <span className="exc-num">{num(exc.errors)}</span>
            <span className="exc-cap">Errors to clear</span>
          </button>
          <button className={`exc-tile sev-error ${(exc.by_code["result.rejected_unrepaired"] ?? 0) ? "" : "quiet"}`} onClick={() => onNavigate("exceptions")}
            title="Rejected welds with no repair logged yet.">
            <span className="exc-num">{num(exc.by_code["result.rejected_unrepaired"] ?? 0)}</span>
            <span className="exc-cap">Rejects awaiting repair</span>
          </button>
          <button className={`exc-tile sev-warning ${ndeOwed ? "" : "quiet"}`} onClick={() => onNavigate("statistics")}
            title="Examinations still owed to keep every welder at or above their NDE spec.">
            <span className="exc-num">{num(ndeOwed)}</span>
            <span className="exc-cap">NDE exams owed</span>
          </button>
          <button className={`exc-tile sev-warning ${exc.warnings ? "" : "quiet"}`} onClick={() => onNavigate("exceptions")}
            title="Warnings — below-spec coverage, missing fields, PWHT/PMI owed.">
            <span className="exc-num">{num(exc.warnings)}</span>
            <span className="exc-cap">Warnings</span>
          </button>
        </div>
      )}

      <div className="grid cols-4">
        <StatCard label="Total Welds" value={num(t.welds)} onClick={() => onNavigate("weldlog")}
          sub={`${num(t.inches, 1)} weld inches · excludes count-omitted`} />
        <StatCard
          label="RT Coverage"
          value={pct(t.rt_pct)}
          sub={`${num(t.rt)} of ${num(t.welds)} RT'd`}
          onClick={() => onNavigate("statistics")}
        />
        <StatCard
          label="Reject Rate"
          value={pct(t.reject_rate)}
          sub={`${num(t.rejected)} rejected of ${num(t.rt)} RT'd`}
          onClick={() => onNavigate("statistics")}
        />
        <StatCard
          label="Welders"
          value={num(rep.active_welder_count)}
          sub={`${num(rep.welder_count)} on roster`}
          onClick={() => onNavigate("roster")}
        />
      </div>

      {nde && nde.welder_count > 0 && (
        <NdeQuickRef nde={nde} onNavigate={onNavigate} />
      )}

      <div className="grid cols-2">
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

      <details className="card dash-details">
        <summary className="card-pad" style={{ paddingBottom: 12, cursor: "pointer" }}>
          <h3 style={{ display: "inline" }}>Breakdown by Joint Type</h3>
          <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>expand</span>
        </summary>
        <div className="table-wrap" style={{ border: 0 }}>
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
    <div className="card card-pad" style={below ? { borderColor: "#fca5a5" } : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0, color: below ? "var(--danger)" : "var(--navy)" }}>
          NDE Compliance {below ? "⚠" : "✓"}
        </h3>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => onNavigate("statistics")}>
          Open NDE Statistics →
        </button>
      </div>
      <div className="nde-quick" style={{ marginTop: 12 }}>
        <div>
          <div className="nq-fig" style={{ color: below ? "var(--danger)" : "var(--ok)" }}>
            {num(below)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>welders below spec</div>
        </div>
        <div>
          <div className="nq-fig">{num(owed)}</div>
          <div className="muted" style={{ fontSize: 12 }}>examinations owed</div>
        </div>
        <div>
          <div className="nq-fig" style={{ color: nde.spec_mismatch_count ? "var(--warn)" : "var(--ok)" }}>
            {num(nde.spec_mismatch_count)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>off the shop/field rule</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {nde.by_spec.map((s) => (
            <span key={s.spec} className={`badge ${s.compliant ? "badge-green" : "badge-red"}`} title={`${num(s.examined)} of ${num(s.population)} examined`}>
              {s.spec} · {num(s.actual_pct, 0)}%
            </span>
          ))}
        </div>
      </div>
      {worst.length > 0 && (
        <p className="muted" style={{ marginBottom: 0, marginTop: 12, fontSize: 12.5 }}>
          Needs attention:{" "}
          {worst.map((w, i) => (
            <span key={w.stamp}>
              {i > 0 && ", "}
              <strong>{w.name || w.stamp}</strong> (owe {num(w.worst_gap)})
            </span>
          ))}
          {nde.noncompliant_count > worst.length && ` +${nde.noncompliant_count - worst.length} more`}
        </p>
      )}
    </div>
  );
}
