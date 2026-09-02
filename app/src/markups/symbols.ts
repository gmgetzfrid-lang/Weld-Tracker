// Built-in piping isometric symbols for the Tool Chest ("Piping" set).
//
// Each symbol is a group template in the unit box (0..1, y down): pipe runs
// horizontally through the middle, so a placed symbol sits on a line and can
// be rotated to the run's direction. Strokes are non-scaling so a flange
// looks the same at any size.
import { registerSymbolNames, type Prim, type ToolTemplate } from "./model";

export interface SymbolDef {
  key: string;
  name: string;
  /** px at 100% zoom when first placed */
  size: number;
  items: Prim[];
  /** wider than tall */
  aspect?: number;
}

const L = (pts: [number, number][], extra: Partial<Extract<Prim, { kind: "line" }>> = {}): Prim =>
  ({ kind: "line", pts: pts.map(([x, y]) => ({ x, y })), ...extra });
const C = (cx: number, cy: number, r: number, fill = false): Prim => ({ kind: "circle", cx, cy, r, fill });
const T = (x: number, y: number, text: string, size = 0.36): Prim => ({ kind: "text", x, y, text, size, bold: true });
const P = (d: string, fill = false): Prim => ({ kind: "path", d, fill });

// The pipe run: a stub either side so the symbol reads as "in the line".
const RUN: Prim = L([[0, 0.5], [1, 0.5]]);
// A valve body: two triangles meeting at the centre (the bowtie).
const BOWTIE: Prim[] = [
  L([[0.18, 0.28], [0.18, 0.72], [0.5, 0.5], [0.18, 0.28]], { closed: true }),
  L([[0.82, 0.28], [0.82, 0.72], [0.5, 0.5], [0.82, 0.28]], { closed: true }),
];
const STEM: Prim[] = [L([[0.5, 0.5], [0.5, 0.18]]), L([[0.34, 0.18], [0.66, 0.18]])];

