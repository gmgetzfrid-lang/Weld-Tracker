// Isometric piping symbols for the Tool Chest.
//
// These are drawn the way fittings appear on a piping isometric, not a P&ID:
// the pipe run is a line, a butt weld is a dot on it, a socket weld is the
// socket face (a tick) with its fillet dot, a threaded joint is a tick, a
// flange is a pair of parallel lines. Every fitting is generated from a spec —
// which joint type, which iso axis the run follows, where the branch or the
// second elbow arm goes — so the same elbow can point any of the twelve iso
// directions and a valve can be butt-welded, socket-welded, threaded or
// flanged without a separate drawing for each.
//
// Geometry lives in the unit box (0..1, y down), centre (0.5, 0.5). Angles
// are screen angles in degrees, 0° = right, counter-clockwise positive, so the
// iso axes are 30° (east), 150° (north), 90° (up) and their opposites.
import { registerSymbolNames, type Prim, type Pt, type ToolTemplate } from "./model";

export type Joint = "bw" | "sw" | "thd" | "flg" | "none";
export const JOINT_LABEL: Record<Joint, string> = { bw: "Butt weld", sw: "Socket weld", thd: "Threaded", flg: "Flanged", none: "Plain" };

/** Which arm layout a fitting needs. */
export type FitKind =
  | "mark"    // a joint mark on an existing line (run axis only)
  | "inline"  // sits in the run: valves, reducers, couplings, flanges, supports
  | "end"     // one arm: cap, plug
  | "elbow"   // two arms (any two iso directions)
  | "tee"     // run + one branch
  | "free";   // orientation-free: north arrow, tie-in, delete…

export interface IsoSpec {
  fitting: string;
  joint: Joint;
  /** run axis angle, 0..179 (30 = E-W, 150 = N-S, 90 = up-down, 0 = flat) */
  run: number;
  /** elbow arms (two directions) */
  arms?: [number, number];
  /** tee / olet branch direction */
  branch?: number;
  /** mirror stems / branches / large end */
  flip?: boolean;
}

export interface FittingDef {
  key: string;
  name: string;
  kind: FitKind;
  /** joint types this fitting can be drawn with */
  joints: Joint[];
  /** px at 100% zoom when placed */
  size: number;
}

