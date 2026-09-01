import { useEffect, useRef, useState } from "react";

/**
 * Fixed categorical palette for per-welder series (CVD-validated ordering —
 * assign in this order, never cycle). Past eight series, fold into "Other".
 */
export const SERIES_COLORS = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];
export const OTHER_COLOR = "#898781";

/**
 * Small chart kit for the report pages — the manager-facing "how much and how
 * well" views. Deliberately minimal: single-series ranked bars and monthly
 * columns, brand blue for the data, text in ink tokens, per-mark hover
 * tooltips. Every number shown here is also in the tables beside the charts,
 * so the graphics summarize — they never gate.
 */

export interface BarRow {
  key: string;
  /** Row identity (welder name). */
  label: string;
  /** Secondary identity (stamp), shown muted after the label. */
  sub?: string;
  value: number;
  /** Formatted value label at the bar tip (defaults to the raw number). */
  display?: string;
  /** Over the action threshold — bar wears the danger color (value label + row label carry it too, never color alone). */
  flag?: boolean;
  /** Extra tooltip rows: [label, value]. */
  detail?: [string, string][];
}

interface TipState {
  x: number;
  y: number;
  title: string;
  value: string;
  detail: [string, string][];
}

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="chart-tip-val">{tip.value}</div>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.detail.map(([l, v]) => (
        <div key={l} className="chart-tip-row"><span>{l}</span><b>{v}</b></div>
      ))}
    </div>
  );
}

/** Tooltip position within the chart card, clamped away from the right edge. */
function tipPos(e: React.MouseEvent, host: HTMLElement): { x: number; y: number } {
  const r = host.getBoundingClientRect();
  return {
    x: Math.min(e.clientX - r.left + 14, r.width - 190),
    y: Math.max(6, e.clientY - r.top - 10),
  };
}

/**
 * Ranked horizontal bars — one metric across welders, sorted by the caller.
 * Single series (no legend; the card title names it); every bar carries its
 * value at the tip so no axis is needed. Optional vertical threshold rule
 * (e.g. the 5% reject action level).
 */
