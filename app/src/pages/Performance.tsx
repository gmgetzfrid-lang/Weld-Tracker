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

type Mode = "day" | "week" | "month" | "quarter" | "half" | "year" | "all" | "custom" | "lot";
const MODE_LABEL: Record<Mode, string> = {
  day: "Day", week: "Week", month: "Month", quarter: "Quarter", half: "6 months", year: "Year", all: "All time", custom: "Custom", lot: "Lot",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseIso(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(s: string, n: number): string {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
/** Last day of month `m` (1–12) in year `y`. */
function monthEnd(y: number, m: number): string {
  return iso(new Date(y, m, 0));
}
/** The Monday on or before `s`. */
function weekStart(s: string): string {
  const d = parseIso(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
function human(s: string): string {
  const d = parseIso(s);
  return `${MONTHS3[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function spanDays(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1;
}

/** Everything that pins down the report window. */
interface PeriodState {
  mode: Mode;
  /** A day inside the day / week being viewed. */
  anchor: string;
  month: number;   // 1–12
  quarter: number; // 1–4
  half: number;    // 1 | 2
  year: number;
  from: string;    // custom
  to: string;      // custom
}

interface Window {
  from: string | null;
  to: string | null;
  /** Human title for the screen, CSV and PDF ("Q3 2026 (Jul–Sep)"). */
  title: string;
}

function windowFor(p: PeriodState, lot: NdeLot | null): Window {
  switch (p.mode) {
    case "all":
      return { from: null, to: null, title: "All time" };
    case "lot":
      return {
        from: lot?.first_weld?.slice(0, 10) ?? null,
        to: lot?.last_weld?.slice(0, 10) ?? null,
        title: lot ? `Lot ${lot.lot_no}` : "Lot",
      };
    case "day":
      return { from: p.anchor, to: p.anchor, title: human(p.anchor) };
    case "week": {
      const a = weekStart(p.anchor);
      const b = addDays(a, 6);
      return { from: a, to: b, title: `Week of ${human(a)} – ${human(b)}` };
    }
    case "month":
      return { from: `${p.year}-${pad2(p.month)}-01`, to: monthEnd(p.year, p.month), title: `${MONTHS[p.month - 1]} ${p.year}` };
    case "quarter": {
      const m0 = (p.quarter - 1) * 3 + 1;
      return {
        from: `${p.year}-${pad2(m0)}-01`,
        to: monthEnd(p.year, m0 + 2),
        title: `Q${p.quarter} ${p.year} (${MONTHS3[m0 - 1]}–${MONTHS3[m0 + 1]})`,
      };
    }
    case "half": {
      const m0 = p.half === 1 ? 1 : 7;
      return {
        from: `${p.year}-${pad2(m0)}-01`,
        to: monthEnd(p.year, m0 + 5),
        title: `${p.half === 1 ? "Jan–Jun" : "Jul–Dec"} ${p.year}`,
      };
    }
    case "year":
      return { from: `${p.year}-01-01`, to: `${p.year}-12-31`, title: String(p.year) };
    case "custom":
      return {
        from: p.from || null,
        to: p.to || null,
        title: `${p.from ? human(p.from) : "Start"} – ${p.to ? human(p.to) : "today"}`,
      };
  }
}

/** A sensible chart granularity for a window; the user can still switch. */
function defaultBucket(mode: Mode, from: string | null, to: string | null): Bucket {
  if (mode === "day" || mode === "week" || mode === "month") return "day";
  if (mode === "quarter" || mode === "half" || mode === "lot") return "week";
  if (mode === "year" || mode === "all") return "month";
  if (from && to) {
    const n = spanDays(from, to);
    return n <= 45 ? "day" : n <= 200 ? "week" : "month";
  }
  return "month";
}

export function Performance() {
  const toast = useToast();
  const now = new Date();
  const [period, setPeriod] = useState<PeriodState>(() => ({
    mode: "month",
    anchor: iso(now),
    month: now.getMonth() + 1,
    quarter: Math.floor(now.getMonth() / 3) + 1,
    half: now.getMonth() < 6 ? 1 : 2,
    year: now.getFullYear(),
    from: addDays(iso(now), -29),
    to: iso(now),
  }));
  const mode = period.mode;
  const setMode = (m: Mode) => setPeriod((p) => ({ ...p, mode: m }));
  const patch = (x: Partial<PeriodState>) => setPeriod((p) => ({ ...p, ...x }));
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

  const win = windowFor(period, lot);
  const { from, to, title } = win;

  const load = useCallback(() => {
    if (mode === "lot" && lotId == null) { setRep(null); setLoading(false); return; }
    setLoading(true);
    api
      .reportPerformance(from, to, mode === "lot" ? lotId : null)
      .then((r) => { setRep(r); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [mode, from, to, lotId]);
  useEffect(load, [load]);

  useEffect(() => {
    setBucket(defaultBucket(mode, from, to));
  }, [mode, from, to]);

  useEffect(() => {
    api.welderOutputSeries(from, to, bucket).then(setSeries).catch(logErr("loading output series"));
  }, [from, to, bucket]);

  // ‹ › step the window by one unit of the current mode.
  const step = (dir: 1 | -1) => {
    setPeriod((p) => {
      switch (p.mode) {
        case "day": return { ...p, anchor: addDays(p.anchor, dir) };
        case "week": return { ...p, anchor: addDays(p.anchor, 7 * dir) };
        case "month": {
          const m = p.month + dir;
          return m < 1 ? { ...p, month: 12, year: p.year - 1 } : m > 12 ? { ...p, month: 1, year: p.year + 1 } : { ...p, month: m };
        }
        case "quarter": {
          const q = p.quarter + dir;
          return q < 1 ? { ...p, quarter: 4, year: p.year - 1 } : q > 4 ? { ...p, quarter: 1, year: p.year + 1 } : { ...p, quarter: q };
        }
        case "half": {
          const h = p.half + dir;
          return h < 1 ? { ...p, half: 2, year: p.year - 1 } : h > 2 ? { ...p, half: 1, year: p.year + 1 } : { ...p, half: h };
        }
        case "year": return { ...p, year: p.year + dir };
        default: return p;
      }
    });
  };
  const steppable = !["all", "custom", "lot"].includes(mode);

  const exportCsv = () => {
    if (!rep) return;
    const header = ["Welder", "Stamp", "Process", "Welds", "Weld Inches", "RT'd", "RT %", "Rejects", "Reject Rate", "Assigned Spec", "Min Coverage %", "Verdict"];
    const rows = rep.rows.map((r) => [
      r.name, r.stamp, r.processes ?? "", r.weld_count, r.weld_inches.toFixed(1), r.inspected,
      pct(r.rt_pct), r.rejects, pct(r.reject_rate), r.assigned_specs,
      r.specs.length ? r.min_actual_pct.toFixed(0) + "%" : "—",
      r.specs.length === 0 ? "—" : r.in_spec ? "IN SPEC" : "BELOW",
    ]);
    downloadCsv(`welder-performance-${title.replace(/[^0-9A-Za-z]+/g, "-")}.csv`, [header, ...rows]);
  };

  const genPdf = async (open: boolean) => {
    if (!rep) return;
    try {
      const path = open
        ? await openPerformancePdf(rep, company, title)
        : await downloadPerformancePdf(rep, company, title);
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
      <div className="toolbar" style={{ flexWrap: "wrap", rowGap: 8 }}>
        <div className="pill-tabs">
          {(["day", "week", "month", "quarter", "half", "year", "all", "custom"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
          ))}
          {lots.length > 0 && (
            <button className={mode === "lot" ? "active" : ""} onClick={() => setMode("lot")} title="One NDE lot — the B31.3 population, with progressive sampling">Lot</button>
          )}
        </div>
        {steppable && <button className="btn btn-sm" onClick={() => step(-1)} title="Previous">‹</button>}
        {(mode === "day" || mode === "week") && (
          <div className="field" style={{ margin: 0 }}>
            <input type="date" value={period.anchor} onChange={(e) => e.target.value && patch({ anchor: e.target.value })} />
          </div>
        )}
        {mode === "week" && <strong style={{ fontSize: 13 }}>{title.replace("Week of ", "")}</strong>}
        {mode === "month" && (
          <div className="field" style={{ margin: 0 }}>
            <select value={period.month} onChange={(e) => patch({ month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
        {mode === "quarter" && (
          <div className="field" style={{ margin: 0 }}>
            <select value={period.quarter} onChange={(e) => patch({ quarter: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q} · {MONTHS3[(q - 1) * 3]}–{MONTHS3[(q - 1) * 3 + 2]}</option>)}
            </select>
          </div>
        )}
        {mode === "half" && (
          <div className="field" style={{ margin: 0 }}>
            <select value={period.half} onChange={(e) => patch({ half: Number(e.target.value) })}>
              <option value={1}>Jan – Jun</option>
              <option value={2}>Jul – Dec</option>
            </select>
          </div>
        )}
        {(mode === "month" || mode === "quarter" || mode === "half" || mode === "year") && (
          <strong>{period.year}</strong>
        )}
        {steppable && <button className="btn btn-sm" onClick={() => step(1)} title="Next">›</button>}
        {mode === "custom" && (
          <>
            <div className="field" style={{ margin: 0 }}>
              <input type="date" value={period.from} onChange={(e) => patch({ from: e.target.value })} />
            </div>
            <span className="muted">to</span>
            <div className="field" style={{ margin: 0 }}>
              <input type="date" value={period.to} onChange={(e) => patch({ to: e.target.value })} />
            </div>
            {from && to && <span className="muted" style={{ fontSize: 12 }}>{spanDays(from, to)} days</span>}
          </>
        )}
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
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button className="btn" onClick={exportCsv} disabled={!rep}>⭳ CSV</button>
          <button className="btn" onClick={() => genPdf(true)} disabled={!rep}>🖨 Open / Print</button>
          <button className="btn btn-accent" onClick={() => genPdf(false)} disabled={!rep}>⭳ Generate PDF</button>
        </div>
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
                {title}{from && to && mode !== "day" && mode !== "custom" ? ` · ${from} to ${to}` : ""} · generated {rep.generated_on}
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