export const FITTINGS: FittingDef[] = [
  // marks
  { key: "weld", name: "Weld (shop)", kind: "mark", joints: ["bw"], size: 22 },
  { key: "fieldweld", name: "Field weld", kind: "mark", joints: ["bw"], size: 30 },
  { key: "joint", name: "Joint mark", kind: "mark", joints: ["sw", "thd", "flg"], size: 26 },
  // fittings
  { key: "elbow", name: "Elbow", kind: "elbow", joints: ["bw", "sw", "thd", "flg"], size: 40 },
  { key: "tee", name: "Tee", kind: "tee", joints: ["bw", "sw", "thd", "flg"], size: 40 },
  { key: "reducer", name: "Reducer (conc.)", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 40 },
  { key: "reducer_ecc", name: "Reducer (ecc.)", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 40 },
  { key: "cap", name: "Cap", kind: "end", joints: ["bw", "sw", "thd"], size: 34 },
  { key: "olet", name: "O-let", kind: "tee", joints: ["bw", "sw", "thd"], size: 40 },
  { key: "coupling", name: "Coupling", kind: "inline", joints: ["sw", "thd"], size: 36 },
  { key: "union", name: "Union", kind: "inline", joints: ["sw", "thd"], size: 36 },
  { key: "nipple", name: "Nipple", kind: "inline", joints: ["thd"], size: 34 },
  { key: "plug", name: "Plug", kind: "end", joints: ["thd"], size: 30 },
  // flanges
  { key: "flange_joint", name: "Flanged joint", kind: "inline", joints: ["flg"], size: 34 },
  { key: "flange", name: "Flange", kind: "inline", joints: ["flg"], size: 30 },
  { key: "blind", name: "Blind flange", kind: "end", joints: ["flg"], size: 32 },
  { key: "spectacle", name: "Spectacle blind", kind: "inline", joints: ["flg"], size: 40 },
  { key: "orifice", name: "Orifice flange", kind: "inline", joints: ["flg"], size: 40 },
  // valves
  { key: "gate", name: "Gate valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 44 },
  { key: "globe", name: "Globe valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 44 },
  { key: "ball", name: "Ball valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 44 },
  { key: "check", name: "Check valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 44 },
  { key: "control", name: "Control valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 46 },
  { key: "butterfly", name: "Butterfly valve", kind: "inline", joints: ["flg", "bw"], size: 42 },
  { key: "needle", name: "Needle valve", kind: "inline", joints: ["sw", "thd"], size: 42 },
  { key: "plugvalve", name: "Plug valve", kind: "inline", joints: ["bw", "sw", "thd", "flg"], size: 44 },
  { key: "psv", name: "Relief valve (PSV)", kind: "tee", joints: ["flg", "thd", "sw"], size: 46 },
  // supports
  { key: "anchor", name: "Anchor", kind: "inline", joints: ["none"], size: 34 },
  { key: "guide", name: "Guide", kind: "inline", joints: ["none"], size: 34 },
  { key: "shoe", name: "Pipe shoe", kind: "inline", joints: ["none"], size: 34 },
  { key: "hanger", name: "Hanger", kind: "inline", joints: ["none"], size: 36 },
  { key: "spring", name: "Spring hanger", kind: "inline", joints: ["none"], size: 40 },
  { key: "trunnion", name: "Trunnion / dummy leg", kind: "inline", joints: ["none"], size: 36 },
  // marks & misc
  { key: "flow", name: "Flow arrow", kind: "inline", joints: ["none"], size: 30 },
  { key: "spool", name: "Spool break", kind: "inline", joints: ["none"], size: 30 },
  { key: "vent", name: "Vent", kind: "inline", joints: ["none"], size: 32 },
  { key: "drain", name: "Drain", kind: "inline", joints: ["none"], size: 32 },
  { key: "slope", name: "Slope", kind: "inline", joints: ["none"], size: 28 },
  { key: "tiein", name: "Tie-in point", kind: "free", joints: ["none"], size: 34 },
  { key: "instr", name: "Instrument", kind: "free", joints: ["none"], size: 32 },
  { key: "north", name: "North arrow", kind: "free", joints: ["none"], size: 36 },
  { key: "delta", name: "Revision triangle", kind: "free", joints: ["none"], size: 30 },
  { key: "delete", name: "Delete (X)", kind: "free", joints: ["none"], size: 26 },
];

export const FITTING_BY_KEY: Record<string, FittingDef> = Object.fromEntries(FITTINGS.map((f) => [f.key, f]));

/** The collapsible categories in the Tool Chest. */
export interface SymbolCategory { key: string; name: string; joint: Joint | null; items: { fitting: string; label?: string }[] }
export const CATEGORIES: SymbolCategory[] = [
  { key: "bw", name: "Butt weld", joint: "bw", items: [
    { fitting: "weld" }, { fitting: "fieldweld" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "reducer" }, { fitting: "reducer_ecc" }, { fitting: "cap" }, { fitting: "olet", label: "Weldolet" },
  ] },
  { key: "sw", name: "Socket weld", joint: "sw", items: [
    { fitting: "joint", label: "SW joint" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "coupling" }, { fitting: "union" }, { fitting: "reducer", label: "Reducer insert" }, { fitting: "cap" }, { fitting: "olet", label: "Sockolet" },
  ] },
  { key: "thd", name: "Threaded", joint: "thd", items: [
    { fitting: "joint", label: "THD joint" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "coupling" }, { fitting: "union" }, { fitting: "nipple" }, { fitting: "plug" }, { fitting: "cap" }, { fitting: "olet", label: "Thredolet" },
  ] },
  { key: "flg", name: "Flanged", joint: "flg", items: [
    { fitting: "flange_joint" }, { fitting: "flange" }, { fitting: "blind" }, { fitting: "spectacle" }, { fitting: "orifice" }, { fitting: "elbow", label: "Flanged elbow" }, { fitting: "tee", label: "Flanged tee" }, { fitting: "reducer", label: "Flanged reducer" },
  ] },
  { key: "valves", name: "Valves", joint: null, items: [
    { fitting: "gate" }, { fitting: "globe" }, { fitting: "ball" }, { fitting: "check" }, { fitting: "control" }, { fitting: "butterfly" }, { fitting: "needle" }, { fitting: "plugvalve" }, { fitting: "psv" },
  ] },
  { key: "supports", name: "Supports & marks", joint: "none", items: [
    { fitting: "anchor" }, { fitting: "guide" }, { fitting: "shoe" }, { fitting: "hanger" }, { fitting: "spring" }, { fitting: "trunnion" }, { fitting: "flow" }, { fitting: "spool" }, { fitting: "vent" }, { fitting: "drain" }, { fitting: "slope" }, { fitting: "tiein" }, { fitting: "instr" }, { fitting: "north" }, { fitting: "delta" }, { fitting: "delete" },
  ] },
];

/** The twelve iso directions, every 30°. */
export const DIRECTIONS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Run axes (a direction and its opposite share an axis). */
export const RUN_AXES: { deg: number; label: string; glyph: string }[] = [
  { deg: 30, label: "East–West (30°)", glyph: "⟋" },
  { deg: 150, label: "North–South (150°)", glyph: "⟍" },
  { deg: 90, label: "Up–Down", glyph: "│" },
  { deg: 0, label: "Flat (0°)", glyph: "—" },
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const C = 0.5;
const rad = (d: number) => (d * Math.PI) / 180;
const dir = (deg: number): Pt => ({ x: Math.cos(rad(deg)), y: -Math.sin(rad(deg)) });
const at = (deg: number, r: number, c: Pt = { x: C, y: C }): Pt => { const d = dir(deg); return { x: c.x + d.x * r, y: c.y + d.y * r }; };
/** Perpendicular that points "up-ish" on screen (so stems read upright). */
const perpUp = (deg: number): number => { const p = deg + 90; return dir(p).y <= 0 ? p : deg - 90; };
const line = (pts: Pt[], extra: Partial<Extract<Prim, { kind: "line" }>> = {}): Prim => ({ kind: "line", pts, ...extra });
const dot = (p: Pt, r = 0.05): Prim => ({ kind: "circle", cx: p.x, cy: p.y, r, fill: true });
const tick = (p: Pt, deg: number, len: number, width = 2.4): Prim => {
  const q = perpUp(deg);
  return line([at(q, len / 2, p), at(q + 180, len / 2, p)], { width });
};
const arm = (deg: number, from = 0, to = 0.5): Prim => line([at(deg, from), at(deg, to)]);

/** The joint mark at the end of an arm pointing `deg`, `r` from centre. */
function jointMark(joint: Joint, deg: number, r: number): Prim[] {
  switch (joint) {
    case "bw": return [dot(at(deg, r))];
    case "sw": return [tick(at(deg, r - 0.03), deg, 0.16), dot(at(deg, r + 0.06), 0.042)];
    case "thd": return [tick(at(deg, r), deg, 0.2, 2.6)];
    case "flg": return [tick(at(deg, r - 0.04), deg, 0.24, 2.4), tick(at(deg, r + 0.04), deg, 0.24, 2.4)];
    default: return [];
  }
}

/** Bowtie valve body along the run, with the given end marks and a stem. */
function valveBody(spec: IsoSpec, opts: { stem?: boolean; center?: Prim[]; check?: boolean } = {}): Prim[] {
  const a = spec.run, b = spec.run + 180;
  const out: Prim[] = [arm(a), arm(b)];
  const up = perpUp(a);
  const stemDir = spec.flip ? up + 180 : up;
  const h = 0.17, L = 0.28;
  if (opts.check) {
    // one triangle pointing with flow (toward `a`), flat seat on the other side
    const tip = at(a, L), base = at(b, L);
    out.push(line([at(up, h, base), at(up + 180, h, base), tip], { closed: true }));
    out.push(tick(tip, a, 0.34, 2.6));
  } else {
    for (const d of [a, b]) {
      const e = at(d, L);
      out.push(line([at(up, h, e), at(up + 180, h, e), { x: C, y: C }], { closed: true }));
    }
  }
  if (opts.stem !== false) {
    out.push(line([{ x: C, y: C }, at(stemDir, 0.3)]));
    out.push(tick(at(stemDir, 0.3), stemDir, 0.26, 2.2));
  }
  if (opts.center) out.push(...opts.center);
  for (const d of [a, b]) out.push(...jointMark(spec.joint, d, 0.42));
  return out;
}

/** Generate the unit-box primitives for a fitting spec. */
export function isoPrims(spec: IsoSpec): Prim[] {
  const f = FITTING_BY_KEY[spec.fitting];
  if (!f) return [];
  const a = spec.run, b = spec.run + 180;
  const up = perpUp(a);
  const side = spec.flip ? up + 180 : up; // branch / stem / large-end side
  const j = spec.joint;
  switch (spec.fitting) {
    // ---- marks ------------------------------------------------------------
    case "weld": return [dot({ x: C, y: C }, 0.09)];
    case "fieldweld": {
      const top = at(side, 0.34);
      return [dot({ x: C, y: C }, 0.08), line([{ x: C, y: C }, top]), line([top, at(side - 40 * (spec.flip ? -1 : 1), 0.44), at(side, 0.2)], { closed: true, fill: true })];
    }
    case "joint": return jointMark(j === "bw" ? "sw" : j, a, 0).map((p) => p); // mark centred on the line
    // ---- fittings ---------------------------------------------------------
    case "elbow": {
      const [p, q] = spec.arms ?? [a, side];
      return [arm(p), arm(q), ...jointMark(j, p, 0.3), ...jointMark(j, q, 0.3)];
    }
    case "tee": {
      const br = spec.branch ?? side;
      return [arm(a), arm(b), arm(br), ...jointMark(j, a, 0.34), ...jointMark(j, b, 0.34), ...jointMark(j, br, 0.34)];
    }
    case "olet": {
      const br = spec.branch ?? side;
      const saddle: Prim = { kind: "path", d: `M ${at(br + 90, 0.15).x} ${at(br + 90, 0.15).y} A 0.15 0.15 0 0 ${dir(br).y <= 0 ? 1 : 0} ${at(br - 90, 0.15).x} ${at(br - 90, 0.15).y}` };
      return [arm(a), arm(b), line([at(br, 0.15), at(br, 0.5)]), saddle, ...jointMark(j, br, 0.36)];
    }
    case "reducer": case "reducer_ecc": {
      const big = spec.flip ? a : b, small = spec.flip ? b : a;
      const ecc = spec.fitting === "reducer_ecc";
      const bigE = at(big, 0.2), smallE = at(small, 0.2);
      const hb = 0.2, hs = 0.11;
      const top = up, bottom = up + 180;
      const body = ecc
        ? line([at(top, hb, bigE), at(bottom, hb, bigE), at(bottom, hb, smallE), at(top, hb - (hb - hs) * 2, smallE)], { closed: true })
        : line([at(top, hb, bigE), at(bottom, hb, bigE), at(bottom, hs, smallE), at(top, hs, smallE)], { closed: true });
      return [arm(a, 0.2), arm(b, 0.2), body, ...jointMark(j, a, 0.3), ...jointMark(j, b, 0.3)];
    }
    case "cap": {
      // pipe comes from `b`; the cap closes toward `a`
      const e = { x: C, y: C };
      const capPath: Prim = { kind: "path", d: `M ${at(up, 0.18, e).x} ${at(up, 0.18, e).y} A 0.18 0.18 0 0 ${dir(a).y <= dir(up).y ? 1 : 0} ${at(up + 180, 0.18, e).x} ${at(up + 180, 0.18, e).y}` };
      // ensure the arc bulges toward `a`: compute sweep from geometry
      const mid = at(a, 0.18, e);
      const capArc: Prim = { kind: "path", d: `M ${at(up, 0.18, e).x} ${at(up, 0.18, e).y} Q ${mid.x + (mid.x - e.x) * 0.55} ${mid.y + (mid.y - e.y) * 0.55} ${at(up + 180, 0.18, e).x} ${at(up + 180, 0.18, e).y}` };
      void capPath;
      return [arm(b), line([at(up, 0.18, e), at(up + 180, 0.18, e)]), capArc, ...jointMark(j, b, 0.3)];
    }
    case "plug": {
      const e = { x: C, y: C };
      return [arm(b), { kind: "rect", x: e.x - 0.07, y: e.y - 0.07, w: 0.14, h: 0.14, fill: true }, ...jointMark("thd", b, 0.3)];
    }
    case "coupling": {
      const e = { x: C, y: C };
      const rect = line([at(up, 0.17, at(a, 0.13, e)), at(up, 0.17, at(b, 0.13, e)), at(up + 180, 0.17, at(b, 0.13, e)), at(up + 180, 0.17, at(a, 0.13, e))], { closed: true });
      return [arm(a), arm(b), rect, ...jointMark(j, a, 0.3), ...jointMark(j, b, 0.3)];
    }
    case "union": return [arm(a), arm(b), tick(at(a, 0.1), a, 0.3, 2.4), tick(at(b, 0.1), b, 0.3, 2.4), tick({ x: C, y: C }, a, 0.4, 1.6), ...jointMark(j, a, 0.32), ...jointMark(j, b, 0.32)];
    case "nipple": return [line([at(a, 0.3), at(b, 0.3)], { width: 3 }), arm(a, 0.3), arm(b, 0.3), ...jointMark("thd", a, 0.3), ...jointMark("thd", b, 0.3)];
    // ---- flanges ----------------------------------------------------------
    case "flange_joint": return [arm(a), arm(b), tick(at(a, 0.05), a, 0.34, 2.6), tick(at(b, 0.05), b, 0.34, 2.6)];
    case "flange": return [arm(a), arm(b), tick({ x: C, y: C }, a, 0.36, 3)];
    case "blind": {
      const e = { x: C, y: C };
      const r = line([at(up, 0.17, at(a, 0.04, e)), at(up, 0.17, at(a, 0.14, e)), at(up + 180, 0.17, at(a, 0.14, e)), at(up + 180, 0.17, at(a, 0.04, e))], { closed: true, fill: true });
      return [arm(b), tick(at(b, 0.02), a, 0.36, 2.6), r];
    }
    case "spectacle": {
      const s = at(side, 0.3);
      return [arm(a), arm(b), tick(at(a, 0.05), a, 0.34, 2.6), tick(at(b, 0.05), b, 0.34, 2.6),
        { kind: "circle", cx: at(a, 0.09, s).x, cy: at(a, 0.09, s).y, r: 0.08 }, { kind: "circle", cx: at(b, 0.09, s).x, cy: at(b, 0.09, s).y, r: 0.08, fill: true }];
    }
    case "orifice": return [arm(a), arm(b), tick(at(a, 0.07), a, 0.36, 2.6), tick(at(b, 0.07), b, 0.36, 2.6), { kind: "circle", cx: C, cy: C, r: 0.06 }, line([at(side, 0.18), at(side, 0.34)]), dot(at(side, 0.34), 0.035)];
    // ---- valves -----------------------------------------------------------
    case "gate": return valveBody(spec);
    case "globe": return valveBody(spec, { center: [dot({ x: C, y: C }, 0.075)] });
    case "ball": return valveBody(spec, { center: [{ kind: "circle", cx: C, cy: C, r: 0.1 }] });
    case "check": return valveBody(spec, { stem: false, check: true });
    case "control": {
      const body = valveBody(spec, { stem: false });
      const s = at(side, 0.26);
      return [...body, line([{ x: C, y: C }, s]), { kind: "path", d: `M ${at(a, 0.16, s).x} ${at(a, 0.16, s).y} A 0.16 0.16 0 0 ${dir(side).y <= 0 ? 1 : 0} ${at(b, 0.16, s).x} ${at(b, 0.16, s).y} Z` }];
    }
    case "butterfly": {
      const e = { x: C, y: C };
      return [arm(a), arm(b), tick(at(a, 0.14), a, 0.4, 2), tick(at(b, 0.14), b, 0.4, 2), line([at(a + 60, 0.19, e), at(a + 240, 0.19, e)]), dot(e, 0.05), ...jointMark(j, a, 0.36), ...jointMark(j, b, 0.36)];
    }
    case "needle": return valveBody(spec, { center: [line([{ x: C, y: C }, at(side, 0.12)], { width: 3 })] });
    case "plugvalve": {
      const e = { x: C, y: C };
      return valveBody(spec, { center: [line([at(up, 0.06, at(a, 0.05, e)), at(up, 0.06, at(b, 0.05, e)), at(up + 180, 0.06, at(b, 0.05, e)), at(up + 180, 0.06, at(a, 0.05, e))], { closed: true, fill: true })] });
    }
    case "psv": {
      // angle valve: inlet from `b`, outlet along the branch, spring on top
      const br = spec.branch ?? side;
      const e = { x: C, y: C };
      const inlet = at(b, 0.28), outlet = at(br, 0.28);
      const stem = br + 90 * (dir(br + 90).y <= dir(br - 90).y ? 1 : -1);
      return [
        arm(b), line([e, at(br, 0.5)]),
        line([at(perpUp(b), 0.14, inlet), at(perpUp(b) + 180, 0.14, inlet), e], { closed: true }),
        line([at(perpUp(br), 0.14, outlet), at(perpUp(br) + 180, 0.14, outlet), e], { closed: true }),
        line([e, at(stem, 0.22)]),
        line([at(stem, 0.22), at(stem + 60, 0.3), at(stem - 60, 0.36), at(stem + 60, 0.42), at(stem, 0.46)]),
        ...jointMark(j, b, 0.42), ...jointMark(j, br, 0.42),
      ];
    }
    // ---- supports ---------------------------------------------------------
    case "anchor": { const d = side + 180; return [arm(a), arm(b), line([{ x: C, y: C }, at(d, 0.28)]), line([at(perpUp(d) , 0.16, at(d, 0.3)), at(perpUp(d) + 180, 0.16, at(d, 0.3)), at(d, 0.1)], { closed: true, fill: true })]; }
    case "guide": return [arm(a), arm(b), tick(at(a, 0.12), a, 0.44, 2.4), tick(at(b, 0.12), b, 0.44, 2.4)];
    case "shoe": {
      const d = side + 180; const base = at(d, 0.24), foot = at(d, 0.4);
      return [arm(a), arm(b), line([at(a, 0.16, at(d, 0.06)), at(a, 0.16, base), at(b, 0.16, base), at(b, 0.16, at(d, 0.06))], { closed: true }), line([at(a, 0.3, foot), at(b, 0.3, foot)], { width: 2.6 })];
    }
    case "hanger": { const d = side; return [arm(a), arm(b), line([{ x: C, y: C }, at(d, 0.46)]), tick(at(d, 0.46), d, 0.3, 2.6), tick({ x: C, y: C }, d, 0.22, 3)]; }
    case "spring": {
      const d = side; const pts: Pt[] = [{ x: C, y: C }, at(d, 0.1)];
      for (let i = 0; i < 4; i++) pts.push(at(d + (i % 2 ? -1 : 1) * 40, 0.14 + i * 0.07));
      pts.push(at(d, 0.42), at(d, 0.48));
      return [arm(a), arm(b), line(pts), tick(at(d, 0.48), d, 0.3, 2.6)];
    }
    case "trunnion": { const d = side + 180; return [arm(a), arm(b), line([at(a, 0.07), at(a, 0.07, at(d, 0.34))]), line([at(b, 0.07), at(b, 0.07, at(d, 0.34))]), tick(at(d, 0.36), d, 0.36, 2.6)]; }
    // ---- marks & misc -----------------------------------------------------
    case "flow": { const d = spec.flip ? b : a; return [line([at(d + 180, 0.4), at(d, 0.12)], { width: 2.4 }), line([at(d, 0.42), at(perpUp(d), 0.18, at(d, 0.08)), at(perpUp(d) + 180, 0.18, at(d, 0.08))], { closed: true, fill: true })]; }
    case "spool": { const e = { x: C, y: C }; const t = (p: Pt) => line([at(a + 70, 0.22, p), at(a + 250, 0.22, p)], { width: 2.2 }); return [arm(a), arm(b), t(at(a, 0.06, e)), t(at(b, 0.06, e))]; }
    case "vent": case "drain": {
      const d = spec.fitting === "vent" ? side : side + 180;
      return [arm(a), arm(b), line([{ x: C, y: C }, at(d, 0.3)]), tick(at(d, 0.3), d, 0.22, 2.2), { kind: "text", x: at(d, 0.42).x, y: at(d, 0.42).y, text: spec.fitting === "vent" ? "V" : "D", size: 0.22, bold: true }];
    }
    case "slope": { const d = spec.flip ? b : a; return [arm(a), arm(b), line([at(side, 0.06, at(d + 180, 0.3)), at(side, 0.06, at(d, 0.3)), at(side, 0.26, at(d, 0.3))], { closed: true, fill: true })]; }
    case "tiein": return [line([{ x: C, y: 0.06 }, { x: 0.94, y: C }, { x: C, y: 0.94 }, { x: 0.06, y: C }], { closed: true, width: 2.2 }), { kind: "text", x: C, y: 0.56, text: "TP", size: 0.34, bold: true }];
    case "instr": return [{ kind: "circle", cx: C, cy: C, r: 0.42 }, line([{ x: 0.08, y: C }, { x: 0.92, y: C }])];
    case "north": return [line([{ x: C, y: 0.96 }, { x: C, y: 0.3 }]), line([{ x: 0.32, y: 0.4 }, { x: C, y: 0.04 }, { x: 0.68, y: 0.4 }, { x: C, y: 0.3 }], { closed: true, fill: true }), { kind: "text", x: C, y: 0.86, text: "N", size: 0.3, bold: true }];
    case "delta": return [line([{ x: C, y: 0.08 }, { x: 0.94, y: 0.9 }, { x: 0.06, y: 0.9 }], { closed: true, width: 2.2 })];
    case "delete": return [line([{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.88 }], { width: 2.6 }), line([{ x: 0.88, y: 0.12 }, { x: 0.12, y: 0.88 }], { width: 2.6 })];
  }
  return [];
}

/** Default joint for a fitting within a category. */
export function defaultJoint(f: FittingDef, cat: Joint | null): Joint {
  if (cat && f.joints.includes(cat)) return cat;
  return f.joints[0];
}

export function specName(spec: IsoSpec, label?: string): string {
  const f = FITTING_BY_KEY[spec.fitting];
  if (!f) return spec.fitting;
  if (label) return label;
  if (spec.joint === "none" || f.joints.length === 1) return f.name;
  const tag = { bw: "BW", sw: "SW", thd: "THD", flg: "FLG", none: "" }[spec.joint];
  return tag ? `${f.name} (${tag})` : f.name;
}

/** A Tool Chest template for a fitting spec. */
export function isoTemplate(spec: IsoSpec, stroke: string, label?: string): ToolTemplate {
  const f = FITTING_BY_KEY[spec.fitting];
  const size = f?.size ?? 36;
  return {
    kind: "group",
    d: {
      style: { stroke, width: 2, dash: "solid", fill: null, fillOpacity: 1, opacity: 1, fontSize: 14 },
      box: { x: 0, y: 0, w: 1, h: 1 }, rot: 0, flip: false,
      items: isoPrims(spec), symbol: spec.fitting, iso: spec,
    },
    sizePx: { w: size, h: size },
    mode: "drawing",
  };
}

registerSymbolNames(Object.fromEntries(FITTINGS.map((f) => [f.key, f.name])));

// Back-compat for anything still importing the old names.
export const SYMBOLS = FITTINGS;
export function symbolTemplate(key: string, stroke: string): ToolTemplate | null {
  const f = FITTING_BY_KEY[key];
  if (!f) return null;
  return isoTemplate({ fitting: key, joint: f.joints[0], run: 30 }, stroke);
}
