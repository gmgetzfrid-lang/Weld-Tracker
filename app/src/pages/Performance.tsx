import { useCallback, useEffect, useState } from "react";
import { api, errMsg, logErr, rejectThreshold } from "../api";
import type { NdeLot, OutputSeries, OutputSeriesPoint, PerformanceReport } from "../types";
import { LotStatusChip } from "../components/lots";
import { ErrorBox, Spinner, StatCard, downloadCsv, num, pct, useToast } from "../components/ui";
import { MultiLine, OTHER_COLOR, RankedBars, SERIES_COLORS, type BarRow, type LineSeries } from "../components/charts";
import { downloadPerformancePdf, openPerformancePdf } from "../reportPdf";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Metric = "welds" | "inches" | "rate";
type Bucket = "day" | "week" | "month" | "year";

type Mode = "month" | "year" | "all" | "lot";

function windowFor(mode: Mode, month: number, year: number, lot?: NdeLot | null): [string | null, string | null] {
  if (mode === "all") return [null, null];
  if (mode === "lot") return [lot?.first_weld?.slice(0, 10) ?? null, lot?.last_weld?.slice(0, 10) ?? null];
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
  // Output-over-time chart: what to plot and how finely to bucket it.
  const [metric, setMetric] = useState<Metric>("inches");
  const [bucket, setBucket] = useState<Bucket>("day");
  const [series, setSeries] = useState<OutputSeries[] | null>(null);
  // Lot scope: judge the period the way B31.3 does — one lot, progressive
  // sampling included.
  const [lots, setLots] = useState<NdeLot[]>([]);
  const [lotId, setLotId] = useState<number | null>(null);
  const lot = lots.find((l) => l.id === lotId) ?? null;

  useEffect(() => {
    rejectThreshold().then(setWarn);
    api.getSettings().then((s) => setCompany(s.company_name || s.app_title || "SENTRIX")).catch(() => {});
    api.lotConfig()
      .then((c) => (c.enabled ? api.listLots() : Promise.resolve([] as NdeLot[])))
      .then((ls) => {
        setLots(ls);
        setLotId((cur) => cur ?? ls.find((l) => l.is_default)?.id ?? ls[0]?.id ?? null);
      })
      .catch(logErr("loading lots"));
  }, []);

  const load = useCallback(() => {
    if (mode === "lot" && lotId == null) { setRep(null); setLoading(false); return; }
    setLoading(true);
    const [from, to] = windowFor(mode, month, year, lot);
    api
      .reportPerformance(from, to, mode === "lot" ? lotId : null)
      .then((r) => { setRep(r); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
    // `lot` is derived from lotId + lots; lots only matter for the date window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, month, year, lotId]);
  useEffect(load, [load]);

  // A sensible default granularity for each window; the user can still switch.
  useEffect(() => {
    setBucket(mode === "month" ? "day" : mode === "lot" ? "week" : "month");
  }, [mode]);

  useEffect(() => {
    const [from, to] = windowFor(mode, month, year, lot);
    api.welderOutputSeries(from, to, bucket).then(setSeries).catch(logErr("loading output series"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, month, year, bucket, lotId, lots.length]);

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
        .sort((a, b) => b.weld_inches - a.weld_inches)
        .slice(0, TOP)
        .map((r) => ({
          key: r.stamp,
          label: r.name || r.stamp,
          sub: r.stamp,
          value: r.weld_inches,
          display: `${num(r.weld_inches, 1)} in`,
          detail: [
            ["Welds", num(r.weld_count)],
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

  // Output-over-time lines: one color per welder, assigned by total output so
  // colors stay put when the metric toggles. Past the palette, the tail folds
  // into a single gray "Other" line so every weld still shows up somewhere.
  const buckets = series
    ? [...new Set(series.flatMap((s) => s.points.map((p) => p.bucket)))].sort()
    : [];
  let lineSeries: LineSeries[] = [];
  if (series && buckets.length) {
    const bIdx = new Map(buckets.map((b, i) => [b, i] as const));
    const ordered = [...series].sort(
      (a, b) => b.total_inches - a.total_inches || b.total_welds - a.total_welds || a.stamp.localeCompare(b.stamp),
    );
    const fold = ordered.length > SERIES_COLORS.length;
    const named = fold ? ordered.slice(0, SERIES_COLORS.length - 1) : ordered;
    const rest = fold ? ordered.slice(SERIES_COLORS.length - 1) : [];

    // A missing bucket is a real zero for output metrics; a rate needs at
    // least one examined weld, so it gaps (null) instead of faking 0%.
    const valuesFor = (pts: Map<number, OutputSeriesPoint>): (number | null)[] =>
      buckets.map((_, i) => {
        const p = pts.get(i);
        if (metric === "rate") return p && p.examined > 0 ? (p.rejects / p.examined) * 100 : null;
        if (!p) return 0;
        return metric === "welds" ? p.welds : p.inches;
      });

    lineSeries = named.map((s, si) => {
      const pts = new Map<number, OutputSeriesPoint>();
      s.points.forEach((p) => pts.set(bIdx.get(p.bucket)!, p));
      return { key: s.stamp, label: s.name || s.stamp, color: SERIES_COLORS[si], values: valuesFor(pts) };
    });
    if (rest.length) {
      const agg = new Map<number, OutputSeriesPoint>();
      rest.forEach((s) =>
        s.points.forEach((p) => {
          const i = bIdx.get(p.bucket)!;
          const a = agg.get(i) ?? { bucket: p.bucket, welds: 0, inches: 0, examined: 0, rejects: 0 };
          a.welds += p.welds;
          a.inches += p.inches;
          a.examined += p.examined;
          a.rejects += p.rejects;
          agg.set(i, a);
        }),
      );
      lineSeries.push({ key: "__other", label: `Other (${rest.length})`, color: OTHER_COLOR, values: valuesFor(agg) });
    }
  }

  const bucketLabel = (b: string): string => {
    if (bucket === "day" || bucket === "week") return b.slice(5); // "05-14" / "W19"
    if (bucket === "month") {
      const m = MONTHS3[Number(b.slice(5, 7)) - 1] ?? b;
      return mode === "all" ? `${m} ${b.slice(2, 4)}` : m;
    }
    return b; // year
  };
  const fmtValue = (v: number): string =>
    metric === "welds" ? num(v) : metric === "inches" ? `${num(v, 1)} in` : `${v.toFixed(1)}%`;

  return (
    <div>
      <div className="toolbar">
        <div className="pill-tabs">
          <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Month</button>
          <button className={mode === "year" ? "active" : ""} onClick={() => setMode("year")}>Year</button>
          <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>All time</button>
          {lots.length > 0 && (
            <button className={mode === "lot" ? "active" : ""} onClick={() => setMode("lot")} title="One NDE lot — the B31.3 population, with progressive sampling">Lot</button>
          )}
        </div>
        {mode === "lot" && (
          <>
            <div className="field" style={{ margin: 0 }}>
              <select value={lotId ?? ""} onChange={(e) => setLotId(Number(e.target.value))}>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lot_no}{l.label ? ` · ${l.label}` : ""} — {l.is_default ? "receiving" : l.status === "Open" ? "open" : l.status === "Closing" ? "awaiting closeout" : l.closed_short ? "closed short" : "closed"}
                  </option>
                ))}
              </select>
            </div>
            {lot && <LotStatusChip lot={lot} />}
          </>
        )}
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
              <div className="muted" style={{ fontSize: 12 }}>
                Period: {rep.period_label} · generated {rep.generated_on}
                {rep.progressive_sampling && <> · <span className="warn">requirements include B31.3 progressive sampling</span></>}
              </div>
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

          <div className="card card-pad chart-card" style={{ marginBottom: 18 }}>
            <div className="chart-controls">
              <h4 style={{ margin: 0 }}>Welder output over time</h4>
              <div className="spacer" />
              <div className="pill-tabs">
                <button className={metric === "welds" ? "active" : ""} onClick={() => setMetric("welds")}>Welds</button>
                <button className={metric === "inches" ? "active" : ""} onClick={() => setMetric("inches")}>Weld inches</button>
                <button className={metric === "rate" ? "active" : ""} onClick={() => setMetric("rate")}>Reject rate</button>
              </div>
              <div className="pill-tabs">
                <button className={bucket === "day" ? "active" : ""} onClick={() => setBucket("day")}>Day</button>
                <button className={bucket === "week" ? "active" : ""} onClick={() => setBucket("week")}>Week</button>
                <button className={bucket === "month" ? "active" : ""} onClick={() => setBucket("month")}>Month</button>
                <button className={bucket === "year" ? "active" : ""} onClick={() => setBucket("year")}>Year</button>
              </div>
            </div>
            <p className="chart-sub">
              {metric === "rate"
                ? "Share of examined welds rejected per welder — gaps mean nothing was examined that "
                : metric === "welds"
                  ? "Welds made per welder each "
                  : "Weld inches per welder each "}
              {bucket} — every welder is a color; hover to read all lines at a point
            </p>
            {series ? (
              <MultiLine series={lineSeries} buckets={buckets} fmt={fmtValue} bucketLabel={bucketLabel} />
            ) : (
              <Spinner />
            )}
          </div>

          {rep.rows.length > 0 && (
            <div className="chart-grid">
              <div className="card card-pad chart-card">
                <h4>Output by welder</h4>
                <p className="chart-sub">Weld inches this period — hover a bar for weld count and examinations</p>
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
                  <th>Assigned Spec</th><th className="num">Coverage</th><th className="num">Owed</th>
                  {rep.progressive_sampling && <th>Sampling</th>}<th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rep.rows.length === 0 && <tr><td colSpan={rep.progressive_sampling ? 14 : 13} className="table-empty">No welds this period.</td></tr>}
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
                    <td className="num" style={{ color: r.worst_gap ? "var(--warn)" : undefined, fontWeight: r.worst_gap ? 700 : undefined }}>
                      {r.specs.length ? num(r.specs.reduce((a, s) => a + s.shortfall, 0)) : "—"}
                    </td>
                    {rep.progressive_sampling && (
                      <td className="faint" style={{ fontSize: 12 }}>
                        {r.specs.filter((s) => (s.progressive_extra ?? 0) > 0).map((s) => <span key={s.spec} className="warn">{s.spec}: {s.sampling_level}</span>)}
                        {r.specs.every((s) => !(s.progressive_extra ?? 0)) && "Random"}
                      </td>
                    )}
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

