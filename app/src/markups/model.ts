// Markup (redline) model and geometry.
//
// Coordinates: everything stored on a markup is page-normalized — x as a
// fraction of the page width, y as a fraction of the page height — exactly
// like the weld bubbles. Sizes that must stay visually constant (stroke width,
// font size) are stored in pixels at 100% zoom and scaled with the render.
//
// Groups (and every built-in piping symbol) hold their children in a unit box
// (0..1 × 0..1) and are placed through a `box` + rotation, so a flange looks
// the same at any size and can be saved to the Tool Chest as-is.
import type { Markup, MarkupKind } from "../types";

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export type Dash = "solid" | "dash" | "dot";

export interface Style {
  stroke: string;
  /** px at 100% zoom */
  width: number;
  dash: Dash;
  fill: string | null;
  fillOpacity: number;
  opacity: number;
  /** px at 100% zoom */
  fontSize: number;
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export const REDLINE = "#d9261c";
export const PALETTE = ["#d9261c", "#1668d6", "#16a34a", "#111827", "#f97316", "#a21caf", "#0891b2"];
export const HIGHLIGHT = "#facc15";

export const DEFAULT_STYLE: Style = {
  stroke: REDLINE, width: 2, dash: "solid", fill: null, fillOpacity: 0.25, opacity: 1, fontSize: 14,
};

/** A child of a group, in unit-box coordinates. */
export type Prim =
  | { kind: "line"; pts: Pt[]; arrowEnd?: boolean; arrowStart?: boolean; dash?: Dash; fill?: boolean; closed?: boolean; width?: number }
  | { kind: "path"; d: string; fill?: boolean; dash?: Dash; width?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: boolean; dash?: Dash; width?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: boolean; dash?: Dash; width?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill?: boolean; dash?: Dash; width?: number }
  | { kind: "text"; x: number; y: number; text: string; size: number; bold?: boolean }
  | { kind: "group"; box: Box; rot?: number; flip?: boolean; items: Prim[] };

/** Parsed `Markup.data`. Which fields apply depends on the kind. */
export interface MData {
  style: Style;
  /** line / arrow / dimension: 2 points; polyline / pen: many. */
  pts?: Pt[];
  /** rect / ellipse / cloud / highlight / text / callout / group. */
  box?: Box;
  text?: string;
  /** callout leader tip. */
  anchor?: Pt;
  /** group rotation, degrees clockwise. */
  rot?: number;
  flip?: boolean;
  /** group children in the unit box. */
  items?: Prim[];
  /** built-in symbol key, when the group came from the library. */
  symbol?: string;
  /** iso fitting spec (joint type, run axis, arms) the items were generated from. */
  iso?: { fitting: string; joint: "bw" | "sw" | "thd" | "flg" | "none"; run: number; arms?: [number, number]; branch?: number; flip?: boolean };
  /** pen: draw as a smooth curve. */
  smooth?: boolean;
}

/** A markup with its data parsed — what the editor works with. */
export interface PM {
  id: number;
  drawing_id: number;
  page: number;
  kind: MarkupKind;
  d: MData;
  subject: string | null;
  comment: string | null;
  status: "Open" | "Resolved";
  z: number;
  locked: boolean;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export function parseMarkup(m: Markup): PM {
  let d: MData = { style: { ...DEFAULT_STYLE } };
  try {
    const raw = JSON.parse(m.data) as Partial<MData>;
    d = { ...raw, style: { ...DEFAULT_STYLE, ...(raw.style ?? {}) } };
  } catch { /* keep defaults — the record still renders as an empty shape */ }
  return {
    id: m.id, drawing_id: m.drawing_id, page: m.page, kind: m.kind, d,
    subject: m.subject ?? null, comment: m.comment ?? null,
    status: m.status === "Resolved" ? "Resolved" : "Open",
    z: m.z, locked: !!m.locked,
    created_by: m.created_by ?? null, created_at: m.created_at,
    updated_by: m.updated_by ?? null, updated_at: m.updated_at,
  };
}

export function toRow(pm: PM): Markup {
  return {
    id: pm.id, drawing_id: pm.drawing_id, page: pm.page, kind: pm.kind,
    data: JSON.stringify(pm.d), subject: pm.subject, comment: pm.comment,
    status: pm.status, z: pm.z, locked: pm.locked,
    created_by: pm.created_by, created_at: pm.created_at,
    updated_by: pm.updated_by, updated_at: pm.updated_at,
  };
}

export const BOX_KINDS: MarkupKind[] = ["rect", "ellipse", "cloud", "highlight", "text", "callout", "group"];
export const LINE_KINDS: MarkupKind[] = ["line", "arrow", "dimension"];
export const PATH_KINDS: MarkupKind[] = ["polyline", "pen"];

export function kindLabel(k: MarkupKind, d?: MData): string {
  if (k === "group") return d?.symbol ? symbolName(d.symbol) : "Symbol";
  return ({
    line: "Line", arrow: "Arrow", polyline: "Polyline", pen: "Pen", rect: "Rectangle", ellipse: "Ellipse",
    cloud: "Cloud", text: "Text", callout: "Callout", dimension: "Dimension", highlight: "Highlight", group: "Group",
  } as Record<MarkupKind, string>)[k];
}

// Library names are resolved lazily to avoid an import cycle with symbols.ts.
let symbolNames: Record<string, string> = {};
export function registerSymbolNames(map: Record<string, string>) { symbolNames = map; }
export function symbolName(key: string): string { return symbolNames[key] ?? key; }

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Pixel bounding box of a markup on a W×H page. */
export function bboxPx(pm: PM, W: number, H: number): Box {
  const d = pm.d;
  if (d.box) {
    const b = { x: d.box.x * W, y: d.box.y * H, w: d.box.w * W, h: d.box.h * H };
    if (pm.kind === "callout" && d.anchor) return unionBox(b, { x: d.anchor.x * W, y: d.anchor.y * H, w: 0, h: 0 });
    return b;
  }
  const pts = d.pts ?? [];
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x * W); y0 = Math.min(y0, p.y * H); x1 = Math.max(x1, p.x * W); y1 = Math.max(y1, p.y * H); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function normBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

/** Move a markup by a normalized delta. */
export function translated(pm: PM, dx: number, dy: number): PM {
  const d = { ...pm.d };
  if (d.box) d.box = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
  if (d.pts) d.pts = d.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (d.anchor) d.anchor = { x: d.anchor.x + dx, y: d.anchor.y + dy };
  return { ...pm, d };
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Resize a normalized box by dragging one handle by a normalized delta. */
export function resizeBox(b: Box, h: Handle, dx: number, dy: number, keepAspect: boolean, W: number, H: number): Box {
  let { x, y, w, hh } = { x: b.x, y: b.y, w: b.w, hh: b.h };
  if (h.includes("w")) { x += dx; w -= dx; }
  if (h.includes("e")) { w += dx; }
  if (h.includes("n")) { y += dy; hh -= dy; }
  if (h.includes("s")) { hh += dy; }
  if (keepAspect && b.w > 0 && b.h > 0) {
    // Keep the pixel aspect ratio: scale both axes by the larger relative change.
    const sx = w / b.w, sy = hh / b.h;
    const s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    const nw = b.w * s, nh = b.h * s;
    // Anchor the opposite corner.
    if (h.includes("w")) x = b.x + b.w - nw; else x = b.x;
    if (h.includes("n")) y = b.y + b.h - nh; else y = b.y;
    if (h === "n" || h === "s") x = b.x + (b.w - nw) / 2;
    if (h === "e" || h === "w") y = b.y + (b.h - nh) / 2;
    w = nw; hh = nh;
  }
  const min = 6; // px
  if (w * W < min) w = min / W;
  if (hh * H < min) hh = min / H;
  return { x, y, w, h: hh };
}

/** Rotate a point about a center (degrees). */
export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/**
 * Revision-cloud outline around a pixel box: scallops bulging outward, drawn
 * clockwise. `r` is the scallop radius in px.
 */
export function cloudPath(b: Box, r: number): string {
  const R = Math.max(3, r);
  const segs = (len: number) => Math.max(1, Math.round(len / (R * 1.6)));
  const parts: string[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = segs(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      parts.push(`A ${R} ${R} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  };
  parts.push(`M ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
  edge(b.x, b.y, b.x + b.w, b.y);
  edge(b.x + b.w, b.y, b.x + b.w, b.y + b.h);
  edge(b.x + b.w, b.y + b.h, b.x, b.y + b.h);
  edge(b.x, b.y + b.h, b.x, b.y);
  parts.push("Z");
  return parts.join(" ");
}

/** Arrowhead triangle (px) at `tip`, pointing away from `from`. */
export function arrowHead(from: Pt, tip: Pt, size: number): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = size, w = size * 0.5;
  const bx = tip.x - l * Math.cos(a), by = tip.y - l * Math.sin(a);
  const p1 = { x: bx + w * Math.sin(a), y: by - w * Math.cos(a) };
  const p2 = { x: bx - w * Math.sin(a), y: by + w * Math.cos(a) };
  return `M ${tip.x} ${tip.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`;
}

/** Catmull-Rom → cubic Bézier path through pixel points (pen tool). */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Ramer–Douglas–Peucker simplification (px tolerance) for freehand strokes. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const sq = tol * tol;
  const out: Pt[] = [];
  const rec = (a: number, b: number) => {
    let maxD = 0, idx = -1;
    const A = pts[a], B = pts[b];
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      const l2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2;
      let t = l2 ? ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d2 = (P.x - (A.x + t * (B.x - A.x))) ** 2 + (P.y - (A.y + t * (B.y - A.y))) ** 2;
      if (d2 > maxD) { maxD = d2; idx = i; }
    }
    if (maxD > sq && idx > 0) { rec(a, idx); rec(idx, b); }
    else out.push(pts[b]);
  };
  out.push(pts[0]);
  rec(0, pts.length - 1);
  return out;
}

/** Word-wrap text to a pixel width using an average glyph width. */
export function wrapText(text: string, widthPx: number, fontPx: number): string[] {
  const cw = fontPx * 0.56;
  const maxChars = Math.max(1, Math.floor(widthPx / cw));
  const out: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (cand.length <= maxChars) line = cand;
      else {
        if (line) out.push(line);
        if (w.length > maxChars) { for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars)); line = ""; }
        else line = w;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

// ---------------------------------------------------------------------------
// Groups and tools
// ---------------------------------------------------------------------------

/** Turn a markup into unit-box primitives relative to `bb` (px). */
export function toPrims(pm: PM, W: number, H: number, bb: Box): Prim[] {
  const d = pm.d;
  const u = (p: Pt): Pt => ({ x: bb.w ? (p.x * W - bb.x) / bb.w : 0.5, y: bb.h ? (p.y * H - bb.y) / bb.h : 0.5 });
  const ub = (b: Box): Box => ({ x: bb.w ? (b.x * W - bb.x) / bb.w : 0, y: bb.h ? (b.y * H - bb.y) / bb.h : 0, w: bb.w ? (b.w * W) / bb.w : 1, h: bb.h ? (b.h * H) / bb.h : 1 });
  const filled = d.style.fill != null;
  switch (pm.kind) {
    case "line": return [{ kind: "line", pts: (d.pts ?? []).map(u), dash: d.style.dash, width: d.style.width, arrowStart: d.style.arrowStart, arrowEnd: d.style.arrowEnd }];
    case "arrow": return [{ kind: "line", pts: (d.pts ?? []).map(u), dash: d.style.dash, width: d.style.width, arrowEnd: true, arrowStart: d.style.arrowStart }];
    case "dimension": return [{ kind: "line", pts: (d.pts ?? []).map(u), width: d.style.width }];
    case "polyline": return [{ kind: "line", pts: (d.pts ?? []).map(u), dash: d.style.dash, width: d.style.width, fill: filled, closed: false }];
    case "pen": return [{ kind: "line", pts: (d.pts ?? []).map(u), width: d.style.width }];
    case "rect": case "highlight": { const b = ub(d.box!); return [{ kind: "rect", ...b, fill: filled || pm.kind === "highlight", dash: d.style.dash, width: d.style.width }]; }
    case "ellipse": { const b = ub(d.box!); return [{ kind: "ellipse", cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, fill: filled, dash: d.style.dash, width: d.style.width }]; }
    case "cloud": {
      // Clouds are re-drawn from their box on render, so keep them as a rect prim flagged by path-less "cloud" via a group of arcs is overkill; approximate with the scalloped path in unit space.
      const b = ub(d.box!);
      const px = { x: b.x * bb.w, y: b.y * bb.h, w: b.w * bb.w, h: b.h * bb.h };
      // Path in px, then scale to unit by transforming coordinates in the string is messy — emit a unit-space path with r scaled by the mean dimension.
      const r = 9 / Math.max(1, (bb.w + bb.h) / 2);
      return [{ kind: "path", d: cloudPath(b, r), fill: filled, dash: d.style.dash, width: d.style.width }];
      void px;
    }
    case "text": { const b = ub(d.box!); return [{ kind: "text", x: b.x, y: b.y, text: d.text ?? "", size: d.style.fontSize / Math.max(1, bb.h) }]; }
    case "callout": {
      const b = ub(d.box!);
      const a = d.anchor ? u(d.anchor) : { x: b.x, y: b.y };
      return [
        { kind: "rect", ...b, width: d.style.width },
        { kind: "line", pts: [{ x: b.x + b.w / 2, y: b.y + b.h / 2 }, a], arrowEnd: true, width: d.style.width },
        { kind: "text", x: b.x, y: b.y, text: d.text ?? "", size: d.style.fontSize / Math.max(1, bb.h) },
      ];
    }
    case "group": return [{ kind: "group", box: ub(d.box!), rot: d.rot, flip: d.flip, items: d.items ?? [] }];
  }
  return [];
}

/** Combine markups into one group markup (children in the unit box). */
export function groupOf(pms: PM[], W: number, H: number): MData {
  const bb = pms.map((p) => bboxPx(p, W, H)).reduce((a, b) => unionBox(a, b));
  const pad = 2;
  const box: Box = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad * 2, h: bb.h + pad * 2 };
  const items = pms.flatMap((p) => toPrims(p, W, H, box));
  const style = { ...pms[0].d.style };
  return { style, box: { x: box.x / W, y: box.y / H, w: box.w / W, h: box.h / H }, rot: 0, flip: false, items };
}

/** A Tool Chest template built from one or more markups. */
export interface ToolTemplate {
  kind: MarkupKind;
  d: MData;          // for drawing mode: unit-box geometry; for properties mode: style only
  sizePx: { w: number; h: number };
  mode: "drawing" | "properties";
}

export function templateFrom(pms: PM[], W: number, H: number, mode: "drawing" | "properties"): ToolTemplate {
  if (mode === "properties" && pms.length === 1 && pms[0].kind !== "group") {
    const p = pms[0];
    return { kind: p.kind, d: { style: { ...p.d.style } }, sizePx: { w: 0, h: 0 }, mode };
  }
  if (pms.length === 1 && pms[0].kind === "group") {
    const p = pms[0];
    const bb = bboxPx(p, W, H);
    return { kind: "group", d: { ...p.d, box: { x: 0, y: 0, w: 1, h: 1 } }, sizePx: { w: bb.w, h: bb.h }, mode: "drawing" };
  }
  const g = groupOf(pms, W, H);
  const bb = { w: g.box!.w * W, h: g.box!.h * H };
  return { kind: "group", d: { ...g, box: { x: 0, y: 0, w: 1, h: 1 } }, sizePx: bb, mode: "drawing" };
}

/** Instantiate a drawing-mode template centred at a pixel point. */
export function instantiate(t: ToolTemplate, at: Pt, W: number, H: number): { kind: MarkupKind; d: MData } {
  const w = Math.max(8, t.sizePx.w), h = Math.max(8, t.sizePx.h);
  const box: Box = { x: (at.x - w / 2) / W, y: (at.y - h / 2) / H, w: w / W, h: h / H };
  return { kind: "group", d: { ...t.d, box, items: t.d.items ?? [] } };
}