export function RankedBars({
  rows,
  totalCount,
  threshold,
  thresholdLabel,
}: {
  rows: BarRow[];
  /** Full population size, when `rows` is a top-N slice. */
  totalCount?: number;
  /** Threshold in value units — drawn as a dashed rule across the plot. */
  threshold?: number;
  thresholdLabel?: string;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  const maxV = Math.max(...rows.map((r) => r.value), threshold ?? 0, 1e-9);
  // Headroom so the longest bar's tip label never clips.
  const scale = maxV * 1.18;

  if (rows.length === 0) return <p className="muted chart-empty">Nothing to chart for this period.</p>;

  return (
    <div className="chart-body" onMouseLeave={() => setTip(null)}>
      <div className="rb-grid">
        {rows.map((r) => (
          <div
            key={r.key}
            className="rb-row"
            onMouseMove={(e) => {
              const host = (e.currentTarget as HTMLElement).closest(".chart-body") as HTMLElement;
              setTip({
                ...tipPos(e, host),
                title: r.sub ? `${r.label} · ${r.sub}` : r.label,
                value: r.display ?? String(r.value),
                detail: r.detail ?? [],
              });
            }}
          >
            <div className={`rb-label ${r.flag ? "flag" : ""}`} title={r.label}>
              {r.label}
              {r.sub && <span className="rb-sub"> {r.sub}</span>}
            </div>
            <div className="rb-track">
              <div
                className={`rb-bar ${r.flag ? "flag" : ""}`}
                style={{ width: `${Math.max((r.value / scale) * 100, r.value > 0 ? 1 : 0)}%` }}
              />
              <span className="rb-val">{r.display ?? String(r.value)}</span>
              {threshold != null && (
                <span className="rb-threshold" style={{ left: `${(threshold / scale) * 100}%` }} />
              )}
            </div>
          </div>
        ))}
        {threshold != null && thresholdLabel && (
          <div className="rb-row rb-threshold-legend">
            <div className="rb-label" />
            <div className="rb-track">
              <span className="rb-threshold tall" style={{ left: `${(threshold / scale) * 100}%` }} />
              <span className="rb-threshold-lab" style={{ left: `calc(${(threshold / scale) * 100}% + 6px)` }}>
                {thresholdLabel}
              </span>
            </div>
          </div>
        )}
      </div>
      {totalCount != null && totalCount > rows.length && (
        <div className="chart-note">Top {rows.length} of {totalCount} — the full list is in the table below.</div>
      )}
      <Tip tip={tip} />
    </div>
  );
}

export interface ColumnPoint {
  key: string;
  /** Tick label under the column (e.g. "Jan"). */
  label: string;
  value: number;
  detail?: [string, string][];
}

/** Round up to a clean axis maximum (1/2/2.5/5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * p) return m * p;
  }
  return 10 * p;
}

/**
 * Columns over a fixed period (the twelve months). Hairline grid with clean
 * ticks; direct labels only on the peak and the latest non-zero column — the
 * tooltip and the table carry the rest.
 */
export function Columns({ points }: { points: ColumnPoint[] }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const peakIdx = points.reduce((bi, p, i) => (p.value > points[bi].value ? i : bi), 0);
  let lastIdx = -1;
  points.forEach((p, i) => { if (p.value > 0) lastIdx = i; });
  const ticks = [0.25, 0.5, 0.75, 1];
  const fmt = (v: number) => v.toLocaleString();

  if (points.every((p) => p.value === 0)) {
    return <p className="muted chart-empty">Nothing to chart for this period.</p>;
  }

  return (
    <div className="chart-body" onMouseLeave={() => setTip(null)}>
      <div className="col-plot">
        {ticks.map((t) => (
          <div key={t} className="col-grid" style={{ bottom: `${t * 100}%` }}>
            <span className="col-tick">{fmt(max * t)}</span>
          </div>
        ))}
        <div className="col-cols">
          {points.map((p, i) => (
            <div
              key={p.key}
              className="col-slot"
              onMouseMove={(e) => {
                const host = (e.currentTarget as HTMLElement).closest(".chart-body") as HTMLElement;
                setTip({
                  ...tipPos(e, host),
                  title: p.label,
                  value: fmt(p.value),
                  detail: p.detail ?? [],
                });
              }}
            >
              {(i === peakIdx || i === lastIdx) && p.value > 0 && (
                <span className="col-cap">{fmt(p.value)}</span>
              )}
              <div className="col-bar" style={{ height: `${(p.value / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="col-labels">
        {points.map((p) => <span key={p.key}>{p.label}</span>)}
      </div>
      <Tip tip={tip} />
    </div>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** One value per bucket; null = nothing to plot there (the line gaps). */
  values: (number | null)[];
}

/**
 * Multi-series lines over time buckets — one colored line per welder, a
 * legend for identity, and a crosshair that snaps to the nearest bucket and
 * reads out EVERY series at that point (values lead, names follow).
 */
export function MultiLine({
  series, buckets, fmt, bucketLabel,
}: {
  series: LineSeries[];
  buckets: string[];
  fmt: (v: number) => string;
  bucketLabel: (b: string) => string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 720));
    ro.observe(el);
    setW(el.clientWidth || 720);
    return () => ro.disconnect();
  }, []);

  const H = 240, PADL = 46, PADR = 14, PADT = 10, PADB = 24;
  const n = buckets.length;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values.filter((v): v is number => v != null)), 0));
  const x = (i: number) => (n <= 1 ? (PADL + w - PADR) / 2 : PADL + (i / (n - 1)) * (w - PADL - PADR));
  const y = (v: number) => PADT + (1 - v / max) * (H - PADT - PADB);
  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(Math.round(v * 100) / 100));

  if (series.length === 0 || n === 0) {
    return <p className="muted chart-empty">No welds with a welder and date in this period.</p>;
  }

  // Thin the x labels so they never collide: at most ~8 shown.
  const stepLab = Math.max(1, Math.ceil(n / 8));

  // Split each series into contiguous segments (gaps where value is null).
  const segs = series.map((s) => {
    const out: { xs: number; pts: [number, number][] }[] = [];
    let cur: [number, number][] = [];
    s.values.forEach((v, i) => {
      if (v == null) {
        if (cur.length) { out.push({ xs: 0, pts: cur }); cur = []; }
      } else cur.push([x(i), y(v)]);
    });
    if (cur.length) out.push({ xs: 0, pts: cur });
    return out;
  });

  const onMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (n <= 1) { setHoverIdx(0); return; }
    const idx = Math.round(((mx - PADL) / (w - PADL - PADR)) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const hover = hoverIdx != null ? hoverIdx : null;
  const hoverRows = hover != null
    ? series
        .map((s) => ({ s, v: s.values[hover] }))
        .filter((r) => r.v != null)
        .sort((a, b) => (b.v as number) - (a.v as number))
    : [];

  return (
    <div className="chart-body" ref={hostRef} onMouseLeave={() => setHoverIdx(null)}>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="chart-legend-item">
            <span className="chart-legend-line" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg width={w} height={H} onMouseMove={onMove} style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={PADL} x2={w - PADR} y1={y(max * t)} y2={y(max * t)} className="ml-grid" />
            <text x={PADL - 6} y={y(max * t) + 3.5} className="ml-tick">{fmtTick(max * t)}</text>
          </g>
        ))}
        <line x1={PADL} x2={w - PADR} y1={y(0)} y2={y(0)} className="ml-axis" />
        {buckets.map((b, i) =>
          i % stepLab === 0 || i === n - 1 ? (
            <text key={b} x={x(i)} y={H - 6} className="ml-xlab">{bucketLabel(b)}</text>
          ) : null,
        )}
        {hover != null && n > 0 && (
          <line x1={x(hover)} x2={x(hover)} y1={PADT} y2={H - PADB} className="ml-crosshair" />
        )}
        {segs.map((sg, si) => (
          <g key={series[si].key}>
            {sg.map((seg, gi) =>
              seg.pts.length === 1 ? (
                <circle key={gi} cx={seg.pts[0][0]} cy={seg.pts[0][1]} r={4} fill={series[si].color} stroke="var(--surface)" strokeWidth={2} />
              ) : (
                <polyline
                  key={gi}
                  points={seg.pts.map(([px, py]) => `${px},${py}`).join(" ")}
                  fill="none"
                  stroke={series[si].color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            )}
            {hover != null && series[si].values[hover] != null && (
              <circle cx={x(hover)} cy={y(series[si].values[hover] as number)} r={4} fill={series[si].color} stroke="var(--surface)" strokeWidth={2} />
            )}
          </g>
        ))}
      </svg>
      {hover != null && hoverRows.length > 0 && (
        <div
          className="chart-tip"
          style={{ left: Math.min(x(hover) + 14, w - 200), top: 34 }}
        >
          <div className="chart-tip-title">{bucketLabel(buckets[hover])}</div>
          {hoverRows.map(({ s, v }) => (
            <div key={s.key} className="chart-tip-row">
              <span><span className="chart-legend-line" style={{ background: s.color }} /> {s.label}</span>
              <b>{fmt(v as number)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
