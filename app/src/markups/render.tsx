// SVG rendering of markups — one renderer for the live canvas and the
// flattened PDF export, so what you see is exactly what prints.
import type React from "react";
import type { Weld } from "../types";
import {
  arrowHead, bboxPx, cloudPath, smoothPath, wrapText,
  type Box, type Dash, type Handle, type PM, type Prim, type Pt, type Style,
} from "./model";

const FONT = "Segoe UI, Arial, Helvetica, sans-serif";

export function dashArray(dash: Dash | undefined, width: number): string | undefined {
  if (dash === "dash") return `${width * 4} ${width * 2.5}`;
  if (dash === "dot") return `${width} ${width * 2}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Group primitives (unit box → pixels via a scale transform)
// ---------------------------------------------------------------------------

function PrimEl({ p, style, z, sx, sy }: { p: Prim; style: Style; z: number; sx: number; sy: number }) {
  const stroke = style.stroke;
  const sw = ((p.kind === "text" || p.kind === "group") ? style.width : (p.width ?? style.width)) * z;
  const common = { stroke, strokeWidth: sw, vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (p.kind) {
    case "line": {
      const pts = p.pts.map((q) => `${q.x},${q.y}`).join(" ");
      const fill = p.fill ? stroke : "none";
      const da = dashArray(p.dash, sw);
      // Arrowheads are drawn in unit space sized against the mean box scale.
      const hs = (10 * z) / Math.max(1, (sx + sy) / 2);
      const heads: React.ReactNode[] = [];
      if (p.arrowEnd && p.pts.length >= 2) heads.push(<path key="e" d={arrowHead(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1], hs)} fill={stroke} stroke="none" />);
      if (p.arrowStart && p.pts.length >= 2) heads.push(<path key="s" d={arrowHead(p.pts[1], p.pts[0], hs)} fill={stroke} stroke="none" />);
      return (
        <>
          {p.closed ? <polygon points={pts} fill={fill} {...common} strokeDasharray={da} /> : <polyline points={pts} fill={fill} {...common} strokeDasharray={da} />}
          {heads}
        </>
      );
    }
    case "path": return <path d={p.d} fill={p.fill ? stroke : "none"} {...common} strokeDasharray={dashArray(p.dash, sw)} />;
    case "circle": return <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ? stroke : "none"} {...common} strokeDasharray={dashArray(p.dash, sw)} />;
    case "ellipse": return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill ? stroke : "none"} {...common} strokeDasharray={dashArray(p.dash, sw)} />;
    case "rect": return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ? stroke : "none"} {...common} strokeDasharray={dashArray(p.dash, sw)} />;
    case "text": return (
      <text x={p.x} y={p.y} fontSize={p.size} fontFamily={FONT} fontWeight={p.bold ? 700 : 400} fill={stroke} textAnchor="middle" dominantBaseline="central" style={{ userSelect: "none" }}>{p.text}</text>
    );
    case "group": {
      const t = `translate(${p.box.x} ${p.box.y}) ${p.rot ? `rotate(${p.rot} ${p.box.w / 2} ${p.box.h / 2})` : ""} ${p.flip ? `translate(${p.box.w} 0) scale(-1 1)` : ""} scale(${p.box.w} ${p.box.h})`;
      return <g transform={t}>{p.items.map((it, i) => <PrimEl key={i} p={it} style={style} z={z} sx={sx * p.box.w} sy={sy * p.box.h} />)}</g>;
    }
  }
}

export function GroupEl({ items, box, rot, flip, style, z, W, H }: {
  items: Prim[]; box: Box; rot?: number; flip?: boolean; style: Style; z: number; W: number; H: number;
}) {
  const px = box.x * W, py = box.y * H, pw = Math.max(1e-3, box.w * W), ph = Math.max(1e-3, box.h * H);
  const t = `translate(${px} ${py}) ${rot ? `rotate(${rot} ${pw / 2} ${ph / 2})` : ""} ${flip ? `translate(${pw} 0) scale(-1 1)` : ""} scale(${pw} ${ph})`;
  return <g transform={t}>{items.map((it, i) => <PrimEl key={i} p={it} style={style} z={z} sx={pw} sy={ph} />)}</g>;
}

// ---------------------------------------------------------------------------
// One markup
// ---------------------------------------------------------------------------

export interface MarkupHandlers {
  onGrab?: (pm: PM, e: React.MouseEvent) => void;
  onContext?: (pm: PM, e: React.MouseEvent) => void;
  onDouble?: (pm: PM, e: React.MouseEvent) => void;
}

/** Where a callout's leader leaves its box: the edge midpoint nearest the tip. */
function leaderStart(b: Box, a: Pt): Pt {
  const cands: Pt[] = [
    { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 },
    { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 },
  ];
  return cands.reduce((best, c) => (Math.hypot(c.x - a.x, c.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y) ? c : best));
}

export function MarkupEl({ pm, W, H, z, interactive, h, editingText }: {
  pm: PM; W: number; H: number; z: number; interactive: boolean; h?: MarkupHandlers; editingText?: boolean;
}) {
  const d = pm.d, s = d.style;
  const sw = s.width * z;
  const da = dashArray(s.dash, sw);
  const hitW = Math.max(12 * z, sw * 3);
  const P = (p: Pt): Pt => ({ x: p.x * W, y: p.y * H });
  const common = { stroke: s.stroke, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeDasharray: da };
  const fill = s.fill ? s.fill : "none";
  const gProps = interactive
    ? {
        onMouseDown: (e: React.MouseEvent) => h?.onGrab?.(pm, e),
        onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); h?.onContext?.(pm, e); },
        onDoubleClick: (e: React.MouseEvent) => h?.onDouble?.(pm, e),
        style: { cursor: pm.locked ? "not-allowed" : "move" },
      }
    : {};
  let body: React.ReactNode = null;
  switch (pm.kind) {
    case "line": case "arrow": case "dimension": {
      const pts = (d.pts ?? []).map(P);
      if (pts.length < 2) break;
      const [a, b] = pts;
      const isArrow = pm.kind === "arrow" || s.arrowEnd;
      const parts: React.ReactNode[] = [
        <line key="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={hitW} />,
        <line key="l" x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />,
      ];
      if (pm.kind !== "dimension") {
        if (isArrow) parts.push(<path key="he" d={arrowHead(a, b, 10 * z + sw * 2)} fill={s.stroke} stroke="none" />);
        if (s.arrowStart) parts.push(<path key="hs" d={arrowHead(b, a, 10 * z + sw * 2)} fill={s.stroke} stroke="none" />);
      } else {
        // Dimension: perpendicular ticks and a label above the midpoint.
        const ang = Math.atan2(b.y - a.y, b.x - a.x), tl = 7 * z;
        const nx = Math.sin(ang) * tl, ny = -Math.cos(ang) * tl;
        parts.push(<line key="t1" x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} {...common} strokeDasharray={undefined} />);
        parts.push(<line key="t2" x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} {...common} strokeDasharray={undefined} />);
        const mx = (a.x + b.x) / 2 + nx * 1.6, my = (a.y + b.y) / 2 + ny * 1.6;
        const label = d.text?.trim() || (interactive ? "?" : "");
        if (label && !editingText) {
          parts.push(
            <text key="lab" x={mx} y={my} fontSize={s.fontSize * z} fontFamily={FONT} fill={s.stroke} textAnchor="middle" dominantBaseline="central"
              stroke="#fff" strokeWidth={3 * z} paintOrder="stroke" style={{ userSelect: "none" }}>{label}</text>,
          );
        }
      }
      body = <>{parts}</>;
      break;
    }
    case "polyline": case "pen": {
      const pts = (d.pts ?? []).map(P);
      if (pts.length < 2) break;
      if (pm.kind === "pen" || d.smooth) {
        const path = smoothPath(pts);
        body = <><path d={path} fill="none" stroke="transparent" strokeWidth={hitW} /><path d={path} fill="none" {...common} /></>;
      } else {
        const pstr = pts.map((q) => `${q.x},${q.y}`).join(" ");
        body = <><polyline points={pstr} fill="none" stroke="transparent" strokeWidth={hitW} /><polyline points={pstr} fill={fill} fillOpacity={s.fillOpacity} {...common} /></>;
      }
      break;
    }
    case "rect": case "highlight": {
      const b = d.box; if (!b) break;
      if (pm.kind === "highlight") {
        body = <rect x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} fill={s.fill ?? "#facc15"} fillOpacity={0.38} stroke="none" />;
      } else {
        body = <rect x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} fill={fill} fillOpacity={s.fillOpacity} {...common} />;
      }
      break;
    }
    case "ellipse": {
      const b = d.box; if (!b) break;
      body = <ellipse cx={(b.x + b.w / 2) * W} cy={(b.y + b.h / 2) * H} rx={(b.w * W) / 2} ry={(b.h * H) / 2} fill={fill} fillOpacity={s.fillOpacity} {...common} />;
      break;
    }
    case "cloud": {
      const b = d.box; if (!b) break;
      const pb = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
      body = <path d={cloudPath(pb, 9 * z)} fill={fill} fillOpacity={s.fillOpacity} {...common} strokeDasharray={undefined} />;
      break;
    }
    case "text": case "callout": {
      const b = d.box; if (!b) break;
      const pb = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
      const fs = s.fontSize * z, lh = fs * 1.25, pad = 4 * z;
      const lines = wrapText(d.text ?? "", pb.w - pad * 2, fs);
      const parts: React.ReactNode[] = [];
      if (pm.kind === "callout") {
        const a = d.anchor ? P(d.anchor) : { x: pb.x, y: pb.y };
        const from = leaderStart(pb, a);
        parts.push(<line key="lead-hit" x1={from.x} y1={from.y} x2={a.x} y2={a.y} stroke="transparent" strokeWidth={hitW} />);
        parts.push(<line key="lead" x1={from.x} y1={from.y} x2={a.x} y2={a.y} {...common} strokeDasharray={undefined} />);
        parts.push(<path key="head" d={arrowHead(from, a, 10 * z + sw * 2)} fill={s.stroke} stroke="none" />);
        parts.push(<rect key="box" x={pb.x} y={pb.y} width={pb.w} height={pb.h} fill={s.fill ?? "#ffffff"} fillOpacity={s.fill ? s.fillOpacity : 0.9} {...common} strokeDasharray={undefined} />);
      } else {
        parts.push(<rect key="hit" x={pb.x} y={pb.y} width={pb.w} height={pb.h} fill={s.fill ?? "transparent"} fillOpacity={s.fill ? s.fillOpacity : 1} stroke={interactive && !lines.some(Boolean) ? s.stroke : "none"} strokeDasharray={`${3 * z} ${3 * z}`} strokeWidth={z} />);
      }
      if (!editingText) {
        parts.push(
          <text key="t" x={pb.x + pad} y={pb.y + pad + fs * 0.9} fontSize={fs} fontFamily={FONT} fill={s.stroke} style={{ userSelect: "none", whiteSpace: "pre" }}>
            {lines.map((ln, i) => <tspan key={i} x={pb.x + pad} dy={i === 0 ? 0 : lh}>{ln || " "}</tspan>)}
          </text>,
        );
      }
      body = <>{parts}</>;
      break;
    }
    case "group": {
      const b = d.box; if (!b) break;
      const pb = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
      body = (
        <>
          <rect x={pb.x} y={pb.y} width={pb.w} height={pb.h} fill="transparent" stroke="none"
            transform={d.rot ? `rotate(${d.rot} ${pb.x + pb.w / 2} ${pb.y + pb.h / 2})` : undefined} />
          <GroupEl items={d.items ?? []} box={b} rot={d.rot} flip={d.flip} style={s} z={z} W={W} H={H} />
        </>
      );
      break;
    }
  }
  return (
    <g className={`mk ${pm.status === "Resolved" ? "resolved" : ""}`} data-id={pm.id} opacity={s.opacity} {...gProps}>
      {body}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Selection overlay: dashed bbox, resize handles, vertex/anchor/rotate grips.
// ---------------------------------------------------------------------------

export interface GripHandlers {
  onHandle: (pm: PM, h: Handle, e: React.MouseEvent) => void;
  onVertex: (pm: PM, i: number, e: React.MouseEvent) => void;
  onAnchor: (pm: PM, e: React.MouseEvent) => void;
  onRotate: (pm: PM, e: React.MouseEvent) => void;
}

const HANDLES: [Handle, number, number][] = [
  ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5],
];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

export function SelectionEl({ pm, W, H, z, editable, g, multi }: {
  pm: PM; W: number; H: number; z: number; editable: boolean; g: GripHandlers; multi: boolean;
}) {
  const d = pm.d;
  const bb = bboxPx(pm, W, H);
  const hs = 4.5 * z;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const boxKind = !!d.box;
  const rot = pm.kind === "group" ? d.rot ?? 0 : 0;
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  const grips: React.ReactNode[] = [];
  if (editable && !pm.locked && !multi) {
    if (boxKind && pm.kind !== "callout") {
      for (const [hname, fx, fy] of HANDLES) {
        grips.push(
          <rect key={hname} x={bb.x + fx * bb.w - hs} y={bb.y + fy * bb.h - hs} width={hs * 2} height={hs * 2}
            className="mk-grip" style={{ cursor: CURSOR[hname] }}
            onMouseDown={(e) => { stop(e); g.onHandle(pm, hname, e); }} />,
        );
      }
    }
    if (pm.kind === "callout" && d.box) {
      const pb = { x: d.box.x * W, y: d.box.y * H, w: d.box.w * W, h: d.box.h * H };
      for (const [hname, fx, fy] of HANDLES) {
        grips.push(
          <rect key={hname} x={pb.x + fx * pb.w - hs} y={pb.y + fy * pb.h - hs} width={hs * 2} height={hs * 2}
            className="mk-grip" style={{ cursor: CURSOR[hname] }}
            onMouseDown={(e) => { stop(e); g.onHandle(pm, hname, e); }} />,
        );
      }
      if (d.anchor) {
        grips.push(<circle key="anchor" cx={d.anchor.x * W} cy={d.anchor.y * H} r={hs * 1.2} className="mk-grip round" style={{ cursor: "crosshair" }} onMouseDown={(e) => { stop(e); g.onAnchor(pm, e); }} />);
      }
    }
    if (d.pts && (pm.kind !== "pen") && d.pts.length <= 80) {
      d.pts.forEach((p, i) => grips.push(
        <circle key={`v${i}`} cx={p.x * W} cy={p.y * H} r={hs * 1.2} className="mk-grip round" style={{ cursor: "crosshair" }} onMouseDown={(e) => { stop(e); g.onVertex(pm, i, e); }} />,
      ));
    }
    if (pm.kind === "group") {
      const ry = bb.y - 18 * z;
      grips.push(<line key="rl" x1={cx} y1={bb.y} x2={cx} y2={ry} className="mk-sel-line" />);
      grips.push(<circle key="rot" cx={cx} cy={ry} r={hs * 1.3} className="mk-grip rot" style={{ cursor: "grab" }} onMouseDown={(e) => { stop(e); g.onRotate(pm, e); }} />);
    }
  }
  return (
    <g className="mk-sel" transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
      <rect x={bb.x - 2 * z} y={bb.y - 2 * z} width={bb.w + 4 * z} height={bb.h + 4 * z} className={`mk-sel-box ${pm.locked ? "locked" : ""}`} style={{ strokeWidth: z }} />
      {grips}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Export overlay (inline styles only — no stylesheet in the raster)
// ---------------------------------------------------------------------------

export function ExportOverlay({ welds, markups, W, H, legend }: {
  welds: Weld[]; markups: PM[]; W: number; H: number;
  legend: { pos: Pt; totals: [string, number][]; title: string } | null;
}) {
  const R = 17;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`}>
      {markups.map((m) => <MarkupEl key={m.id} pm={m} W={W} H={H} z={1} interactive={false} />)}
      {welds.map((w) => {
        const cx = (w.bubble_x ?? 0) * W, cy = (w.bubble_y ?? 0) * H;
        const jx = (w.joint_x ?? w.bubble_x ?? 0) * W, jy = (w.joint_y ?? w.bubble_y ?? 0) * H;
        const glyph = w.nde_result === "Rejected" ? ["!", "#dc2626"] : w.nde_result === "Accepted" ? ["✓", "#16a34a"] : w.parent_weld_id != null ? ["R", "#7456a5"] : null;
        return (
          <g key={w.id} opacity={w.voided_at ? 0.32 : 1}>
            <line x1={jx} y1={jy} x2={cx} y2={cy} stroke="#e0322c" strokeWidth={1.7} />
            <circle cx={jx} cy={jy} r={2.6} fill="#e0322c" />
            <circle cx={cx} cy={cy} r={R} fill="#fff" stroke="#e0322c" strokeWidth={1.9} />
            <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="#e0322c" strokeWidth={1.4} />
            <text x={cx} y={cy - R * 0.42} fontSize={11} fontWeight={700} fontFamily={FONT} fill="#16233b" textAnchor="middle" dominantBaseline="middle">{w.stamp_number ?? ""}</text>
            <text x={cx} y={cy + R * 0.42} fontSize={11} fontWeight={700} fontFamily={FONT} fill="#16233b" textAnchor="middle" dominantBaseline="middle">{w.weld_number ?? ""}</text>
            {glyph && !w.voided_at && (
              <g>
                <circle cx={cx + R * 0.82} cy={cy - R * 0.82} r={6.4} fill="#fff" stroke={glyph[1]} strokeWidth={1.5} />
                <text x={cx + R * 0.82} y={cy - R * 0.82} fontSize={8.6} fontWeight={800} fontFamily={FONT} fill={glyph[1]} textAnchor="middle" dominantBaseline="central">{glyph[0]}</text>
              </g>
            )}
          </g>
        );
      })}
      {legend && legend.totals.length > 0 && (() => {
        const x = legend.pos.x * W, y = legend.pos.y * H, lw = 170, rowH = 15, lh = 30 + rowH * (legend.totals.length + 1) + 8;
        return (
          <g>
            <rect x={x} y={y} width={lw} height={lh} fill="#fff" fillOpacity={0.97} stroke="#0a1f6b" strokeWidth={1.5} rx={3} />
            <text x={x + 8} y={y + 14} fontSize={9} fontWeight={800} fontFamily={FONT} fill="#0a1f6b" letterSpacing={1}>{legend.title}</text>
            <line x1={x + 6} y1={y + 21} x2={x + lw - 6} y2={y + 21} stroke="#cbd5e1" strokeDasharray="2 2" />
            <text x={x + 8} y={y + 36} fontSize={8.5} fontWeight={700} fontFamily={FONT} fill="#6e7482">WELDER · STAMP</text>
            <text x={x + lw - 8} y={y + 36} fontSize={8.5} fontWeight={700} fontFamily={FONT} fill="#6e7482" textAnchor="end">WELDS</text>
            {legend.totals.map(([stamp, n], i) => (
              <g key={stamp}>
                <text x={x + 8} y={y + 36 + rowH * (i + 1)} fontSize={10.5} fontFamily={FONT} fill="#16233b">{stamp}</text>
                <text x={x + lw - 8} y={y + 36 + rowH * (i + 1)} fontSize={10.5} fontWeight={700} fontFamily={FONT} fill="#16233b" textAnchor="end">{n}</text>
              </g>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}
