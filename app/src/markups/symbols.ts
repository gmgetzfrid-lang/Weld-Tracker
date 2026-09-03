// Isometric piping symbols for the Tool Chest.
//
// Drawn the way fittings appear on a piping isometric, not a P&ID. Every
// component is organised by how it joins the pipe — butt weld, socket weld or
// threaded — because that is the only thing that changes between a butt-weld
// gate valve and a threaded one. Flanges are not a separate family: any
// valve, elbow, tee or reducer can be flanged, in which case the flange set
// sits between the component and the pipe and the pipe-side joint mark shows
// how the flange itself is attached (weld neck = dot, socket weld = socket,
// threaded = tick).
//
// Joint marks:
//   butt weld     a dot on the line at the weld
//   socket weld   the socket: a half-square bracket whose closed side sits
//                 on the component and whose open side faces the pipe that
//                 slips into it
//   threaded      a short tick across the line
//   flange set    two parallel faces with a clear gap — no pipe drawn between
//
// The pipe line never runs through a component body: it stops at the valve
// body, the reducer, the flange faces. Elbows and tees are the pipe itself,
// so their arms meet.
//
// Geometry lives in the unit box (0..1, y down), centre (0.5, 0.5). Angles
// are screen angles in degrees, 0° = right, counter-clockwise positive, so the
// iso axes are 30° (east), 150° (north), 90° (up) and their opposites.
import { registerSymbolNames, type Prim, type Pt, type ToolTemplate } from "./model";

/** How the component joins the pipe. `flg` is legacy data — it now reads as a flanged butt-weld fitting. */
export type Joint = "bw" | "sw" | "thd" | "flg" | "none";
export const JOINT_LABEL: Record<Joint, string> = { bw: "Butt weld", sw: "Socket weld", thd: "Threaded", flg: "Flanged", none: "Plain" };

/** Which arm layout a fitting needs. */
export type FitKind =
  | "mark"    // a joint mark on an existing line (run axis only)
  | "inline"  // sits in the run: valves, reducers, couplings, flanges, supports
  | "end"     // one arm: cap, plug, blind
  | "elbow"   // two arms (any two iso directions)
  | "tee"     // run + one branch
  | "free";   // orientation-free: north arrow, tie-in, delete…

export interface IsoSpec {
  fitting: string;
  joint: Joint;
  /** run direction — any of the twelve iso directions (0..330). This is the
   *  lead end `a`: a cap or blind closes toward it, a reducer's small end and
   *  a check valve's flow side point this way. Symmetric fittings look the
   *  same for `run` and `run + 180`. */
  run: number;
  /** elbow arms (two directions) */
  arms?: [number, number];
  /** tee / olet branch direction */
  branch?: number;
  /** mirror stems / branches to the other side of the run (eccentric reducer: flat side up) */
  flip?: boolean;
  /** flanged ends: a flange set between the component and the pipe */
  flanged?: boolean;
}

export interface FittingDef {
  key: string;
  name: string;
  kind: FitKind;
  /** joint types this fitting can be drawn with */
  joints: Joint[];
  /** px at 100% zoom when placed */
  size: number;
  /** can be drawn with flanged ends */
  flangeable?: boolean;
  /** is itself a flange — the flange faces are always drawn */
  flange?: boolean;
}

const PIPE: Joint[] = ["bw", "sw", "thd"];

