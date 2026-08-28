import { useEffect, useMemo, useState } from "react";
import { api, errMsg, rejectThreshold } from "../api";
import type { NdeComplianceReport, NdeSpecStat, WelderNdeCompliance } from "../types";
import {
  BarChart,
  ErrorBox,
  Spinner,
  StatCard,
  downloadCsv,
  num,
  pct,
} from "../components/ui";

/**
 * The "full statistics blow-out": per-welder NDE compliance against every spec
 * (5/10/20/100% coverage and API 570 in lieu of hydro), plus welder-performance
 * and reject-rate analysis. This is where we make sure no welder quietly falls
 * below the NDE they're required to hold.
 */
export function Statistics() {
  const [rep, setRep] = useState<NdeComplianceReport | null>(null);
  const [threshold, setThreshold] = useState(0.05);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reportNdeCompliance().then(setRep).catch((e) => setError(errMsg(e)));
    rejectThreshold().then(setThreshold).catch(() => {});
  }, []);

  const specNames = useMemo(
    () => (rep ? rep.by_spec.map((s) => s.spec) : []),
    [rep]
  );

  if (error) return <ErrorBox message={error} />;
  if (!rep) return <Spinner />;

  const owed = rep.by_spec.reduce((a, s) => a + s.shortfall, 0);
  const fleetExamined = rep.by_spec.reduce((a, s) => a + s.examined, 0);
  const fleetPopulation = rep.by_spec.reduce((a, s) => a + s.population, 0);
  const totalRejected = rep.welders.reduce((a, w) => a + w.total_rejected, 0);
  // reject rate is over welds actually inspected, not coverage-met welds.
  const fleetInspected = rep.welders.reduce((a, w) => a + w.total_inspected, 0);
  const fleetRejectRate = fleetInspected ? totalRejected / fleetInspected : 0;
  const belowSpec = rep.welders.filter((w) => !w.compliant);

  if (rep.welders.length === 0) {
    return (
      <div className="card card-pad">
        <h3>NDE Statistics</h3>
        <p className="muted">
          No welds with an NDE spec have been logged yet. As soon as welds carry
          a 5 / 10 / 20 / 100% coverage spec or API 570, every welder's
          compliance is tracked and charted here.
        </p>
      </div>
    );
  }

  const exportCsv = () => {
    const header = ["Welder", "Stamp", "Active"];
    for (const s of specNames)
      header.push(`${s} examined`, `${s} of`, `${s} required`, `${s} owed`);
    header.push("Total welds", "Examined", "Inspected", "Rejected", "Reject rate", "Compliant");
    const rows: (string | number)[][] = [header];
    for (const w of rep.welders) {
      const byspec = new Map(w.specs.map((s) => [s.spec, s]));
      const row: (string | number)[] = [w.name || "(unknown)", w.stamp, w.active ? "Y" : "N"];
      for (const name of specNames) {
        const s = byspec.get(name);
        if (s) row.push(s.examined, s.population, s.required, s.shortfall);
        else row.push("", "", "", "");
      }
      row.push(
        w.total_welds,
        w.total_examined,
        w.total_inspected,
        w.total_rejected,
        (w.reject_rate * 100).toFixed(1) + "%",
        w.compliant ? "Y" : "N"
      );
      rows.push(row);
    }
    downloadCsv("nde-compliance.csv", rows);
  };

  // performance / reject charts — busiest welders first, top 15.
  const byCount = [...rep.welders].sort((a, b) => b.total_welds - a.total_welds).slice(0, 15);
  const byReject = [...rep.welders]
    .filter((w) => w.total_inspected > 0)
    .sort((a, b) => b.reject_rate - a.reject_rate)
    .slice(0, 15);
  const maxReject = Math.max(0.0001, ...byReject.map((w) => w.reject_rate));

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="quick-row">
        <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          Per-welder NDE compliance & performance
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={exportCsv}>⬇ Export CSV</button>
      </div>

      {/* headline numbers */}
      <div className="grid cols-4">
        <StatCard label="Welders tracked" value={num(rep.welder_count)} sub="have NDE-spec welds" />
        <div className={`stat ${belowSpec.length ? "alert" : "good"}`}>
          <div className="label">Below Spec</div>
          <div className="value" style={{ color: belowSpec.length ? "var(--danger)" : "var(--ok)" }}>
            {num(belowSpec.length)}
          </div>
          <div className="sub">{belowSpec.length ? "welders owe NDE — act now" : "everyone at or above spec"}</div>
        </div>
        <StatCard
          label="Examinations owed"
          value={num(owed)}
          sub={`to reach spec across ${num(fleetPopulation)} welds`}
        />
        <StatCard
          label="Fleet Reject Rate"
          value={pct(fleetRejectRate)}
          sub={`${num(totalRejected)} rejected of ${num(fleetInspected)} inspected`}
        />
      </div>

      {/* the watchlist — never let a welder fall below spec */}
      {belowSpec.length > 0 && (
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <h3 style={{ color: "var(--danger)" }}>⚠ Welders below spec — NDE owed</h3>
            <p className="muted" style={{ margin: 0 }}>
              These welders need more examinations to stay at or above their required NDE coverage.
            </p>
          </div>
          <div>
            {belowSpec.map((w) => (
              <div className="watch-item" key={w.stamp}>
                <span className="wi-name">
                  {w.name || "(unknown)"} <span className="faint">· {w.stamp}</span>
                </span>
                <div className="wi-gaps">
                  {w.specs
                    .filter((s) => s.shortfall > 0)
                    .map((s) => (
                      <span key={s.spec} className="badge badge-red">
                        {s.spec}: owe {num(s.shortfall)} ({num(s.examined)}/{num(s.required)})
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* fleet coverage by spec */}
      <div className="card card-pad">
        <h3>NDE Coverage by Spec (fleet)</h3>
        <div className="spec-grid" style={{ marginTop: 12 }}>
          {rep.by_spec.map((s) => (
            <SpecMeter key={s.spec} s={s} />
          ))}
        </div>
      </div>

      {/* per-welder compliance matrix */}
      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 8 }}>
          <h3>Per-Welder Compliance</h3>
          <p className="muted" style={{ margin: 0 }}>
            Examined ÷ welds carrying each spec. API 570 counts a weld only when it holds its two
            required forms of NDE.
          </p>
        </div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Welder</th>
                <th>Stamp</th>
                {specNames.map((n) => (
                  <th key={n} className="num">{n}</th>
                ))}
                <th className="num">Welds</th>
                <th className="num">Reject Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rep.welders.map((w) => (
                <WelderRow key={w.stamp} w={w} specNames={specNames} threshold={threshold} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* performance + reject-rate charts */}
      <div className="grid cols-2">
        <div className="card card-pad">
          <h3>Welder Performance — Weld Count</h3>
          <BarChart
            data={byCount.map((w) => ({ label: w.name || w.stamp, value: w.total_welds }))}
            format={(n) => num(n)}
          />
        </div>
        <div className="card card-pad">
          <h3>Reject-Rate Analysis</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Rejected ÷ examined. Bars over the {pct(threshold)} threshold are flagged.
          </p>
          {byReject.length === 0 ? (
            <p className="faint">No examinations recorded yet.</p>
          ) : (
            byReject.map((w) => {
              const over = w.reject_rate > threshold;
              return (
                <div className="bar-row" key={w.stamp}>
                  <div className="bar-label">{w.name || w.stamp}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(w.reject_rate / maxReject) * 100}%`,
                        background: over ? "var(--danger)" : undefined,
                      }}
                    />
                  </div>
                  <div className="bar-val" style={{ color: over ? "var(--danger)" : undefined }}>
                    {pct(w.reject_rate)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function SpecMeter({ s }: { s: NdeSpecStat }) {
  const fill = Math.min(100, s.actual_pct);
  const mark = Math.min(100, s.required_pct);
  const isApi = s.spec === "API 570";
  return (
    <div className={`spec-card ${s.compliant ? "" : "short"}`}>
      <div className="spec-top">
        <span className="spec-name">{s.spec}</span>
        <span className="spec-pct" style={{ color: s.compliant ? "var(--ok)" : "var(--danger)" }}>
          {num(s.actual_pct, 0)}%
        </span>
      </div>
      <div className="meter">
        <div className={`meter-fill ${s.compliant ? "ok" : "short"}`} style={{ width: `${fill}%` }} />
        {!isApi && <div className="meter-mark" style={{ left: `${mark}%` }} title={`required ${mark}%`} />}
      </div>
      <div className="spec-sub">
        {num(s.examined)} of {num(s.population)} welds examined
        {isApi ? " (two-form)" : ` · needs ${num(s.required_pct, 0)}%`}
      </div>
      <div style={{ marginTop: 6 }}>
        {s.shortfall > 0 ? (
          <span className="badge badge-red">owe {num(s.shortfall)}</span>
        ) : (
          <span className="badge badge-green">at spec</span>
        )}
      </div>
    </div>
  );
}

function WelderRow({
  w,
  specNames,
  threshold,
}: {
  w: WelderNdeCompliance;
  specNames: string[];
  threshold: number;
}) {
  const byspec = new Map(w.specs.map((s) => [s.spec, s]));
  const over = w.total_inspected > 0 && w.reject_rate > threshold;
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>
        {w.name || "(unknown)"}
        {!w.active && <span className="faint" style={{ fontWeight: 400 }}> · inactive</span>}
      </td>
      <td>{w.stamp}</td>
      {specNames.map((name) => {
        const s = byspec.get(name);
        if (!s) return <td key={name} className="num"><span className="cmp-na">—</span></td>;
        const cls = s.compliant ? "cmp-ok" : "cmp-short";
        return (
          <td key={name} className="num">
            <span className="cmp-cell">
              <span className={`cmp-frac ${cls}`}>{s.examined}/{s.population}</span>
              <span className={`cmp-tag ${cls}`}>
                {s.compliant ? "at spec" : `owe ${s.shortfall}`}
              </span>
            </span>
          </td>
        );
      })}
      <td className="num">{num(w.total_welds)}</td>
      <td className="num" style={{ color: over ? "var(--danger)" : undefined }}>
        {w.total_inspected ? pct(w.reject_rate) : "—"}
      </td>
      <td>
        {w.compliant ? (
          <span className="badge badge-green">Compliant</span>
        ) : (
          <span className="badge badge-red">Below spec</span>
        )}
      </td>
    </tr>
  );
}