export const SYMBOLS: SymbolDef[] = [
  { key: "flange", name: "Flanged joint", size: 34, items: [RUN, L([[0.42, 0.14], [0.42, 0.86]], { width: 2.4 }), L([[0.58, 0.14], [0.58, 0.86]], { width: 2.4 })] },
  { key: "flange1", name: "Flange", size: 30, items: [L([[0, 0.5], [0.5, 0.5]]), L([[0.5, 0.14], [0.5, 0.86]], { width: 2.6 })] },
  { key: "blind", name: "Blind flange", size: 30, items: [L([[0, 0.5], [0.42, 0.5]]), L([[0.42, 0.14], [0.42, 0.86]], { width: 2.6 }), { kind: "rect", x: 0.5, y: 0.14, w: 0.14, h: 0.72, fill: true }] },
  { key: "gate", name: "Gate valve", size: 36, items: [RUN, ...BOWTIE, ...STEM] },
  { key: "globe", name: "Globe valve", size: 36, items: [RUN, ...BOWTIE, C(0.5, 0.5, 0.1, true), ...STEM] },
  { key: "ball", name: "Ball valve", size: 36, items: [RUN, ...BOWTIE, C(0.5, 0.5, 0.13), ...STEM] },
  { key: "check", name: "Check valve", size: 36, items: [RUN, L([[0.22, 0.26], [0.22, 0.74], [0.78, 0.5], [0.22, 0.26]], { closed: true }), L([[0.78, 0.26], [0.78, 0.74]], { width: 2.4 })] },
  { key: "control", name: "Control valve", size: 38, items: [RUN, ...BOWTIE, L([[0.5, 0.5], [0.5, 0.24]]), P("M 0.3 0.24 A 0.2 0.2 0 0 1 0.7 0.24 Z")] },
  { key: "butterfly", name: "Butterfly valve", size: 34, items: [RUN, L([[0.36, 0.16], [0.36, 0.84]]), L([[0.64, 0.16], [0.64, 0.84]]), L([[0.38, 0.78], [0.62, 0.22]]), C(0.5, 0.5, 0.07, true)] },
  { key: "psv", name: "Relief valve (PSV)", size: 40, items: [L([[0.5, 1], [0.5, 0.62]]), L([[0.3, 0.62], [0.7, 0.62], [0.5, 0.36], [0.3, 0.62]], { closed: true }), L([[0.5, 0.36], [0.5, 0.2]]), L([[0.42, 0.2], [0.58, 0.14], [0.42, 0.08], [0.58, 0.02]]), L([[0.5, 0.49], [0.86, 0.49]])] },
  { key: "elbow90", name: "Elbow 90°", size: 34, items: [L([[0, 0.5], [0.45, 0.5]]), P("M 0.45 0.5 A 0.2 0.2 0 0 1 0.65 0.7"), L([[0.65, 0.7], [0.65, 1]])] },
  { key: "elbow45", name: "Elbow 45°", size: 34, items: [L([[0, 0.5], [0.5, 0.5], [0.92, 0.92]])] },
  { key: "tee", name: "Tee", size: 34, items: [RUN, L([[0.5, 0.5], [0.5, 0]])] },
  { key: "reducer", name: "Reducer (concentric)", size: 36, items: [L([[0, 0.5], [0.24, 0.5]]), L([[0.24, 0.2], [0.24, 0.8], [0.76, 0.64], [0.76, 0.36], [0.24, 0.2]], { closed: true }), L([[0.76, 0.5], [1, 0.5]])] },
  { key: "reducer_ecc", name: "Reducer (eccentric)", size: 36, items: [L([[0, 0.5], [0.24, 0.5]]), L([[0.24, 0.2], [0.24, 0.78], [0.76, 0.78], [0.76, 0.5], [0.24, 0.2]], { closed: true }), L([[0.76, 0.64], [1, 0.64]])] },
  { key: "cap", name: "Cap", size: 30, items: [L([[0, 0.5], [0.55, 0.5]]), P("M 0.55 0.2 A 0.3 0.3 0 0 1 0.55 0.8"), L([[0.55, 0.2], [0.55, 0.8]])] },
  { key: "coupling", name: "Coupling", size: 32, items: [RUN, { kind: "rect", x: 0.36, y: 0.32, w: 0.28, h: 0.36 }] },
  { key: "union", name: "Union", size: 32, items: [RUN, L([[0.4, 0.22], [0.4, 0.78]], { width: 2.2 }), L([[0.6, 0.22], [0.6, 0.78]], { width: 2.2 }), L([[0.5, 0.16], [0.5, 0.84]])] },
  { key: "olet", name: "Weldolet / branch", size: 34, items: [RUN, P("M 0.32 0.5 A 0.18 0.18 0 0 1 0.68 0.5"), L([[0.5, 0.32], [0.5, 0]])] },
  { key: "fw", name: "Field weld", size: 30, items: [L([[0.5, 0.95], [0.5, 0.2]]), L([[0.5, 0.2], [0.92, 0.36], [0.5, 0.52]], { closed: true, fill: true })] },
  { key: "anchor", name: "Anchor", size: 30, items: [RUN, L([[0.5, 0.5], [0.5, 0.86]]), L([[0.3, 0.86], [0.7, 0.86], [0.5, 0.6]], { closed: true, fill: true })] },
  { key: "guide", name: "Guide", size: 30, items: [RUN, L([[0.38, 0.22], [0.38, 0.78]], { width: 2.2 }), L([[0.62, 0.22], [0.62, 0.78]], { width: 2.2 })] },
  { key: "shoe", name: "Pipe shoe", size: 30, items: [RUN, { kind: "rect", x: 0.3, y: 0.56, w: 0.4, h: 0.22 }, L([[0.16, 0.9], [0.84, 0.9]], { width: 2.2 })] },
  { key: "hanger", name: "Hanger", size: 32, items: [RUN, L([[0.5, 0.5], [0.5, 0.06]]), L([[0.32, 0.06], [0.68, 0.06]], { width: 2.4 }), L([[0.38, 0.5], [0.62, 0.5]], { width: 3 })] },
  { key: "spool", name: "Spool break", size: 28, items: [RUN, L([[0.36, 0.86], [0.56, 0.14]], { width: 2.2 }), L([[0.48, 0.86], [0.68, 0.14]], { width: 2.2 })] },
  { key: "flow", name: "Flow arrow", size: 28, items: [L([[0.05, 0.5], [0.62, 0.5]], { width: 2.4 }), L([[0.58, 0.28], [0.95, 0.5], [0.58, 0.72]], { closed: true, fill: true })] },
  { key: "tiein", name: "Tie-in point", size: 34, items: [L([[0.5, 0.06], [0.94, 0.5], [0.5, 0.94], [0.06, 0.5]], { closed: true, width: 2.2 }), T(0.5, 0.56, "TP", 0.34)] },
  { key: "instr", name: "Instrument", size: 32, items: [C(0.5, 0.5, 0.42), L([[0.08, 0.5], [0.92, 0.5]])] },
  { key: "vent", name: "Vent", size: 30, items: [L([[0.5, 1], [0.5, 0.5]]), L([[0.3, 0.5], [0.7, 0.5]], { width: 2.2 }), T(0.5, 0.36, "V", 0.4)] },
  { key: "drain", name: "Drain", size: 30, items: [L([[0.5, 0], [0.5, 0.5]]), L([[0.3, 0.5], [0.7, 0.5]], { width: 2.2 }), T(0.5, 0.86, "D", 0.4)] },
  { key: "slope", name: "Slope", size: 28, items: [L([[0.1, 0.72], [0.9, 0.72], [0.9, 0.28]], { closed: true, fill: true })] },
  { key: "delta", name: "Revision triangle", size: 30, items: [L([[0.5, 0.08], [0.94, 0.9], [0.06, 0.9]], { closed: true, width: 2.2 })] },
  { key: "delete", name: "Delete (X)", size: 26, items: [L([[0.12, 0.12], [0.88, 0.88]], { width: 2.6 }), L([[0.88, 0.12], [0.12, 0.88]], { width: 2.6 })] },
  { key: "north", name: "North arrow", size: 36, items: [L([[0.5, 0.96], [0.5, 0.3]]), L([[0.32, 0.4], [0.5, 0.04], [0.68, 0.4], [0.5, 0.3]], { closed: true, fill: true }), T(0.5, 0.86, "N", 0.3)] },
];

registerSymbolNames(Object.fromEntries(SYMBOLS.map((s) => [s.key, s.name])));

export function symbolTemplate(key: string, stroke: string): ToolTemplate | null {
  const s = SYMBOLS.find((x) => x.key === key);
  if (!s) return null;
  const w = s.size * (s.aspect ?? 1);
  return {
    kind: "group",
    d: { style: { stroke, width: 2, dash: "solid", fill: null, fillOpacity: 1, opacity: 1, fontSize: 14 }, box: { x: 0, y: 0, w: 1, h: 1 }, rot: 0, flip: false, items: s.items, symbol: s.key },
    sizePx: { w, h: s.size },
    mode: "drawing",
  };
}