export const FITTINGS: FittingDef[] = [
  // marks
  { key: "weld", name: "Weld (shop)", kind: "mark", joints: ["bw"], size: 22 },
  { key: "fieldweld", name: "Field weld", kind: "mark", joints: ["bw"], size: 30 },
  { key: "joint", name: "Joint mark", kind: "mark", joints: ["sw", "thd"], size: 26 },
  // fittings
  { key: "elbow", name: "Elbow", kind: "elbow", joints: PIPE, size: 40, flangeable: true },
  { key: "tee", name: "Tee", kind: "tee", joints: PIPE, size: 40, flangeable: true },
  { key: "reducer", name: "Reducer (conc.)", kind: "inline", joints: PIPE, size: 40, flangeable: true },
  { key: "reducer_ecc", name: "Reducer (ecc.)", kind: "inline", joints: PIPE, size: 40, flangeable: true },
  { key: "cap", name: "Cap", kind: "end", joints: PIPE, size: 30 },
  { key: "olet", name: "O-let", kind: "tee", joints: PIPE, size: 40 },
  { key: "coupling", name: "Coupling", kind: "inline", joints: ["sw", "thd"], size: 34 },
  { key: "union", name: "Union", kind: "inline", joints: ["sw", "thd"], size: 36 },
  { key: "nipple", name: "Nipple", kind: "inline", joints: ["thd"], size: 30 },
  { key: "plug", name: "Plug", kind: "end", joints: ["thd"], size: 28 },
  // flanges — always flanged; the joint says how the flange meets the pipe
  { key: "flange_joint", name: "Flange set", kind: "inline", joints: PIPE, size: 44, flange: true },
  { key: "flange", name: "Flange (single)", kind: "end", joints: PIPE, size: 36, flange: true },
  { key: "blind", name: "Blind flange", kind: "end", joints: PIPE, size: 40, flange: true },
  { key: "spectacle", name: "Spectacle blind", kind: "inline", joints: PIPE, size: 46, flange: true },
  { key: "orifice", name: "Orifice flange", kind: "inline", joints: PIPE, size: 46, flange: true },
  // valves
  { key: "gate", name: "Gate valve", kind: "inline", joints: PIPE, size: 44, flangeable: true },
  { key: "globe", name: "Globe valve", kind: "inline", joints: PIPE, size: 44, flangeable: true },
  { key: "ball", name: "Ball valve", kind: "inline", joints: PIPE, size: 44, flangeable: true },
  { key: "check", name: "Check valve", kind: "inline", joints: PIPE, size: 44, flangeable: true },
  { key: "control", name: "Control valve", kind: "inline", joints: PIPE, size: 46, flangeable: true },
  { key: "butterfly", name: "Butterfly valve", kind: "inline", joints: ["bw"], size: 42, flangeable: true },
  { key: "needle", name: "Needle valve", kind: "inline", joints: ["sw", "thd"], size: 42 },
  { key: "plugvalve", name: "Plug valve", kind: "inline", joints: PIPE, size: 44, flangeable: true },
  { key: "psv", name: "Relief valve (PSV)", kind: "tee", joints: PIPE, size: 46, flangeable: true },
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

/** The collapsible categories in the Tool Chest — one per way of joining pipe. */
export interface SymbolCategory { key: string; name: string; joint: Joint | null; items: { fitting: string; label?: string }[] }
const VALVES = [
  { fitting: "gate" }, { fitting: "globe" }, { fitting: "ball" }, { fitting: "check" }, { fitting: "control" }, { fitting: "plugvalve" }, { fitting: "psv" },
];
const FLANGES = [{ fitting: "flange_joint" }, { fitting: "flange" }, { fitting: "blind" }];
export const CATEGORIES: SymbolCategory[] = [
  { key: "bw", name: "Butt weld", joint: "bw", items: [
    { fitting: "weld" }, { fitting: "fieldweld" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "reducer" }, { fitting: "reducer_ecc" }, { fitting: "cap" }, { fitting: "olet", label: "Weldolet" },
    ...FLANGES, { fitting: "spectacle" }, { fitting: "orifice" },
    ...VALVES, { fitting: "butterfly" },
  ] },
  { key: "sw", name: "Socket weld", joint: "sw", items: [
    { fitting: "joint", label: "SW joint" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "coupling" }, { fitting: "union" }, { fitting: "reducer", label: "Reducer insert" }, { fitting: "cap" }, { fitting: "olet", label: "Sockolet" },
    ...FLANGES,
    ...VALVES, { fitting: "needle" },
  ] },
  { key: "thd", name: "Threaded", joint: "thd", items: [
    { fitting: "joint", label: "THD joint" }, { fitting: "elbow" }, { fitting: "tee" }, { fitting: "coupling" }, { fitting: "union" }, { fitting: "nipple" }, { fitting: "plug" }, { fitting: "cap" }, { fitting: "olet", label: "Thredolet" },
    ...FLANGES,
    ...VALVES, { fitting: "needle" },
  ] },
  { key: "supports", name: "Supports & marks", joint: "none", items: [
    { fitting: "anchor" }, { fitting: "guide" }, { fitting: "shoe" }, { fitting: "hanger" }, { fitting: "spring" }, { fitting: "trunnion" }, { fitting: "flow" }, { fitting: "spool" }, { fitting: "vent" }, { fitting: "drain" }, { fitting: "slope" }, { fitting: "tiein" }, { fitting: "instr" }, { fitting: "north" }, { fitting: "delta" }, { fitting: "delete" },
  ] },
];

/** The twelve iso directions, every 30°. */
export const DIRECTIONS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Quick-pick run axes (the compass gives every direction; these are the four common ones). */
export const RUN_AXES: { deg: number; label: string; glyph: string }[] = [
  { deg: 30, label: "30° iso axis", glyph: "⟋" },
  { deg: 150, label: "150° iso axis", glyph: "⟍" },
  { deg: 90, label: "Vertical", glyph: "│" },
  { deg: 0, label: "Flat", glyph: "—" },
];
/** Normalise any angle to 0..359. */
export const normDeg = (d: number): number => ((Math.round(d) % 360) + 360) % 360;
/** The axis (0..179) a direction lies on. */
export const axisOf = (d: number): number => normDeg(d) % 180;

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
/** A run of pipe along `deg`, from radius `from` to `to`. */
const arm = (deg: number, from = 0, to = 0.5): Prim => line([at(deg, from), at(deg, to)]);

/** Pipe-connection joint (never the legacy flanged value). */
type PipeJoint = "bw" | "sw" | "thd" | "none";

/**
 * The joint mark where pipe meets a component, `r` out along `deg`. The
 * socket weld is the socket itself: a half-square whose closed side sits on
 * the component (at `r`) and whose legs run out along the pipe, open end
 * facing the pipe that slips into it.
 */
function jointMark(joint: PipeJoint, deg: number, r: number): Prim[] {
  switch (joint) {
    case "bw": return [dot(at(deg, r))];
    case "sw": {
      const q = perpUp(deg), h = 0.085, depth = 0.11;
      const base = at(deg, r), tip = at(deg, r + depth);
      return [line([at(q, h, tip), at(q, h, base), at(q + 180, h, base), at(q + 180, h, tip)], { width: 2.2 })];
    }
    case "thd": return [tick(at(deg, r), deg, 0.2, 2.6)];
    default: return [];
  }
}

/** Two flange faces across `deg`, the nearer at `r`, with a clear gap between. */
const FLG_GAP = 0.09;
function flangeFaces(deg: number, r: number, len = 0.42): Prim[] {
  return [tick(at(deg, r), deg, len, 2.4), tick(at(deg, r + FLG_GAP), deg, len, 2.4)];
}

/**
 * The end of a component whose body edge is `rBody` out along `deg`: pipe
 * from the end to the box edge, the joint mark, and — when flanged — the
 * flange set between body and pipe (no line drawn across the gasket gap).
 */
function endOf(j: PipeJoint, flanged: boolean, deg: number, rBody: number, faceLen = 0.42): Prim[] {
  if (!flanged) return [arm(deg, rBody), ...jointMark(j, deg, rBody)];
  const f1 = rBody + 0.035;              // face bolted to the component
  const f2 = f1 + FLG_GAP;               // face on the pipe side
  return [
    arm(deg, rBody, f1),
    ...flangeFaces(deg, f1, faceLen),
    arm(deg, f2),
    ...jointMark(j, deg, f2 + 0.06),
  ];
}

/** Bowtie valve body along the run, with the given end marks and a stem. */
function valveBody(spec: IsoSpec, j: PipeJoint, flanged: boolean, opts: { stem?: boolean; center?: Prim[]; check?: boolean } = {}): Prim[] {
  const a = spec.run, b = spec.run + 180;
  const up = perpUp(a);
  const stemDir = spec.flip ? up + 180 : up;
  const h = 0.16, L = flanged ? 0.2 : 0.26;
  const out: Prim[] = [];
  if (opts.check) {
    // one triangle pointing with flow (toward `a`), flat seat on the other side
    const tip = at(a, L), base = at(b, L);
    out.push(line([at(up, h, base), at(up + 180, h, base), tip], { closed: true }));
    out.push(tick(tip, a, 0.32, 2.6));
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
  for (const d of [a, b]) out.push(...endOf(j, flanged, d, L, 0.36));
  return out;
}

/** Resolve legacy "flg" into a flanged butt-weld fitting. */
function normalize(spec: IsoSpec): { j: PipeJoint; flanged: boolean } {
  const f = FITTING_BY_KEY[spec.fitting];
  if (spec.joint === "flg") return { j: "bw", flanged: true };
  const j: PipeJoint = spec.joint === "none" ? "none" : spec.joint;
  const flanged = !!spec.flanged && !!f?.flangeable;
  return { j, flanged };
}

/** Generate the unit-box primitives for a fitting spec. */
export function isoPrims(spec: IsoSpec): Prim[] {
  const f = FITTING_BY_KEY[spec.fitting];
  if (!f) return [];
  const a = spec.run, b = spec.run + 180;
  const up = perpUp(a);
  const side = spec.flip ? up + 180 : up; // branch / stem / large-end side
  const { j, flanged } = normalize(spec);
  const e = { x: C, y: C };
  switch (spec.fitting) {
    // ---- marks ------------------------------------------------------------
    case "weld": return [dot(e, 0.09)];
    case "fieldweld": {
      const top = at(side, 0.34);
      return [dot(e, 0.08), line([e, top]), line([top, at(side - 40 * (spec.flip ? -1 : 1), 0.44), at(side, 0.2)], { closed: true, fill: true })];
    }
    case "joint": return jointMark(j === "bw" ? "sw" : j, a, j === "sw" ? -0.055 : 0); // centred on the line
    // ---- fittings ---------------------------------------------------------
    case "elbow": {
      const [p, q] = spec.arms ?? [a, side];
      const rb = flanged ? 0.14 : 0.3;
      return flanged
        ? [line([at(p, rb), e, at(q, rb)]), ...endOf(j, flanged, p, rb, 0.34), ...endOf(j, flanged, q, rb, 0.34)]
        : [arm(p), arm(q), ...jointMark(j, p, rb), ...jointMark(j, q, rb)];
    }
    case "tee": {
      const br = spec.branch ?? side;
      const rb = flanged ? 0.14 : 0.34;
      return flanged
        ? [line([at(a, rb), at(b, rb)]), line([e, at(br, rb)]), ...endOf(j, flanged, a, rb, 0.34), ...endOf(j, flanged, b, rb, 0.34), ...endOf(j, flanged, br, rb, 0.34)]
        : [arm(a), arm(b), arm(br), ...jointMark(j, a, rb), ...jointMark(j, b, rb), ...jointMark(j, br, rb)];
    }
    case "olet": {
      const br = spec.branch ?? side;
      const saddle: Prim = { kind: "path", d: `M ${at(br + 90, 0.15).x} ${at(br + 90, 0.15).y} A 0.15 0.15 0 0 ${dir(br).y <= 0 ? 1 : 0} ${at(br - 90, 0.15).x} ${at(br - 90, 0.15).y}` };
      return [arm(a), arm(b), line([at(br, 0.15), at(br, 0.5)]), saddle, ...jointMark(j, br, 0.36)];
    }
    case "reducer": case "reducer_ecc": {
      // The run direction `a` is the small end; for the eccentric reducer
      // `flip` moves the flat side from the bottom to the top.
      const ecc = spec.fitting === "reducer_ecc";
      const big = ecc ? b : (spec.flip ? a : b), small = ecc ? a : (spec.flip ? b : a);
      const rb = flanged ? 0.14 : 0.2;
      const bigE = at(big, rb), smallE = at(small, rb);
      const hb = 0.2, hs = 0.11;
      const top = spec.flip && ecc ? up + 180 : up, bottom = top + 180;
      const body = ecc
        ? line([at(top, hb, bigE), at(bottom, hb, bigE), at(bottom, hb, smallE), at(top, hb - (hb - hs) * 2, smallE)], { closed: true })
        : line([at(top, hb, bigE), at(bottom, hb, bigE), at(bottom, hs, smallE), at(top, hs, smallE)], { closed: true });
      return [body, ...endOf(j, flanged, a, rb, 0.36), ...endOf(j, flanged, b, rb, 0.36)];
    }
    case "cap": {
      // pipe comes from `b`; the cap closes toward `a`, bulging that way
      const mid = at(a, 0.18, e);
      const capArc: Prim = { kind: "path", d: `M ${at(up, 0.18, e).x} ${at(up, 0.18, e).y} Q ${mid.x + (mid.x - e.x) * 0.55} ${mid.y + (mid.y - e.y) * 0.55} ${at(up + 180, 0.18, e).x} ${at(up + 180, 0.18, e).y}` };
      return [line([at(up, 0.18, e), at(up + 180, 0.18, e)]), capArc, ...endOf(j, false, b, 0)];
    }
    case "plug": return [{ kind: "rect", x: e.x - 0.07, y: e.y - 0.07, w: 0.14, h: 0.14, fill: true }, ...endOf("thd", false, b, 0.07)];
    case "coupling": {
      const rect = line([at(up, 0.17, at(a, 0.13, e)), at(up, 0.17, at(b, 0.13, e)), at(up + 180, 0.17, at(b, 0.13, e)), at(up + 180, 0.17, at(a, 0.13, e))], { closed: true });
      return [rect, ...endOf(j, false, a, 0.13), ...endOf(j, false, b, 0.13)];
    }
    case "union": return [
      tick(at(a, 0.1), a, 0.3, 2.4), tick(at(b, 0.1), b, 0.3, 2.4), tick(e, a, 0.4, 1.6), line([at(a, 0.1), at(b, 0.1)]),
      ...endOf(j, false, a, 0.1), ...endOf(j, false, b, 0.1),
    ];
    case "nipple": return [line([at(a, 0.3), at(b, 0.3)], { width: 3 }), ...endOf("thd", false, a, 0.3), ...endOf("thd", false, b, 0.3)];
    // ---- flanges (always a flange set; the joint says how it meets the pipe) --
    case "flange_joint": return [
      tick(at(a, FLG_GAP / 2), a, 0.42, 2.4), tick(at(b, FLG_GAP / 2), a, 0.42, 2.4),
      arm(a, FLG_GAP / 2), arm(b, FLG_GAP / 2),
      ...jointMark(j, a, FLG_GAP / 2 + 0.07), ...jointMark(j, b, FLG_GAP / 2 + 0.07),
    ];
    case "flange": return [tick(e, a, 0.42, 2.6), arm(b), ...jointMark(j, b, 0.07)];
    case "blind": {
      // pipe flange on the `b` side, the solid blind on the `a` side, gap between
      const r = line([at(up, 0.2, at(a, 0.05, e)), at(up, 0.2, at(a, 0.14, e)), at(up + 180, 0.2, at(a, 0.14, e)), at(up + 180, 0.2, at(a, 0.05, e))], { closed: true, fill: true });
      return [tick(at(b, 0.045), a, 0.42, 2.4), r, arm(b, 0.045), ...jointMark(j, b, 0.115)];
    }
    case "spectacle": {
      const s = at(side, 0.32);
      return [
        tick(at(a, FLG_GAP / 2), a, 0.42, 2.4), tick(at(b, FLG_GAP / 2), a, 0.42, 2.4), arm(a, FLG_GAP / 2), arm(b, FLG_GAP / 2),
        ...jointMark(j, a, FLG_GAP / 2 + 0.07), ...jointMark(j, b, FLG_GAP / 2 + 0.07),
        { kind: "circle", cx: at(a, 0.09, s).x, cy: at(a, 0.09, s).y, r: 0.075 }, { kind: "circle", cx: at(b, 0.09, s).x, cy: at(b, 0.09, s).y, r: 0.075, fill: true },
      ];
    }
    case "orifice": return [
      tick(at(a, FLG_GAP / 2), a, 0.42, 2.4), tick(at(b, FLG_GAP / 2), a, 0.42, 2.4), arm(a, FLG_GAP / 2), arm(b, FLG_GAP / 2),
      ...jointMark(j, a, FLG_GAP / 2 + 0.07), ...jointMark(j, b, FLG_GAP / 2 + 0.07),
      { kind: "circle", cx: C, cy: C, r: 0.035 }, line([at(side, 0.18), at(side, 0.34)]), dot(at(side, 0.34), 0.035),
    ];
    // ---- valves -----------------------------------------------------------
    case "gate": return valveBody(spec, j, flanged);
    case "globe": return valveBody(spec, j, flanged, { center: [dot(e, 0.075)] });
    case "ball": return valveBody(spec, j, flanged, { center: [{ kind: "circle", cx: C, cy: C, r: 0.1 }] });
    case "check": return valveBody(spec, j, flanged, { stem: false, check: true });
    case "control": {
      const body = valveBody(spec, j, flanged, { stem: false });
      const s = at(side, 0.26);
      return [...body, line([e, s]), { kind: "path", d: `M ${at(a, 0.16, s).x} ${at(a, 0.16, s).y} A 0.16 0.16 0 0 ${dir(side).y <= 0 ? 1 : 0} ${at(b, 0.16, s).x} ${at(b, 0.16, s).y} Z` }];
    }
    case "butterfly": {
      const rb = 0.14;
      return [tick(at(a, rb), a, 0.4, 2), tick(at(b, rb), b, 0.4, 2), line([at(a + 60, 0.19, e), at(a + 240, 0.19, e)]), dot(e, 0.05), ...endOf(j, flanged, a, rb, 0.34), ...endOf(j, flanged, b, rb, 0.34)];
    }
    case "needle": return valveBody(spec, j, false, { center: [line([e, at(side, 0.12)], { width: 3 })] });
    case "plugvalve": {
      return valveBody(spec, j, flanged, { center: [line([at(up, 0.06, at(a, 0.05, e)), at(up, 0.06, at(b, 0.05, e)), at(up + 180, 0.06, at(b, 0.05, e)), at(up + 180, 0.06, at(a, 0.05, e))], { closed: true, fill: true })] });
    }
    case "psv": {
      // angle valve: inlet from `b`, outlet along the branch, spring on top
      const br = spec.branch ?? side;
      const L = flanged ? 0.2 : 0.28;
      const inlet = at(b, L), outlet = at(br, L);
      const stem = br + 90 * (dir(br + 90).y <= dir(br - 90).y ? 1 : -1);
      return [
        line([at(perpUp(b), 0.14, inlet), at(perpUp(b) + 180, 0.14, inlet), e], { closed: true }),
        line([at(perpUp(br), 0.14, outlet), at(perpUp(br) + 180, 0.14, outlet), e], { closed: true }),
        line([e, at(stem, 0.22)]),
        line([at(stem, 0.22), at(stem + 60, 0.3), at(stem - 60, 0.36), at(stem + 60, 0.42), at(stem, 0.46)]),
        ...endOf(j, flanged, b, L, 0.32), ...endOf(j, flanged, br, L, 0.32),
      ];
    }
    // ---- supports ---------------------------------------------------------
    case "anchor": { const d = side + 180; return [arm(a), arm(b), line([e, at(d, 0.28)]), line([at(perpUp(d), 0.16, at(d, 0.3)), at(perpUp(d) + 180, 0.16, at(d, 0.3)), at(d, 0.1)], { closed: true, fill: true })]; }
    case "guide": return [arm(a), arm(b), tick(at(a, 0.12), a, 0.44, 2.4), tick(at(b, 0.12), b, 0.44, 2.4)];
    case "shoe": {
      const d = side + 180; const base = at(d, 0.24), foot = at(d, 0.4);
      return [arm(a), arm(b), line([at(a, 0.16, at(d, 0.06)), at(a, 0.16, base), at(b, 0.16, base), at(b, 0.16, at(d, 0.06))], { closed: true }), line([at(a, 0.3, foot), at(b, 0.3, foot)], { width: 2.6 })];
    }
    case "hanger": { const d = side; return [arm(a), arm(b), line([e, at(d, 0.46)]), tick(at(d, 0.46), d, 0.3, 2.6), tick(e, d, 0.22, 3)]; }
    case "spring": {
      const d = side; const pts: Pt[] = [e, at(d, 0.1)];
      for (let i = 0; i < 4; i++) pts.push(at(d + (i % 2 ? -1 : 1) * 40, 0.14 + i * 0.07));
      pts.push(at(d, 0.42), at(d, 0.48));
      return [arm(a), arm(b), line(pts), tick(at(d, 0.48), d, 0.3, 2.6)];
    }
    case "trunnion": { const d = side + 180; return [arm(a), arm(b), line([at(a, 0.07), at(a, 0.07, at(d, 0.34))]), line([at(b, 0.07), at(b, 0.07, at(d, 0.34))]), tick(at(d, 0.36), d, 0.36, 2.6)]; }
    // ---- marks & misc -----------------------------------------------------
    case "flow": { const d = spec.flip ? b : a; return [line([at(d + 180, 0.4), at(d, 0.12)], { width: 2.4 }), line([at(d, 0.42), at(perpUp(d), 0.18, at(d, 0.08)), at(perpUp(d) + 180, 0.18, at(d, 0.08))], { closed: true, fill: true })]; }
    case "spool": { const t = (p: Pt) => line([at(a + 70, 0.22, p), at(a + 250, 0.22, p)], { width: 2.2 }); return [arm(a), arm(b), t(at(a, 0.06, e)), t(at(b, 0.06, e))]; }
    case "vent": case "drain": {
      const d = spec.fitting === "vent" ? side : side + 180;
      return [arm(a), arm(b), line([e, at(d, 0.3)]), tick(at(d, 0.3), d, 0.22, 2.2), { kind: "text", x: at(d, 0.42).x, y: at(d, 0.42).y, text: spec.fitting === "vent" ? "V" : "D", size: 0.22, bold: true }];
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

/** Can this spec be drawn with flanged ends? */
export function canFlange(fitting: string): boolean {
  return !!FITTING_BY_KEY[fitting]?.flangeable;
}

export function specName(spec: IsoSpec, label?: string): string {
  const f = FITTING_BY_KEY[spec.fitting];
  if (!f) return spec.fitting;
  const { j, flanged } = normalize(spec);
  const base = label ?? f.name;
  if (spec.joint === "none" || j === "none") return base;
  const tag = { bw: "BW", sw: "SW", thd: "THD", none: "" }[j];
  const parts = [flanged ? "flanged" : "", tag].filter(Boolean);
  return parts.length ? `${base} (${parts.join(", ")})` : base;
}

/** A Tool Chest template for a fitting spec. */
export function isoTemplate(spec: IsoSpec, stroke: string, label?: string): ToolTemplate {
  const f = FITTING_BY_KEY[spec.fitting];
  const { flanged } = normalize(spec);
  const size = Math.round((f?.size ?? 36) * (flanged ? 1.2 : 1));
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
