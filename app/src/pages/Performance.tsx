import { useCallback, useEffect, useState } from "react";
import { api, errMsg, rejectThreshold } from "../api";
import type { PerformanceReport } from "../types";
import { ErrorBox, Spinner, StatCard, downloadCsv, num, pct, useToast } from "../components/ui";
import { RankedBars, type BarRow } from "../components/charts";
import { downloadPerformancePdf, openPerformancePdf } from "../reportPdf";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Mode = "month" | "year" | "all";

function windowFor(mode: Mode, month: number, year: number): [string | null, string | null] {
  if (mode === "all") return [null, null];
  if (mode === "year") return [`${year}-01-01`, `${year}-12-31`];
  const mm = String(month).padStart(2, "0");
  return [`${year}-${mm}-01`, `${year}-${mm}-31`];
}

export function Performance() {
  const toast = useToast();
  const now = new Date();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rep, setRep] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(0.05);
  const [company, setCompany] = useState("SENTRIX");

  useEffect(() => {
    rejectThreshold().then(setWarn);
    api.getSettings().then((s) => setCompany(s.company_name || s.app_title || "SENTRIX")).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const [from, to] = windowFor(mode, month, year);
    api
      .reportPerformance(from, to)
      .then((r) => { setRep(r); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [mode, month, year]);
  useEffect(load, [load]);

  const exportCsv = () => {
    if (!rep) return;
    const header = ["Welder", "Stamp", "Process", "Welds", "Weld Inches", "RT'd", "RT %", "Rejects", "Reject Rate", "Assigned Spec", "Min Coverage %", "Verdict"];
    const rows = rep.rows.map((r) => [
      r.name, r.stamp, r.processes ?? "", r.weld_count, r.weld_inches.toFixed(1), r.inspected,
      pct(r.rt_pct), r.rejects, pct(r.reject_rate), r.assigned_specs,
      r.specs.length ? r.min_actual_pct.toFixed(0) + "%" : "—",
      r.specs.length === 0 ? "—" : r.in_spec ? "IN SPEC" : "BELOW",
    ]);
    downloadCsv(`welder-performance-${rep.period_label.replace(/[^0-9A-Za-z]+/g, "-")}.csv`, [header, ...rows]);
  };

  const genPdf = async (open: boolean) => {
    if (!rep) return;
    try {
      const path = open
        ? await openPerformancePdf(rep, company)
        : await downloadPerformancePdf(rep, company);
      toast.push("ok", `${open ? "Opened" : "Saved"} ${path}`);
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const allIn = rep && rep.welders_below_spec === 0 && rep.rows.length > 0;

  // Manager charts: who's producing, and whose rejects need a look. Top 12
  // each — the full population stays in the tables below.
  const TOP = 12;
  const outputRows: BarRow[] = rep
    ? [...rep.rows]
        .sort((a, b) => b.weld_count - a.weld_count)
        .slice(0, TOP)
        .map((r) => ({
          key: r.stamp,
          label: r.name || r.stamp,
          sub: r.stamp,
          value: r.weld_count,
          display: num(r.weld_count),
          detail: [
            ["Weld inches", num(r.weld_inches, 1)],
            ["Examined", `${num(r.inspected)} (${pct(r.rt_pct)})`],
            ["Rejects", num(r.rejects)],
          ],
        }))
    : [];
  const examined = rep ? rep.rows.filter((r) => r.inspected > 0) : [];
  const rejectRows: BarRow[] = [...examined]
    .sort((a, b) => b.reject_rate - a.reject_rate || b.rejects - a.rejects)
    .slice(0, TOP)
    .map((r) => ({
      key: r.stamp,
      label: r.name || r.stamp,
      sub: r.stamp,
      value: r.reject_rate * 100,
      display: pct(r.reject_rate),
      flag: r.reject_rate > warn,
      detail: [
        ["Rejects", `${num(r.rejects)} of ${num(r.inspected)} examined`],
        ["Welds this period", num(r.weld_count)],
      ],
    }));

  return (
    <div>
      <div className="toolbar">
        <div className="pill-tabs">
          <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Month</button>
          <button className={mode === "year" ? "active" : ""} onClick={() => setMode("year")}>Year</button>
          <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>All time</button>
        </div>
        {mode === "month" && (
          <div className="field" style={{ margin: 0 }}>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
        {mode !== "all" && (
          <>
            <button className="btn btn-sm" onClick={() => setYear((y) => y - 1)}>‹</button>
            <strong>{year}</strong>
            <button className="btn btn-sm" onClick={() => setYear((y) => y + 1)}>›</button>
          </>
        )}
        <div className="spacer" />
        <button className="btn" onClick={exportCsv} disabled={!rep}>⭳ CSV</button>
        <button className="btn" onClick={() => genPdf(true)} disabled={!rep}>🖨 Open / Print</button>
        <button className="btn btn-accent" onClick={() => genPdf(false)} disabled={!rep}>⭳ Generate PDF</button>
      </div>

      <ErrorBox message={error} />

      {loading || !rep ? (
        <Spinner />
      ) : (
        <>
          <div
            className="card card-pad"
            style={{
              marginBottom: 16, display: "flex", gap: 14, alignItems: "center",
              borderLeft: `5px solid ${allIn ? "var(--ok)" : rep.welders_below_spec ? "var(--danger)" : "var(--line, #ccc)"}`,
            }}
          >
            <div style={{ fontSize: 24 }}>{allIn ? "✅" : rep.welders_below_spec ? "⚠️" : "•"}</div>
            <div>
              <strong style={{ fontSize: 15 }}>
                {rep.rows.length === 0
                  ? "No welds recorded for this period."
                  : allIn
                    ? `All ${rep.welders_in_spec} welders held at or above their assigned NDE spec.`
                    : `${rep.welders_in_spec} of ${rep.rows.length} welders at or above spec — ${rep.welders_below_spec} need attention.`}
              </strong>
              <div className="muted" style={{ fontSize: 12 }}>Period: {rep.period_label} · generated {rep.generated_on}</div>
            </div>
          </div>

          <div className="grid cols-4" style={{ marginBottom: 18 }}>
            <StatCard label="Welders" value={num(rep.rows.length)} />
            <StatCard label="Welds" value={num(rep.total_welds)} sub={`${num(rep.total_inches, 1)} in`} />
            <StatCard label="NDE coverage" value={pct(rep.fleet_rt_pct)} sub={`${num(rep.total_inspected)} examined`} />
            <StatCard label="In spec" value={<span style={{ color: "var(--ok)" }}>{num(rep.welders_in_spec)}</span>} sub="at or above spec" />
            <StatCard label="Below spec" value={<span style={{ color: rep.welders_below_spec ? "var(--danger)" : "var(--ok)" }}>{num(rep.welders_below_spec)}</span>} sub={rep.welders_below_spec ? "owe NDE" : "all clear"} />
            <StatCard label="Rejects" value={num(rep.total_rejects)} />
            <StatCard label="Reject rate" value={<span style={{ color: rep.fleet_reject_rate > warn ? "var(--danger)" : undefined }}>{pct(rep.fleet_reject_rate)}</span>} />
          </div>

          {rep.rows.length > 0 && (
            <div className="chart-grid">
              <div className="card card-pad chart-card">
                <h4>Output by welder</h4>
                <p className="chart-sub">Welds made this period — hover a bar for inches and examinations</p>
                <RankedBars rows={outputRows} totalCount={rep.rows.length} />
              </div>
              <div className="card card-pad chart-card">
                <h4>Reject rate by welder</h4>
                <p className="chart-sub">
                  Share of examined welds rejected — the dashed rule is the {pct(warn)} action level
                </p>
                <RankedBars
                  rows={rejectRows}
                  totalCount={examined.length}
                  threshold={warn * 100}
                  thresholdLabel={`${(warn * 100).toFixed(0)}% action level`}
                />
              </div>
            </div>
          )}

          <div className="section-head"><h3>Per-Welder Performance</h3></div>
          <div className="table-wrap" style={{ marginBottom: 22 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Welder</th><th>Stamp</th><th>Process</th>
                  <th className="num">Welds</th><th className="num">Inches</th>
                  <th className="num">RT'd</th><th className="num">RT %</th>
                  <th className="num">Rej</th><th className="num">Rej %</th>
                  <th>Assigned Spec</th><th className="num">Coverage</th><th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rep.rows.length === 0 && <tr><td colSpan={12} className="table-empty">No welds this period.</td></tr>}
                {rep.rows.map((r) => (
                  <tr key={r.stamp}>
                    <td style={{ fontWeight: 600 }}>{r.name || <span className="faint">(unknown)</span>}</td>
                    <td>{r.stamp}</td>
                    <td className="faint">{r.processes ?? "—"}</td>
                    <td className="num">{num(r.weld_count)}</td>
                    <td className="num">{num(r.weld_inches, 1)}</td>
                    <td className="num">{num(r.inspected)}</td>
                    <td className="num">{pct(r.rt_pct)}</td>
                    <td className="num">{num(r.rejects)}</td>
                    <td className="num" style={{ color: r.reject_rate > warn ? "var(--danger)" : undefined }}>{pct(r.reject_rate)}</td>
                    <td>{r.assigned_specs || "—"}</td>
                    <td className="num">{r.specs.length ? r.min_actual_pct.toFixed(0) + "%" : "—"}</td>
                    <td>
                      {r.specs.length === 0
                        ? <span className="faint">—</span>
                        : r.in_spec
                          ? <span className="badge badge-green">IN SPEC</span>
                          : <span className="badge badge-red">BELOW</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rep.by_spec.length > 0 && (
            <>
              <div className="section-head"><h3>NDE Coverage by Spec (fleet)</h3></div>
              <div className="table-wrap" style={{ marginBottom: 22 }}>
                <table className="data">
                  <thead><tr><th>Spec</th><th className="num">Welds</th><th className="num">Required</th><th className="num">Examined</th><th className="num">Actual %</th><th>Status</th></tr></thead>
                  <tbody>
                    {rep.by_spec.map((s) => (
                      <tr key={s.spec}>
                        <td style={{ fontWeight: 600 }}>{s.spec}</td>
                        <td className="num">{num(s.population)}</td>
                        <td className="num">{num(s.required)}</td>
                        <td className="num">{num(s.examined)}</td>
                        <td className="num">{s.actual_pct.toFixed(0)}%</td>
                        <td>{s.compliant ? <span className="badge badge-green">Met</span> : <span className="badge badge-red">Short {s.shortfall}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {rep.work_orders.length > 0 && (
            <>
              <div className="section-head"><h3>By Work Order</h3></div>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Work Order</th><th className="num">Welds</th><th className="num">Inches</th><th className="num">RT'd</th><th className="num">RT %</th><th className="num">Rejects</th><th className="num">Reject %</th></tr></thead>
                  <tbody>
                    {rep.work_orders.map((w) => (
                      <tr key={w.work_order}>
                        <td style={{ fontWeight: 600 }}>{w.work_order}</td>
                        <td className="num">{num(w.weld_count)}</td>
                        <td className="num">{num(w.weld_inches, 1)}</td>
                        <td className="num">{num(w.inspected)}</td>
                        <td className="num">{pct(w.rt_pct)}</td>
                        <td className="num">{num(w.rejects)}</td>
                        <td className="num" style={{ color: w.reject_rate > warn ? "var(--danger)" : undefined }}>{pct(w.reject_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

