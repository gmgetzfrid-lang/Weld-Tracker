import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg, logErr } from "../../api";
import { useAuth } from "../../auth";
import type { Drawing, Lookups, Weld, Welder } from "../../types";
import { ConfirmDialog, Spinner, useToast } from "../../components/ui";
import { Combobox, InlineMulti } from "../../components/inline";
import { base64ToBytes, loadPdf, type PdfDoc } from "../../pdf";
import { useMarkupEditor, type Draft } from "../../markups/editor";
import { MarkupEl, SelectionEl } from "../../markups/render";
import { AddToChestDialog, ContextMenu, DRAW_TOOLS, MarkupBar, MarkupsList, TextEditOverlay, ToolChest, type MenuItem } from "../../markups/panels";
import { attachWeldMap, exportWeldMap } from "../../markups/exportMap";
import { bboxPx, normBox, type PM, type Style } from "../../markups/model";
import type { MarkupTool } from "../../types";
import { isIncomplete, missingAttributes } from "../../incomplete";
import { Icon, type IconName } from "../../components/Icon";

interface Pt { x: number; y: number }
type Tool = "bubble" | "select" | "pan" | "legend" | "markup";

/** The shape being drawn right now, as a throwaway markup for the renderer. */
function draftPM(dr: Draft, style: Style, drawingId: number, page: number): PM {
  const base = {
    id: -1, drawing_id: drawingId, page, subject: null, comment: null, status: "Open" as const, z: 0, locked: false,
    created_by: null, created_at: "", updated_by: null, updated_at: "",
  };
  const box = normBox({ x: dr.start.x, y: dr.start.y, w: dr.cur.x - dr.start.x, h: dr.cur.y - dr.start.y });
  switch (dr.kind) {
    case "line": case "arrow": case "dimension":
      return { ...base, kind: dr.kind, d: { style: dr.kind === "arrow" ? { ...style, arrowEnd: true } : style, pts: [dr.start, dr.cur] } };
    case "polyline": return { ...base, kind: "polyline", d: { style, pts: [...dr.pts, dr.cur] } };
    case "pen": return { ...base, kind: "pen", d: { style, pts: dr.pts, smooth: true } };
    case "text": case "callout": return { ...base, kind: "rect", d: { style: { ...style, dash: "dash", width: 1 }, box } };
    default: return { ...base, kind: dr.kind, d: { style, box } };
  }
}

// EP 5-5-1 Table 4 driver vocabularies (kept in step with weldcore/src/nde.rs).
export const MATERIAL_GROUPS = [
  "Carbon Steel",
  "Low Alloy P4-P5A",
  "Low Alloy P5B-P5C",
  "Titanium",
  "Stainless/Nickel",
];
export const FLANGE_CLASSES = ["150", "300", "600", "900", "1500"];
export const SERVICE_CATEGORIES = [
  "Normal",
  "Category D",
  "Category M",
  "Severe Cyclic",
  "Fired Heater Coil",
];
export const B31_CODES = ["B31.3", "B31.1", "B31.4"];
export const SHOP_FIELD = ["SHOP", "FW"];
export const HYDRO_STATES = ["Pending", "Complete", "NA-API570", "NA-Service"];
export const NDE_RESULTS = ["", "Accepted", "Rejected"];
// NDE examination methods/passes. Butt welds under API 570 in-lieu-of-hydro
// take both PT root & final AND RT final; fillet/socket take PT/MT root & final.
export const NDE_TYPE_OPTIONS = ["RT", "PT Root", "PT Final", "MT Root", "MT Final", "UT (exam)", "VT"];

// Fields that repeat weld-to-weld along a line and are carried forward to the
// next weld in the guided walk. The disposition (NDE %/type/result/date) is
// never carried — it's specific to each weld's examination.
const STICKY_KEYS: (keyof Weld)[] = [
  "stamp_number", "date_welded", "size", "joint_type", "shop_or_field",
  "service_category", "flange_class", "b31_code", "material", "material_group",
  "schedule", "groove_type", "process", "line_spec", "aes_service",
  "new_to_existing", "hydro_status", "pwht_required", "pmi_required",
];
function pickSticky(changes: Partial<Weld>): Partial<Weld> {
  const out: Partial<Weld> = {};
  for (const k of STICKY_KEYS) {
    const v = changes[k];
    if (v !== undefined && v !== null && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * The bubble layer, memoized. Panning and zooming set state on every pointer
 * move; re-rendering hundreds of SVG nodes each frame is what made big maps
 * feel sluggish. None of these props change during a pan/zoom or while the
 * placement ghost tracks the cursor, so the whole layer skips those renders.
 */
const WeldLayer = memo(function WeldLayer({
  welds, width, height, z, selId, activeId, editable, canGrab, onGrab,
}: {
  welds: Weld[]; width: number; height: number; z: number;
  selId: number | null; activeId: number | null;
  editable: boolean; canGrab: boolean;
  onGrab: (w: Weld, mode: "both" | "joint", e: React.MouseEvent) => void;
}) {
  const R = 17 * z;
  return (
    <>
      {welds.map((w) => {
        const cx = (w.bubble_x ?? 0) * width, cy = (w.bubble_y ?? 0) * height;
        const jx = (w.joint_x ?? w.bubble_x ?? 0) * width, jy = (w.joint_y ?? w.bubble_y ?? 0) * height;
        const sel = w.id === selId, active = w.id === activeId;
        const editing = sel && editable;
        // Disposition glyph at the bubble's shoulder: the examination result
        // once one exists, else "R" to flag an unexamined repair weld. Voided
        // welds dim as a whole instead.
        const voided = !!w.voided_at;
        const todo = !voided && isIncomplete(w);
        const glyph =
          w.nde_result === "Rejected" ? { t: "!", cls: "bad" } :
          w.nde_result === "Accepted" ? { t: "✓", cls: "ok" } :
          w.parent_weld_id != null ? { t: "R", cls: "rep" } :
          todo ? { t: "?", cls: "todo" } : null;
        return (
          <g key={w.id} className={`${active ? "wm-g active" : "wm-g"} ${editing ? "editing" : ""} ${voided ? "voided" : ""} ${todo ? "incomplete" : ""}`}
            data-missing={todo ? missingAttributes(w).join(", ") : undefined}
            // Modeless (Bluebeam-style): any bubble is directly selectable and
            // draggable regardless of the active tool, unless a new bubble is
            // mid-placement.
            onMouseDown={(e) => { if (canGrab) onGrab(w, "both", e); }}
            style={{ cursor: canGrab ? "move" : "pointer" }}
          >
            <line x1={jx} y1={jy} x2={cx} y2={cy} className={`anno-leader ${sel ? "sel" : ""}`} style={{ strokeWidth: (sel ? 2.4 : 1.7) * z }} />
            <circle
              cx={jx} cy={jy} r={(editing ? 7 : 2.6) * z}
              className={`anno-joint ${editing ? "handle" : ""}`}
              onMouseDown={editing ? (e) => onGrab(w, "joint", e) : undefined}
              style={editing ? { cursor: "crosshair", strokeWidth: 2 * z } : undefined}
            />
            <circle cx={cx} cy={cy} r={R} className={`anno-bubble ${sel ? "sel" : ""} ${active ? "active" : ""}`} style={{ strokeWidth: (active ? 3 : sel ? 2.6 : 1.9) * z }} />
            <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} className="anno-divider" style={{ strokeWidth: 1.4 * z }} />
            <text x={cx} y={cy - R * 0.42} className="anno-txt" style={{ fontSize: 11 * z }}>{w.stamp_number ?? ""}</text>
            <text x={cx} y={cy + R * 0.42} className="anno-txt" style={{ fontSize: 11 * z }}>{w.weld_number ?? ""}</text>
            {glyph && !voided && (
              <g className={`wm-glyph ${glyph.cls}`}>
                <circle cx={cx + R * 0.82} cy={cy - R * 0.82} r={6.4 * z} style={{ strokeWidth: 1.5 * z }} />
                <text x={cx + R * 0.82} y={cy - R * 0.82} style={{ fontSize: 8.6 * z }}>{glyph.t}</text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
});
// A drag in progress on a selected weld: "both" translates the bubble + leader
// together (move the whole thing); "joint" moves only the joint end of the
// leader (re-extend / re-aim the line).
type DragState = {
  id: number; mode: "both" | "joint";
  sx: number; sy: number;   // where the drag started (normalised)
  bx: number; by: number;   // bubble at drag start
  jx: number; jy: number;   // joint at drag start
  moved: boolean;           // did the pointer actually move (vs a click)
};

export function WeldAnnotator({
  drawing,
  welders,
  lookups,
  sizes,
  onChange,
  onComplete,
}: {
  drawing: Drawing;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onChange?: (welds: Weld[]) => void;
  /** Called when the guided Fill-attributes walk finishes the last weld —
   * the wizard uses this to move on to the review table. */
  onComplete?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("editor");

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderTaskRef = useRef<any>(null);
  const dragRef = useRef<DragState | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPdf, setHasPdf] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  // This sheet's controlled-copy window inside its package (1-based, absolute).
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(1);
  // Zoom split for instant response: `zoom` is the live displayed scale (driven
  // by the wheel/buttons via a CSS transform, so it's instant); `scale` is the
  // resolution the PDF canvas is actually rasterised at, which catches up to
  // `zoom` after a short debounce (crisp settle). `base` is the page's size at
  // scale 1. The viewport is CSS-scaled by zoom/scale so the raster shows at the
  // live zoom with no re-render on every wheel tick.
  const [zoom, setZoom] = useState(1);
  const [scale, setScale] = useState(1);
  const [renderedScale, setRenderedScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const baseRef = useRef({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const downRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const zoomRef = useRef(1);
  const panStateRef = useRef({ x: 0, y: 0 });
  // Set when a freshly loaded page still needs its first centering — resolved
  // by the render effect, which runs with the stage actually on screen.
  const centerPendingRef = useRef(false);

  const [welds, setWelds] = useState<Weld[]>([]);
  const [stamp, setStamp] = useState("");
  const [nextNum, setNextNum] = useState(1);
  const [tool, setTool] = useState<Tool>("bubble");
  const [pending, setPending] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [legendSel, setLegendSel] = useState(false);

  const [legendOn, setLegendOn] = useState(true);
  const [legendPos, setLegendPos] = useState<Pt>({ x: 0.72, y: 0.04 });
  const legendKey = `wm-legend-${drawing.id}`;

  // Guided fill: the weld being walked (by id — the list shifts as welds get
  // filled) and whether the walk visits every weld or only the ones missing data.
  const [guidedId, setGuidedId] = useState<number | null>(null);
  const [walkAll, setWalkAll] = useState(false);
  // Carry-forward: the driver values last entered in the guided walk, so the
  // next weld inherits them and the welder only changes what differs.
  const stickyRef = useRef<Partial<Weld>>({});
  const [showCoach, setShowCoach] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem("wm-coach-seen")) setShowCoach(true); } catch { /* ignore */ }
  }, []);
  const dismissCoach = () => { setShowCoach(false); try { localStorage.setItem("wm-coach-seen", "1"); } catch { /* ignore */ } };

  // Markups (redlines) + the Tool Chest. The editor owns drawing/selection
  // state and persistence; the stage hands it pointer events in markup mode.
  const editor = useMarkupEditor({
    drawingId: drawing.id, page: pageNum, W: size.w, H: size.h, editable,
    toast: (k, m) => toast.push(k, m),
  });
  const [chestOpen, setChestOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [mtools, setMtools] = useState<MarkupTool[]>([]);
  const reloadTools = useCallback(() => { api.listMarkupTools().then(setMtools).catch(logErr("loading tool chest")); }, []);
  useEffect(() => { reloadTools(); }, [reloadTools]);
  const [ctx, setCtx] = useState<{ x: number; y: number; pm: PM } | null>(null);
  const [addChest, setAddChest] = useState<{ pms: PM[]; cat?: string } | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const chestCats = useMemo(() => Array.from(new Set(mtools.map((t) => t.category))).sort(), [mtools]);

  const refreshWelds = useCallback(async () => {
    const rows = await api.listDrawingWelds(drawing.id);
    setWelds(rows);
    onChange?.(rows);
    return rows;
  }, [drawing.id, onChange]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(legendKey);
      if (saved) { const p = JSON.parse(saved); setLegendPos(p.pos); setLegendOn(p.on); }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistLegend = (pos: Pt, on: boolean) => {
    try { localStorage.setItem(legendKey, JSON.stringify({ pos, on })); } catch { /* ignore */ }
  };

  // load pdf + welds + next number
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pdf, rows, nn] = await Promise.all([
          api.getDrawingPdf(drawing.id),
          api.listDrawingWelds(drawing.id),
          api.nextWeldNumber(drawing.id),
        ]);
        if (!alive) return;
        setWelds(rows);
        setNextNum(nn);
        if (pdf) {
          const doc = await loadPdf(base64ToBytes(pdf[1]));
          if (!alive) return;
          docRef.current = doc;
          setPageCount(doc.numPages);
          // Scope this sheet to its controlled-copy window in the package.
          const from = Math.max(1, Math.min(pdf[2] || 1, doc.numPages));
          const to = Math.max(from, Math.min(pdf[3] || doc.numPages, doc.numPages));
          setPageFrom(from);
          setPageTo(to);
          setPageNum((p) => (p >= from && p <= to ? p : from));
          setHasPdf(true);
          const page = await doc.getPage(from);
          const vp = page.getViewport({ scale: 1 });
          baseRef.current = { w: vp.width, h: vp.height };
          // Start at 100% (zoom = 1), centred at the top of the page. The
          // stage isn't mounted yet (the spinner is showing), so the actual
          // centering waits for the first raster, which knows the real width.
          setZoom(1);
          setScale(1);
          centerPendingRef.current = true;
        }
      } catch (e) {
        setError(errMsg(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id]);

  // render page. `loading` is a dep on purpose: while the spinner shows, the
  // canvas isn't mounted and the render bails — the flip to loaded must re-run
  // this effect or the first raster never happens (blank page until a zoom
  // nudges `scale`).
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || loading) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext("2d")!;
      canvas.width = vp.width; canvas.height = vp.height;
      setSize({ w: vp.width, h: vp.height });
      // Record the scale this raster was drawn at, so the CSS zoom transform
      // (zoom / renderedScale) always matches the on-screen canvas — no flicker
      // during the debounced re-render.
      setRenderedScale(scale);
      // Deferred initial centering: now the stage exists and its real width is
      // known (the load effect only saw the spinner).
      if (centerPendingRef.current) {
        centerPendingRef.current = false;
        const cw = stageRef.current?.clientWidth ?? 900;
        setPan({ x: Math.max(16, (cw - vp.width) / 2), y: 16 });
      }
      try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
      const task = page.render({ canvasContext: ctx, viewport: vp });
      renderTaskRef.current = task;
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; };
  }, [pageNum, scale, hasPdf, loading]);

  // With no PDF attached, give the blank grid a real pixel size so bubbles, the
  // legend and the guided-fill popup have coordinates to anchor to (otherwise
  // size stays {0,0} and everything collapses onto the origin).
  useEffect(() => {
    if (loading || hasPdf) return;
    if (size.w > 0 && size.h > 0) return;
    const cw = Math.max(700, (stageRef.current?.clientWidth ?? 900) - 24);
    const g = { w: cw, h: Math.round(cw * 1.3) };
    baseRef.current = g;
    setSize(g);
    setZoom(1);
    setScale(1);
  }, [loading, hasPdf, size.w, size.h]);

  const ordered = useMemo(
    () => [...welds].sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true })),
    [welds]
  );
  // Voided welds stay on the map (dimmed — the record still exists) but drop
  // out of the guided walk: there's nothing to fill on an excluded weld.
  const fillable = useMemo(() => ordered.filter((w) => !w.voided_at), [ordered]);
  const incomplete = useMemo(() => fillable.filter(isIncomplete), [fillable]);
  /** The welds this walk visits, in map order. */
  const walk = useMemo(() => (walkAll || incomplete.length === 0 ? fillable : incomplete), [walkAll, incomplete, fillable]);
  // Index of the current weld in `fillable` (what the rest of the map keys on).
  const guided = useMemo(() => {
    if (guidedId == null) return null;
    const i = fillable.findIndex((w) => w.id === guidedId);
    return i >= 0 ? i : null;
  }, [guidedId, fillable]);
  /** Start walking: at the first weld missing data, else at the newest weld. */
  const startWalk = useCallback(() => {
    if (incomplete.length) { setWalkAll(false); setGuidedId(incomplete[0].id); return; }
    if (!fillable.length) return;
    setWalkAll(true);
    setGuidedId(fillable.reduce((a, b) => (b.id > a.id ? b : a)).id);
  }, [incomplete, fillable]);
  /** The next weld after `fromId` that the walk should visit, from fresh rows. */
  const nextInWalk = useCallback((fromId: number, rows: Weld[], includeAll: boolean, dir: 1 | -1 = 1): Weld | null => {
    const order = rows.filter((w) => !w.voided_at).sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true }));
    const pos = order.findIndex((w) => w.id === fromId);
    const pass = (w: Weld) => includeAll || isIncomplete(w);
    if (dir === 1) {
      return order.slice(pos + 1).find(pass) ?? (includeAll ? null : order.slice(0, Math.max(0, pos)).find(pass) ?? null);
    }
    for (let i = pos - 1; i >= 0; i--) if (pass(order[i])) return order[i];
    return null;
  }, []);

  // number-key welder shortcuts, Esc to cancel, Delete to remove the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (guided !== null) return;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
      if (tool === "markup" || editor.selection.length) {
        if (editor.onKey(e)) { e.preventDefault(); return; }
        if (tool === "markup" && !typing && editable && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toUpperCase();
          if (k === "V") { editor.setTool({ type: "select" }); return; }
          const dt = DRAW_TOOLS.find((d) => d.key === k);
          if (dt) { editor.setTool({ type: "draw", kind: dt.kind, name: dt.label }); return; }
        }
      }
      if (e.key === "Escape") { setPending(null); setCursor(null); setSelId(null); setLegendSel(false); }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && editable) {
        if (selId != null) { e.preventDefault(); askDelete(selId); }
        else if (legendSel) { e.preventDefault(); setLegendOn(false); setLegendSel(false); persistLegend(legendPos, false); }
      }
      if (/^[1-9]$/.test(e.key) && !typing) {
        const w = welders[Number(e.key) - 1];
        if (w) setStamp(w.stamp);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welders, guided, selId, legendSel, editable, legendPos, tool, editor.onKey, editor.setTool, editor.selection.length]);

  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  /** Pointer position in page pixels (the markup editor's frame). */
  const pxOf = (e: { clientX: number; clientY: number }): Pt => {
    const n = norm(e);
    return { x: n.x * size.w, y: n.y * size.h };
  };

  // Leaving markup mode closes the chest and drops the markup tool.
  useEffect(() => {
    if (tool !== "markup") { setChestOpen(false); editor.setTool({ type: "select" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Fit the page width to the stage.
  const fitToWidth = useCallback(() => {
    const stage = stageRef.current;
    const bw = baseRef.current.w;
    if (!stage || bw <= 0) return;
    const z = Math.max(0.15, Math.min(6, (stage.clientWidth - 24) / bw));
    setZoom(z);
    setPan({ x: 12, y: 12 });
  }, []);

  // Reset to exactly 100% (native page pixels).
  const resetZoom = () => {
    const stage = stageRef.current;
    const bw = baseRef.current.w;
    setZoom(1);
    setPan({ x: stage ? Math.max(16, (stage.clientWidth - bw) / 2) : 16, y: 16 });
  };

  // Crisp settle: after the live (CSS-scaled) zoom stops changing, re-rasterise
  // the PDF at the new zoom so it's sharp. The wheel/buttons stay instant.
  useEffect(() => {
    const t = setTimeout(() => setScale(zoom), 130);
    return () => clearTimeout(t);
  }, [zoom]);

  // Centre a normalized point in the stage. `rightInset` reserves space on the
  // right (the guided drawer) so the bubble is centred in the visible area.
  const centerOn = (nx: number, ny: number, rightInset = 0) => {
    const stage = stageRef.current;
    if (!stage) return;
    const { w: bw, h: bh } = baseRef.current;
    const availW = stage.clientWidth - rightInset;
    setPan({ x: availW / 2 - nx * bw * zoom, y: stage.clientHeight / 2.15 - ny * bh * zoom });
  };
  const DRAWER_W = 384;

  // Press on the background: begin either a pan (if the pointer moves) or a
  // click action (place / select / legend, on release without moving).
  const onStageDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (dragRef.current) return; // a bubble drag owns the gesture
    // A press on a bubble is handled by the bubble's own click/drag handlers.
    if ((e.target as Element).closest?.(".wm-g")) return;
    if ((e.target as Element).closest?.(".mk-sel")) return; // a markup grip owns the gesture
    if (tool === "markup" && svgRef.current && editor.onDown(e, pxOf(e))) { downRef.current = null; panRef.current = null; return; }
    downRef.current = { x: e.clientX, y: e.clientY, moved: false };
    panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };

  const dropBubble = async (joint: Pt, at: Pt) => {
    try {
      const w = await api.addBubbleWeld(drawing.id, stamp, `W${nextNum}`, pageNum, at.x, at.y, joint.x, joint.y);
      setWelds((prev) => { const n = [...prev, w]; onChange?.(n); return n; });
      setNextNum((n) => n + 1);
      setPending(null);
    } catch (e) { toast.push("err", errMsg(e)); }
  };

  const onStageClick = async (e: React.MouseEvent) => {
    // Markup mode: an empty click clears the markup selection (viewers too).
    if (tool === "markup") { editor.setSelection([]); setSelId(null); setLegendSel(false); return; }
    if (editor.selection.length) editor.setSelection([]);
    if (!editable || guided !== null) return;
    // Bubble tool: an empty click places a joint, then the bubble.
    if (tool === "bubble") {
      if (!stamp) { toast.push("err", "Pick a welder first"); return; }
      const p = norm(e);
      if (!pending) { setSelId(null); setLegendSel(false); setPending(p); setCursor(p); }
      else await dropBubble(pending, p);
      return;
    }
    // Select/hand tool: an empty click clears the selection.
    setSelId(null);
    setLegendSel(false);
  };

  // Begin dragging a selected weld — the whole thing ("both") or just the joint.
  const startDrag = (w: Weld, mode: "both" | "joint", e: React.MouseEvent) => {
    if (!editable) return;
    const p = norm(e);
    dragRef.current = {
      id: w.id, mode, sx: p.x, sy: p.y,
      bx: w.bubble_x ?? 0, by: w.bubble_y ?? 0,
      jx: w.joint_x ?? w.bubble_x ?? 0, jy: w.joint_y ?? w.bubble_y ?? 0,
      moved: false,
    };
  };

  const onMove = (e: React.MouseEvent) => {
    if (svgRef.current && editor.onMove(e, pxOf(e))) return; // a markup draft or drag owns the pointer
    if (pending) setCursor(norm(e));
    // Background pan: once the pointer has moved past the click threshold.
    const dn = downRef.current;
    if (dn && !dragRef.current && !pending && panRef.current) {
      const dx = e.clientX - dn.x, dy = e.clientY - dn.y;
      if (!dn.moved && Math.hypot(dx, dy) > 4) dn.moved = true;
      if (dn.moved) {
        const pr = panRef.current;
        setPan({ x: pr.px + (e.clientX - pr.sx), y: pr.py + (e.clientY - pr.sy) });
        return;
      }
    }
    const d = dragRef.current;
    if (d) {
      const p = norm(e);
      if (Math.hypot(p.x - d.sx, p.y - d.sy) > 0.001) d.moved = true;
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      setWelds((prev) => prev.map((w) => {
        if (w.id !== d.id) return w;
        if (d.mode === "joint") return { ...w, joint_x: clamp(p.x), joint_y: clamp(p.y) };
        const dx = p.x - d.sx, dy = p.y - d.sy;
        return { ...w, bubble_x: clamp(d.bx + dx), bubble_y: clamp(d.by + dy), joint_x: clamp(d.jx + dx), joint_y: clamp(d.jy + dy) };
      }));
    }
  };
  const endDrag = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return; // a click that only selected — nothing to persist
    const w = welds.find((x) => x.id === d.id);
    if (w && w.bubble_x != null && w.bubble_y != null) {
      try {
        await api.setWeldBubble(d.id, pageNum, w.bubble_x, w.bubble_y, w.joint_x ?? w.bubble_x, w.joint_y ?? w.bubble_y);
      } catch (e) {
        // The canvas already shows the moved bubble — if the save failed, the
        // DB still has the old position. Reload to the truth and say so.
        toast.push("err", `Could not save the bubble position for ${w.weld_number ?? "this weld"} — reloaded. ${errMsg(e)}`);
        await refreshWelds();
      }
    }
  };

  // Release on the stage: finish a bubble drag, finish a pan, or — if the
  // pointer never moved — perform the tool's click action at that point.
  const onStageUp = async (e: React.MouseEvent) => {
    if (svgRef.current && (await editor.onUp(e, pxOf(e)))) { downRef.current = null; panRef.current = null; return; }
    if (dragRef.current) { await endDrag(); downRef.current = null; panRef.current = null; return; }
    const dn = downRef.current;
    downRef.current = null; panRef.current = null;
    if (dn && !dn.moved) await onStageClick(e); // a click, not a pan
  };

  const reassign = async (id: number) => {
    const w = welds.find((x) => x.id === id);
    if (!w || !stamp) return;
    try { await api.updateWeld({ ...w, stamp_number: stamp }); await refreshWelds(); } catch (e) { toast.push("err", errMsg(e)); }
  };
  // Deleting is confirmed first — one stray Delete keypress must never
  // destroy a weld record. The dialog warns harder when data is on the weld.
  const [confirmDel, setConfirmDel] = useState<Weld | null>(null);
  const askDelete = (id: number) => {
    const w = welds.find((x) => x.id === id);
    if (w) setConfirmDel(w);
  };
  const delWeld = async (id: number) => {
    try { await api.deleteWeld(id); setSelId(null); await refreshWelds(); } catch (e) { toast.push("err", errMsg(e)); }
  };

  // Manual renumber with a collision check — no two welds on the drawing may
  // share a number. Returns true on success. Comparison is case-insensitive.
  const renumber = async (id: number, raw: string): Promise<boolean> => {
    const w = welds.find((x) => x.id === id);
    if (!w) return false;
    const v = raw.trim();
    if (!v) { toast.push("err", "A weld number is required"); return false; }
    if (v === (w.weld_number ?? "")) return true;
    if (welds.some((x) => x.id !== id && (x.weld_number ?? "").trim().toLowerCase() === v.toLowerCase())) {
      toast.push("err", `Weld “${v}” already exists on this drawing`);
      return false;
    }
    try {
      await api.updateWeld({ ...w, weld_number: v });
      await refreshWelds();
      toast.push("ok", `Renumbered to ${v}`);
      return true;
    } catch (e) { toast.push("err", errMsg(e)); return false; }
  };

  // welder totals for the legend (voided welds don't count toward anyone)
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    welds.forEach((w) => { if (w.stamp_number && !w.voided_at) m.set(w.stamp_number, (m.get(w.stamp_number) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [welds]);

  // Flatten the sheet (drawing + bubbles + legend + markups) to a PDF.
  const doExport = async (mode: "reveal" | "open" | "attach") => {
    setExportMenu(false);
    setExporting(true);
    try {
      const pages: number[] = [];
      for (let p = pageFrom; p <= pageTo; p++) pages.push(p);
      const tag = [drawing.drawing_no, drawing.sheet_no ? `sh${drawing.sheet_no}` : "", drawing.revision ? `rev${drawing.revision}` : ""]
        .filter(Boolean).join("-").replace(/[^0-9A-Za-z._-]+/g, "-") || `drawing-${drawing.id}`;
      const opts = {
        doc: hasPdf ? docRef.current : null,
        pages: hasPdf ? pages : [1],
        blank: { w: size.w || 800, h: size.h || 600 },
        welds, markups: editor.all,
        legend: { pos: legendPos, totals, on: legendOn },
        fileName: `weld-map-${tag}.pdf`,
        mode: (mode === "attach" ? "reveal" : mode) as "reveal" | "open",
      };
      if (mode === "attach") {
        await attachWeldMap(opts, drawing.work_order!, `Flattened weld map · ${welds.length} welds · ${editor.all.length} markups`);
        toast.push("ok", "Weld map filed in the quality package");
      } else {
        const path = await exportWeldMap(opts);
        toast.push("ok", `${mode === "open" ? "Opened" : "Saved"} ${path}`);
      }
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setExporting(false); }
  };

  // Right-click menu for a markup.
  const ctxItems = (pm: PM): MenuItem[] => {
    const sel = editor.selected.length ? editor.selected : [pm];
    const textual = ["text", "callout", "dimension"].includes(pm.kind);
    const canUngroup = sel.length === 1 && pm.kind === "group" && (pm.d.items?.length ?? 0) > 1;
    return [
      {
        label: "Add to Tool Chest", disabled: !editable,
        sub: [
          ...chestCats.map((c) => ({ label: c, onClick: () => setAddChest({ pms: sel, cat: c }) })),
          ...(chestCats.length ? [{ label: "", sep: true }] : []),
          { label: "New tool set…", onClick: () => setAddChest({ pms: sel }) },
        ],
      },
      { label: "", sep: true },
      ...(textual ? [{ label: "Edit text", onClick: () => editor.setEditingText(pm.id), disabled: !editable || pm.locked }] : []),
      { label: "Duplicate", onClick: () => editor.duplicate(), disabled: !editable },
      { label: sel.length > 1 ? "Group" : "Ungroup", onClick: () => (sel.length > 1 ? editor.group() : editor.ungroup()), disabled: !editable || (sel.length === 1 && !canUngroup) },
      { label: "Rotate 90°", onClick: () => editor.rotate(90), disabled: !editable || pm.locked },
      { label: "Flip", onClick: () => editor.flip(), disabled: !editable || pm.locked },
      { label: "Bring to front", onClick: () => editor.reorder(true), disabled: !editable },
      { label: "Send to back", onClick: () => editor.reorder(false), disabled: !editable },
      { label: "", sep: true },
      { label: pm.locked ? "Unlock" : "Lock", onClick: () => editor.toggleLock(), disabled: !editable },
      { label: pm.status === "Resolved" ? "Reopen" : "Mark resolved", onClick: () => editor.setStatus(pm.status === "Resolved" ? "Open" : "Resolved"), disabled: !editable },
      { label: "", sep: true },
      { label: "Delete", onClick: () => editor.remove(), danger: true, disabled: !editable || pm.locked },
    ];
  };

  // If the walk's list shrinks under us (a weld voided or deleted from
  // another view), clamp the index so the drawer never silently vanishes
  // while guided mode stays on with no way out.
  useEffect(() => {
    if (guidedId !== null && guided === null) {
      setGuidedId(fillable.length > 0 ? fillable[fillable.length - 1].id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, guidedId, fillable]);

  // guided fill: pan the active bubble to the centre of the stage — once per
  // weld. The welds list refreshes after every save (and after bubble drags),
  // and re-centering on each refresh would yank the view mid-drag.
  const lastCenteredRef = useRef<number | null>(null);
  useEffect(() => {
    if (guided === null) { lastCenteredRef.current = null; return; }
    const w = fillable[guided];
    if (!w || w.bubble_x == null) return;
    if ((w.bubble_page ?? 1) !== pageNum) setPageNum(w.bubble_page ?? 1);
    if (lastCenteredRef.current === w.id) return;
    lastCenteredRef.current = w.id;
    centerOn(w.bubble_x ?? 0.5, w.bubble_y ?? 0.5, DRAWER_W);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, fillable, size.w, size.h, pageNum]);

  // Keep refs current for the native wheel handler (which must be non-passive
  // to preventDefault the browser's ctrl-zoom / page-scroll). Zoom changes only
  // `zoom` (a CSS transform) so it's instant; the raster catches up on settle.
  zoomRef.current = zoom;
  panStateRef.current = pan;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handler = (e: WheelEvent) => {
      // Let overlays (the fill drawer, HUD panels, dropdown menus) scroll
      // themselves — the wheel only pans/zooms the PDF over the bare canvas.
      const t = e.target as Element;
      if (t.closest?.(".anno-drawer, .anno-hud, .anno-selbar, .combo-menu, .anno-dock, .mk-list, .mk-bar, .ctx-menu")) return;
      e.preventDefault();
      const p = panStateRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = stage.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const cur = zoomRef.current;
        const next = Math.max(0.15, Math.min(6, cur * factor));
        const r = next / cur;
        setPan({ x: mx - (mx - p.x) * r, y: my - (my - p.y) * r });
        setZoom(next);
      } else {
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    stage.addEventListener("wheel", handler, { passive: false });
    return () => stage.removeEventListener("wheel", handler);
    // Re-attach once loading finishes and the stage element actually exists.
  }, [loading]);

  // Re-fit only when *toggling* fullscreen (not on first mount, which would
  // override the 100% start). A ref guards the initial run.
  const fsMounted = useRef(false);
  useEffect(() => {
    if (!fsMounted.current) { fsMounted.current = true; return; }
    const t = setTimeout(() => { fitToWidth(); }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);
  useEffect(() => {
    if (!fullscreen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [fullscreen]);

  // Stable identity so the memoized WeldLayer skips re-rendering during
  // pans/zooms (which set state on every pointer move) — an inline filter
  // would hand it a fresh array each render and defeat the memo.
  const pageWelds = useMemo(
    () => ordered.filter((w) => (w.bubble_page ?? 1) === pageNum && w.bubble_x != null),
    [ordered, pageNum],
  );
  // Ref-trampolined grab handler: a stable callback for the memoized layer
  // that always runs the current selection/drag logic.
  const grabImpl = useRef<(w: Weld, mode: "both" | "joint", e: React.MouseEvent) => void>(() => {});
  grabImpl.current = (w, mode, e) => {
    e.stopPropagation();
    if (mode === "both") { setSelId(w.id); setLegendSel(false); }
    startDrag(w, mode, e);
  };
  const onGrab = useCallback(
    (w: Weld, mode: "both" | "joint", e: React.MouseEvent) => grabImpl.current(w, mode, e),
    [],
  );

  if (loading) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;

  // Bubbles are drawn in rendered-pixel space, so their size scales with the
  // zoom — zooming out shrinks them (no crowding), zooming in enlarges them.
  // Bubbles live in the rendered-canvas pixel space, so size them by the scale
  // the canvas was actually drawn at; the CSS zoom transform then scales them
  // together with the drawing.
  const z = renderedScale;
  const R = 17 * z;
  const activeId = guided !== null ? fillable[guided]?.id : null;
  // The line's spec(s). A spec break gives two — the guided popup then lets you
  // put each weld on the correct side of the break.
  const specOptions = [drawing.line_spec, drawing.line_spec_2].filter(Boolean) as string[];
  const gActive = guided !== null ? fillable[guided] : null;
  const panning = downRef.current?.moved ?? false;
  const placing = editable && tool === "bubble" && stamp && !pending;

  const hint = !editable ? "Read-only — drag to pan, Ctrl+scroll to zoom." :
    guided !== null ? `Guided fill — ${walk.findIndex((w) => w.id === guidedId) + 1} of ${walk.length}${walkAll ? "" : " missing data"}. Enter for the next field, Save & next on the last.` :
    tool === "markup" ? (
      editor.suspendedTool ? `Editing — drag to move, grips resize, the top handle rotates · click empty space or Esc to resume ${editor.suspendedTool.type === "place" ? editor.suspendedTool.name : (editor.suspendedTool.type === "draw" ? editor.suspendedTool.name ?? editor.suspendedTool.kind : "")}`
      : editor.tool.type === "select" ? "Markups: click to select · drag to move · right-click for options · pick a tool in the chest (T text · A arrow · C cloud …)."
      : editor.tool.type === "place" ? `Click to place ${editor.tool.name} · [ ] rotates · Esc to stop`
      : editor.tool.kind === "polyline" ? "Click each point · double-click or Enter to finish · Esc cancels"
      : editor.tool.kind === "callout" ? "Drag from the item you're pointing at to where the note goes"
      : `Drag to draw ${(editor.tool.name ?? editor.tool.kind).toLowerCase()} · Esc to stop`) :
    tool === "bubble" ? (!stamp ? "Pick a welder, then click a joint to start a leader." : pending ? "Click where the bubble goes." : "Click a joint to place a weld · drag empty space to pan · Ctrl+scroll to zoom.") :
    "Click a bubble or the legend to select · drag it to move · Delete removes it · drag empty space to pan.";

  const selWeld = selId != null && guided === null ? welds.find((x) => x.id === selId) : null;

  return (
    <div className={`anno ${fullscreen ? "anno-full" : ""}`}>
      {editable && showCoach && <CoachMarks onDone={dismissCoach} />}

      <div
        className={`anno-stage ${tool === "markup" && editor.tool.type !== "select" ? "drawing" : ""}`}
        ref={stageRef}
        onMouseDown={onStageDown}
        onMouseMove={onMove}
        onMouseUp={onStageUp}
        onDoubleClick={(e) => { if (svgRef.current) editor.onDouble(e, pxOf(e)); }}
        onMouseLeave={() => { setCursor(null); if (dragRef.current) endDrag(); downRef.current = null; panRef.current = null; }}
        style={{ cursor: panning ? "grabbing" : placing ? "crosshair" : "grab" }}
      >
        {!hasPdf && <div className="anno-empty">No PDF attached — place bubbles on the blank grid, or attach the isometric in the previous step.</div>}

        {/* the page — translated (pan) and rendered at `scale` (zoom) */}
        <div className="anno-viewport" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${renderedScale > 0 ? zoom / renderedScale : 1})` }}>
          <div className="anno-page" style={{ width: size.w || 800, height: size.h || 600 }}>
            <canvas ref={canvasRef} />
            <svg ref={svgRef} className="anno-svg" width={size.w || 800} height={size.h || 600}>
              {/* redlines sit under the weld bubbles — the record stays on top */}
              {editor.pageMarkups.map((pm) => (
                <MarkupEl key={pm.id} pm={pm} W={size.w} H={size.h} z={z} interactive={!pending}
                  editingText={editor.editingText === pm.id}
                  h={{
                    onGrab: (m, e) => editor.grab(m, e, pxOf(e)),
                    onContext: (m, e) => { if (!editor.selection.includes(m.id)) editor.setSelection([m.id]); setCtx({ x: e.clientX, y: e.clientY, pm: m }); },
                    onDouble: (m, e) => { e.stopPropagation(); if (["text", "callout", "dimension"].includes(m.kind) && editable && !m.locked) editor.setEditingText(m.id); },
                  }} />
              ))}
              {editor.draft && <MarkupEl pm={draftPM(editor.draft, editor.effStyle, drawing.id, pageNum)} W={size.w} H={size.h} z={z} interactive={false} />}
              <WeldLayer
                welds={pageWelds}
                width={size.w}
                height={size.h}
                z={z}
                selId={selId}
                activeId={activeId}
                editable={editable}
                canGrab={editable && !pending}
                onGrab={onGrab}
              />
              {pending && cursor && (
                <>
                  <line x1={pending.x * size.w} y1={pending.y * size.h} x2={cursor.x * size.w} y2={cursor.y * size.h} className="anno-leader" style={{ strokeWidth: 1.7 * z }} />
                  <circle cx={pending.x * size.w} cy={pending.y * size.h} r={3 * z} className="anno-joint" />
                  <circle cx={cursor.x * size.w} cy={cursor.y * size.h} r={R} className="anno-bubble ghost" style={{ strokeWidth: 1.9 * z }} />
                </>
              )}
              {editor.selected.map((pm) => (
                <SelectionEl key={`sel-${pm.id}`} pm={pm} W={size.w} H={size.h} z={z} editable={editable} multi={editor.selected.length > 1}
                  g={{
                    onHandle: (m, h, e) => editor.grabHandle(m, h, e, pxOf(e)),
                    onVertex: (m, i) => editor.grabVertex(m, i),
                    onAnchor: (m) => editor.grabAnchor(m),
                    onRotate: (m, e) => editor.grabRotate(m, e, pxOf(e)),
                  }} />
              ))}
            </svg>
            {editor.editingText != null && (() => {
              const pm = editor.pageMarkups.find((m) => m.id === editor.editingText);
              return pm ? (
                <TextEditOverlay pm={pm} W={size.w} H={size.h} z={z}
                  onCommit={(t) => { editor.setText(pm.id, t); editor.setEditingText(null); }}
                  onCancel={() => editor.setEditingText(null)} />
              ) : null;
            })()}

            {legendOn && (
              <Legend
                pos={legendPos}
                size={size}
                cssScale={renderedScale > 0 ? zoom / renderedScale : 1}
                selected={legendSel}
                totals={totals}
                editable={editable}
                onSelect={() => { setLegendSel(true); setSelId(null); }}
                onMove={(p) => { setLegendPos(p); persistLegend(p, true); }}
                onClose={() => { setLegendOn(false); setLegendSel(false); persistLegend(legendPos, false); }}
              />
            )}
          </div>
        </div>

        {/* floating tools (top-left) */}
        {guided === null && (
          <div className="anno-hud tl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="toolchest">
              {([
                ["bubble", "target", "Place weld bubbles (click a joint, then the bubble)"],
                ["select", "hand", "Select / pan (bubbles & legend are always drag-to-move)"],
                ["markup", "pencil", "Markups & Tool Chest — redline the iso: flanges, valves, clouds, notes"],
              ] as [Tool, IconName, string][]).map(([t, ico, label]) => (
                <button key={t} className={`tool ${tool === t ? "on" : ""}`} title={label} aria-label={label}
                  onClick={() => { setTool(t); if (t === "markup") setChestOpen(true); }} disabled={!editable && t !== "markup"}><Icon name={ico} size={16} /></button>
              ))}
            </div>
            <div className="welder-switch">
              <span className="ws-label">Welder</span>
              <select value={stamp} onChange={(e) => setStamp(e.target.value)} disabled={!editable}>
                <option value="">— pick —</option>
                {welders.map((w, i) => <option key={w.stamp} value={w.stamp}>{i < 9 ? `${i + 1}· ` : ""}{w.stamp} — {w.name}</option>)}
              </select>
            </div>
            <span className="anno-num">Next <b>W{nextNum}</b></span>
          </div>
        )}

        {/* floating actions (top-right) */}
        <div className="anno-hud tr" onMouseDown={(e) => e.stopPropagation()}>
          {editable && guided === null && fillable.length > 0 && (
            incomplete.length > 0 ? (
              <button className="btn btn-accent btn-sm" title={`${incomplete.length} weld${incomplete.length === 1 ? "" : "s"} still missing data — the walk starts at the first one and skips the rest`} onClick={startWalk}>
                <Icon name="play" size={12} /> Fill attributes ({incomplete.length} to do)
              </button>
            ) : (
              <button className="btn btn-sm" title="Every weld has its attributes. Walk them anyway, starting from the newest." onClick={startWalk}><Icon name="check" size={13} /> All filled · review</button>
            )
          )}
          <button className="btn btn-sm" title="Markups list — every redline on this sheet" onClick={() => setListOpen((v) => !v)}><Icon name="menu" size={14} />{editor.pageMarkups.length ? ` ${editor.pageMarkups.length}` : ""}</button>
          <div className="wo-more">
            <button className="btn btn-sm" title="Export the flattened weld map (drawing + bubbles + legend + markups) as a PDF" onClick={() => setExportMenu((v) => !v)} disabled={exporting}>{exporting ? "Exporting…" : <><Icon name="download" size={13} /> Weld map</>}</button>
            {exportMenu && (
              <div className="wo-more-menu" onMouseLeave={() => setExportMenu(false)}>
                <button onClick={() => doExport("reveal")}>Save PDF…</button>
                <button onClick={() => doExport("open")}>Open / Print</button>
                {drawing.work_order && editable && <button onClick={() => doExport("attach")}>Attach to quality package</button>}
              </div>
            )}
          </div>
          {!legendOn && <button className="btn btn-sm" title="Show the legend stamp" aria-label="Show legend" onClick={() => { setLegendOn(true); persistLegend(legendPos, true); }}><Icon name="tag" size={14} /></button>}
          <button className="btn btn-sm" title="How to use the weld map" onClick={() => setShowCoach(true)}>?</button>
          <button className="btn btn-sm" title={fullscreen ? "Exit full screen (Esc)" : "Full screen"} onClick={() => setFullscreen((v) => !v)}><Icon name={fullscreen ? "minimize" : "maximize"} size={14} /></button>
        </div>

        {/* zoom + page (bottom-right) */}
        <div className="anno-hud br" onMouseDown={(e) => e.stopPropagation()}>
          {pageTo > pageFrom && (
            <>
              <button className="btn btn-sm" disabled={pageNum <= pageFrom} onClick={() => setPageNum((p) => Math.max(pageFrom, p - 1))}>‹</button>
              <span className="anno-pglabel">Pg {pageNum - pageFrom + 1}/{pageTo - pageFrom + 1}</span>
              <button className="btn btn-sm" disabled={pageNum >= pageTo} onClick={() => setPageNum((p) => Math.min(pageTo, p + 1))}>›</button>
              <span className="anno-hud-div" />
            </>
          )}
          <button className="btn btn-sm" title="Zoom out" onClick={() => setZoom((s) => Math.max(0.2, (Math.ceil(s * 10 - 0.01) - 1) / 10))}>−</button>
          <button className="btn btn-sm" title="Reset to 100% (click) — double-click fits to width" onClick={resetZoom} onDoubleClick={fitToWidth}>{Math.round(zoom * 100)}%</button>
          <button className="btn btn-sm" title="Fit to width" aria-label="Fit to width" onClick={fitToWidth}><Icon name="fit" size={14} /></button>
          <button className="btn btn-sm" title="Zoom in" onClick={() => setZoom((s) => Math.min(6, (Math.floor(s * 10 + 0.01) + 1) / 10))}>+</button>
        </div>

        {/* hint (bottom-left) */}
        <div className={`anno-hud bl anno-hintchip ${pending || guided !== null ? "active" : ""}`}>{hint}</div>

        {/* markup tool chest (left dock) + markups list (right) */}
        {tool === "markup" && chestOpen && guided === null && (
          <ToolChest editor={editor} tools={mtools} onReloadTools={reloadTools} editable={editable}
            onClose={() => { setChestOpen(false); setTool(editable ? "bubble" : "select"); }} />
        )}
        {listOpen && guided === null && (
          <MarkupsList editor={editor} page={pageNum} onClose={() => setListOpen(false)}
            onJump={(pm) => {
              if (pm.page !== pageNum) setPageNum(pm.page);
              editor.setSelection([pm.id]);
              const b = bboxPx(pm, size.w, size.h);
              if (size.w && size.h) centerOn((b.x + b.w / 2) / size.w, (b.y + b.h / 2) / size.h, 330);
            }} />
        )}
        {!selWeld && editor.selected.length > 0 && guided === null && (
          <div className="anno-hud sel" onMouseDown={(e) => e.stopPropagation()}>
            <MarkupBar editor={editor} onAddToChest={() => setAddChest({ pms: editor.selected })}
              onEditText={(id) => editor.setEditingText(id)} onClose={() => editor.setSelection([])} />
          </div>
        )}
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={ctxItems(ctx.pm)} />}
        {addChest && (
          <AddToChestDialog pms={addChest.pms} W={size.w} H={size.h} categories={chestCats} initialCategory={addChest.cat}
            onClose={() => setAddChest(null)}
            onSaved={() => { setAddChest(null); reloadTools(); if (tool !== "markup") setTool("markup"); setChestOpen(true); }} />
        )}

        {/* selection bar (bottom-center) */}
        {selWeld && (
          <div className="anno-hud sel" onMouseDown={(e) => e.stopPropagation()}>
            <SelBar
              weld={selWeld}
              editable={editable}
              stamp={stamp}
              onRenumber={renumber}
              onReassign={() => reassign(selWeld.id)}
              onDelete={() => askDelete(selWeld.id)}
              onClose={() => setSelId(null)}
            />
          </div>
        )}

        {/* guided-fill — docked right drawer with guaranteed space */}
        {guided !== null && gActive && (
          <aside className="anno-drawer" style={{ width: DRAWER_W }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="walk-scope" onMouseDown={(e) => e.stopPropagation()}>
            <span className="badge badge-amber" title="Welds on this sheet still missing data">{incomplete.length} missing data</span>
            <div className="pill-tabs mini">
              <button className={!walkAll ? "active" : ""} disabled={incomplete.length === 0} onClick={() => setWalkAll(false)}>Only missing</button>
              <button className={walkAll ? "active" : ""} onClick={() => setWalkAll(true)}>All welds</button>
            </div>
          </div>
          <GuidedPopup
            key={gActive.id}
            weld={gActive}
            index={Math.max(0, walk.findIndex((w) => w.id === gActive.id))}
            total={walk.length}
            welders={welders}
            lookups={lookups}
            sizes={sizes}
            specOptions={specOptions}
            sticky={stickyRef.current}
            onSaveNext={async (changes) => {
              const w = fillable[guided];
              // Advance ONLY after the save lands. On a failed save (a
              // conflict from another user, a locked network DB) the walk
              // stays on this weld with the typed data intact — silently
              // discarding a form and toasting success would be data loss.
              try {
                await api.updateWeld({ ...w, ...changes });
              } catch (e) {
                toast.push("err", errMsg(e));
                await refreshWelds(); // pick up the fresh row_version for a retry
                return;
              }
              stickyRef.current = { ...stickyRef.current, ...pickSticky(changes) };
              const rows = await refreshWelds();
              const next = nextInWalk(w.id, rows, walkAll);
              if (!next) {
                setGuidedId(null);
                const left = rows.filter(isIncomplete).length;
                toast.push("ok", left ? `Walk finished — ${left} weld${left === 1 ? "" : "s"} still missing data` : "All welds filled — review & save");
                onComplete?.();
              } else setGuidedId(next.id);
            }}
            onBack={() => { const prev = nextInWalk(gActive.id, welds, walkAll, -1); if (prev) setGuidedId(prev.id); }}
            onSkip={() => {
              const next = nextInWalk(gActive.id, welds, walkAll);
              if (!next) { setGuidedId(null); onComplete?.(); }
              else setGuidedId(next.id);
            }}
            onExit={() => setGuidedId(null)}
          />
          </aside>
        )}

        {confirmDel && (
          <ConfirmDialog
            title={`Delete weld ${confirmDel.weld_number ?? `#${confirmDel.id}`}`}
            body={
              confirmDel.nde_result || confirmDel.date_welded
                ? "This weld already carries recorded data — deleting permanently destroys the record and its history. To exclude it while keeping the record, use Void in the weld grid instead."
                : "Removes the bubble and its weld record from the drawing. This cannot be undone."
            }
            confirmLabel="Delete weld"
            danger
            onConfirm={() => { const w = confirmDel; setConfirmDel(null); if (w) delWeld(w.id); }}
            onClose={() => setConfirmDel(null)}
          />
        )}
      </div>
    </div>
  );
}

function SelBar({
  weld, editable, stamp, onRenumber, onReassign, onDelete, onClose,
}: {
  weld: Weld;
  editable: boolean;
  stamp: string;
  onRenumber: (id: number, v: string) => Promise<boolean>;
  onReassign: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [num, setNum] = useState(weld.weld_number ?? "");
  useEffect(() => { setNum(weld.weld_number ?? ""); }, [weld.id, weld.weld_number]);

  const commit = async () => {
    if (num.trim() === (weld.weld_number ?? "")) return;
    const ok = await onRenumber(weld.id, num);
    if (!ok) setNum(weld.weld_number ?? ""); // duplicate / invalid → revert the input
  };

  return (
    <div className="anno-selbar">
      <span className="muted" style={{ fontSize: 12 }}>Weld&nbsp;#</span>
      <input
        className="sel-num"
        value={num}
        disabled={!editable}
        onChange={(e) => setNum(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setNum(weld.weld_number ?? ""); (e.target as HTMLInputElement).blur(); }
        }}
        onBlur={commit}
        title="Renumber this weld (must be unique on the drawing)"
      />
      <span className="muted" style={{ fontSize: 12 }}>welder {weld.stamp_number ?? "—"}</span>
      {editable && <span className="anno-sel-tip">drag the bubble to move · drag the joint dot to re-extend</span>}
      <div className="spacer" />
      {editable && (
        <>
          <button className="btn btn-sm" onClick={onReassign} disabled={!stamp}>Reassign to {stamp || "…"}</button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
        </>
      )}
      <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
    </div>
  );
}

const COACH = [
  { eyebrow: "We know you're new here", title: "Place a weld bubble", body: "Pick a welder, then click the weld joint on the map — a red leader line follows your cursor." },
  { eyebrow: "Step 2", title: "Drop it", body: "Click again where the bubble should sit. The W-number auto-increments and your welder stays selected — keep clicking down the line, no stopping." },
  { eyebrow: "Two welders on one spool?", title: "Swap seamlessly", body: "Switch the active welder anytime — or press number keys 1–9. The weld numbering keeps right on going." },
  { eyebrow: "The efficient way", title: "Place all, then fill", body: "Get every bubble down first, then hit “Fill attributes”. The map jumps to each weld and pulses it while a small card pops up right beside it, so you never lose track of which one is W4." },
];

function CoachMarks({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const c = COACH[i];
  const last = i === COACH.length - 1;
  return (
    <div className="coachmarks">
      <div className="coachmark">
        <div className="cm-eyebrow">{c.eyebrow}</div>
        <h5>{c.title}</h5>
        <p>{c.body}</p>
        <div className="cm-foot">
          <div className="cm-dots">{COACH.map((_, k) => <span key={k} className={`cm-dot ${k === i ? "on" : ""}`} />)}</div>
          {i > 0 && <button className="btn btn-sm btn-ghost" style={{ color: "#cdd9f5" }} onClick={() => setI(i - 1)}>Back</button>}
          {last ? <button className="btn btn-sm btn-accent" onClick={onDone}>Got it</button>
            : <button className="btn btn-sm" onClick={() => setI(i + 1)}>Next ›</button>}
          <button className="btn btn-sm btn-ghost" style={{ color: "#8ea1cf" }} onClick={onDone}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function Legend({
  pos, size, cssScale, selected, totals, editable, onMove, onSelect, onClose,
}: {
  pos: Pt; size: { w: number; h: number }; cssScale: number; selected: boolean;
  totals: [string, number][]; editable: boolean;
  onMove: (p: Pt) => void; onSelect: () => void; onClose: () => void;
}) {
  // Grab anywhere on the legend to move it (like a weld bubble). Window
  // listeners keep it glued to the cursor; the delta is divided by the
  // displayed size (rendered px × the CSS zoom) so it tracks 1:1 on screen.
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dispRef = useRef({ w: 1, h: 1 });
  dispRef.current = { w: (size.w || 1) * cssScale, h: (size.h || 1) * cssScale };
  const moveRef = useRef(onMove); moveRef.current = onMove;
  const onDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (!editable) return;
    e.preventDefault();
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const s = start.current; if (!s) return;
      const nx = s.x + (e.clientX - s.px) / dispRef.current.w;
      const ny = s.y + (e.clientY - s.py) / dispRef.current.h;
      moveRef.current({ x: Math.max(0, Math.min(0.98, nx)), y: Math.max(0, Math.min(0.98, ny)) });
    };
    const up = () => { start.current = null; setDragging(false); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging]);
  return (
    <div
      className={`wm-legend ${selected ? "sel" : ""}`}
      style={{ left: pos.x * size.w, top: pos.y * size.h, cursor: editable ? (dragging ? "grabbing" : "move") : "default", touchAction: "none" }}
      onMouseDown={onDown}
    >
      <div className="wm-legend-head">
        <span className="wm-grip">⠿</span> WELD MAP LEGEND
        {editable && <button className="wm-x" title="Hide legend" onClick={onClose} onMouseDown={(e) => e.stopPropagation()} aria-label="Hide legend"><Icon name="x" size={12} /></button>}
      </div>
      <div className="wm-legend-key">
        <svg width="42" height="42" viewBox="0 0 42 42">
          <circle cx="21" cy="21" r="16" className="anno-bubble" />
          <line x1="5" y1="21" x2="37" y2="21" className="anno-divider" />
          <text x="21" y="15" className="anno-txt">ID</text>
          <text x="21" y="31" className="anno-txt">W#</text>
        </svg>
        <div className="wm-legend-keytext"><div><b>top</b> = welder ID</div><div><b>bottom</b> = weld #</div></div>
      </div>
      <div className="wm-legend-status" title="Disposition marks on the bubbles">
        <span className="ok"><Icon name="check" size={10} stroke={3} /> accepted</span>
        <span className="bad">! rejected</span>
        <span className="rep">R repair</span>
        <span className="todo">? needs data</span>
      </div>
      <div className="wm-legend-tot">
        <div className="wm-legend-toth">Welders on this map</div>
        {totals.length === 0 && <div className="faint" style={{ fontSize: 11 }}>none yet</div>}
        {totals.map(([s, n]) => (
          <div key={s} className="wm-legend-row"><span className="wm-legend-stamp">{s}</span><span className="wm-legend-count">{n} weld{n === 1 ? "" : "s"}</span></div>
        ))}
      </div>
    </div>
  );
}

function GuidedPopup({
  weld, index, total, welders, lookups, sizes, specOptions, sticky, onSaveNext, onBack, onSkip, onExit,
}: {
  weld: Weld; index: number; total: number; welders: Welder[]; lookups: Lookups; sizes: number[];
  specOptions: string[]; sticky: Partial<Weld>;
  onSaveNext: (c: Partial<Weld>) => void | Promise<void>;
  onBack: () => void; onSkip: () => void; onExit: () => void;
}) {
  // Seed each field from the weld's own value, falling back to the carried-
  // forward value from the previous weld, so repeated data isn't re-typed.
  const mk = (w: Weld) => {
    const s = (k: keyof Weld) => {
      const v = w[k]; if (v !== undefined && v !== null && v !== "") return v as unknown;
      const sv = sticky[k]; return sv !== undefined && sv !== null ? sv : "";
    };
    const str = (k: keyof Weld) => { const v = s(k); return v == null ? "" : String(v); };
    const bool = (k: keyof Weld) => { const v = w[k] ?? sticky[k]; return !!v; };
    return {
      stamp_number: str("stamp_number"), size: str("size"), joint_type: str("joint_type"),
      groove_type: str("groove_type"), process: str("process"), schedule: str("schedule"),
      material: str("material"), line_spec: str("line_spec"),
      nde_percent: w.nde_percent ?? "", nde_types: w.nde_types ?? "",
      nde_result: w.nde_result ?? "", nde_date: w.nde_date ?? "",
      nde_override_reason: w.nde_override_reason ?? "", // per-weld, never carried
      date_welded: str("date_welded"),
      shop_or_field: str("shop_or_field"), material_group: str("material_group"),
      flange_class: str("flange_class"), service_category: str("service_category"),
      b31_code: str("b31_code"), aes_service: bool("aes_service"), new_to_existing: bool("new_to_existing"),
      ut_wall_existing: w.ut_wall_existing?.toString() ?? "", ut_wall_new: w.ut_wall_new?.toString() ?? "",
      hydro_status: str("hydro_status"), pwht_required: bool("pwht_required"), pwht_temp: w.pwht_temp ?? "",
      pmi_required: bool("pmi_required"),
    };
  };
  const [f, setF] = useState(mk(weld));
  const [showMore, setShowMore] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setF(mk(weld)); }, [weld.id]);
  // Autofocus the first field each time we land on a weld — no click needed.
  useEffect(() => {
    const t = setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>("select,input,.combo-input")?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [weld.id]);

  const changes = (): Partial<Weld> => ({
    stamp_number: f.stamp_number || null,
    size: f.size ? Number(f.size) : null, joint_type: f.joint_type || null, groove_type: f.groove_type || null,
    process: f.process || null, schedule: f.schedule || null, material: f.material || null,
    line_spec: f.line_spec || null, nde_percent: f.nde_percent || null, nde_types: f.nde_types || null,
    nde_result: f.nde_result || null, nde_date: f.nde_date || null, date_welded: f.date_welded || null,
    shop_or_field: f.shop_or_field || null, material_group: f.material_group || null,
    flange_class: f.flange_class || null, service_category: f.service_category || null,
    b31_code: f.b31_code || null, aes_service: f.aes_service, new_to_existing: f.new_to_existing,
    ut_wall_existing: f.ut_wall_existing ? Number(f.ut_wall_existing) : null,
    ut_wall_new: f.ut_wall_new ? Number(f.ut_wall_new) : null,
    hydro_status: f.hydro_status || null, pwht_required: f.pwht_required,
    pwht_temp: f.pwht_temp || null, pmi_required: f.pmi_required,
  });

  // Required-to-advance fields — the safety inputs that make a weld's NDE
  // determinable. The walk won't move on until they're set.
  const REQUIRED: { k: keyof typeof f; label: string }[] = [
    { k: "stamp_number", label: "Welder" }, { k: "date_welded", label: "Date welded" },
    { k: "size", label: "Size" }, { k: "joint_type", label: "Joint type" },
    { k: "shop_or_field", label: "Shop/Field" }, { k: "service_category", label: "Service" },
    { k: "flange_class", label: "Flange class" }, { k: "material", label: "Material" },
    { k: "nde_percent", label: "NDE %" },
  ];
  const missing = REQUIRED.filter((r) => !String(f[r.k] ?? "").trim());

  // The requirement is only asserted once we know which column (joint) and
  // which pair (shop vs field) apply — otherwise a default would be misleading.
  const driversReady = !!f.shop_or_field && !!f.joint_type;
  // The NDE result fields stay locked until the drivers that determine the
  // required coverage are all set (so you can't record NDE before the spec).
  const driversComplete = driversReady && !!f.service_category && !!f.flange_class && !!f.material;

  const [req, setReq] = useState<import("../../types").NdeRequirement | null>(null);
  useEffect(() => {
    if (!driversReady) { setReq(null); return; }
    let live = true;
    const id = setTimeout(() => {
      api.computeNde({ ...weld, ...changes() }).then((r) => { if (live) setReq(r); }).catch(logErr("computing NDE requirement"));
    }, 120);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const enteredPct = f.nde_percent.replace(/[^0-9]/g, "");
  // The requirement is authoritative only when the engine resolved every
  // driver. Fail closed: an unresolved requirement is never treated as a spec.
  const reqResolved = !!req && req.resolved;
  const mismatch = reqResolved && enteredPct && Number(enteredPct) < req!.required_percent;
  // Once the drivers are in, the requirement must resolve before the weld can be
  // saved — a weld whose required NDE % can't be determined can't be signed off.
  const reqBlocked = driversReady && !reqResolved;
  // Coverage below the Table 4 requirement is a documented deviation, not a
  // silent one: the walk won't advance until the reason is on record.
  const overrideMissing = !!mismatch && !f.nde_override_reason.trim();
  const canSave = missing.length === 0 && !reqBlocked && !overrideMissing;
  // In-flight guard: a double-tap on Save (or Enter) must not fire two saves
  // with the same row_version — the second would spuriously conflict.
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      // The reason lives only while the deviation does — meeting spec clears it.
      await onSaveNext({ ...changes(), nde_override_reason: mismatch ? f.nde_override_reason.trim() || null : null });
    } finally {
      setBusy(false);
    }
  };

  // Which fields were seeded from the previous weld (own value empty, sticky
  // filled) — disclosed so a carried value is never mistaken for entered data.
  const CARRY_LABELS: Partial<Record<keyof Weld, string>> = {
    stamp_number: "welder", date_welded: "date", size: "size", joint_type: "joint",
    shop_or_field: "shop/field", service_category: "service", flange_class: "flange class",
    material: "material", material_group: "mat. group", schedule: "schedule",
    groove_type: "groove", process: "process", line_spec: "line spec",
    b31_code: "code", hydro_status: "hydro",
  };
  const carried = STICKY_KEYS.filter((k) => {
    const own = weld[k], sv = sticky[k];
    return (own === undefined || own === null || own === "") &&
      sv !== undefined && sv !== null && sv !== "" && typeof sv !== "boolean";
  }).map((k) => CARRY_LABELS[k] ?? String(k));

  const opt = (k: string) => lookups[k] ?? [];
  const hasBreak = specOptions.length > 1;
  const tieIn = f.new_to_existing;
  const rq = <span className="req-star" title="required">*</span>;

  // Enter advances to the next field; on the last, it saves. Comboboxes commit
  // their own value on Enter and stop propagation, so Enter here means "move on".
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const root = rootRef.current; if (!root) return;
    const fields = Array.from(
      root.querySelectorAll<HTMLElement>("select, input:not([type=checkbox]), .combo-input")
    ).filter((el) => (el as HTMLInputElement).disabled !== true && el.offsetParent !== null);
    const i = fields.indexOf(e.target as HTMLElement);
    if (i >= 0 && i < fields.length - 1) fields[i + 1].focus();
    else save();
  };

  return (
    <div
      ref={rootRef}
      className="guided-inner"
      onKeyDown={onKeyDown}
    >
      <div className="guided-head">
        <span className="guided-weld">{weld.weld_number}</span>
        <span className="muted">welder {f.stamp_number || "—"}</span>
        <div className="spacer" />
        <span className="guided-prog">{index + 1}/{total}</span>
        <button className="btn btn-sm btn-ghost" onClick={onExit} title="Exit guided fill" aria-label="Exit guided fill"><Icon name="x" size={14} /></button>
      </div>
      <div className="guided-progbar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1}>
        <span style={{ width: `${Math.round(((index + 1) / Math.max(total, 1)) * 100)}%` }} />
      </div>
      {carried.length > 0 && (
        <div className="guided-carried" title="Inherited from the previous weld in this walk — change whatever differs before saving.">
          <Icon name="undo" size={11} /> carried forward: {carried.join(", ")}
        </div>
      )}

      {driversReady && req && !req.resolved ? (
        <div className="guided-req unresolved">
          <div className="guided-req-main">
            <span className="guided-req-pct">—</span>
            <span className="guided-req-method">requirement unresolved</span>
          </div>
          <div className="guided-req-note">
            The required NDE % can't be determined yet. Set / correct:
          </div>
          {req.blockers.map((b, i) => (
            <div key={i} className="guided-req-blocker">• {b}</div>
          ))}
        </div>
      ) : driversReady && req ? (
        <div className={`guided-req ${mismatch ? "warn" : ""}`}>
          <div className="guided-req-main">
            <span className="guided-req-pct">{req.required_percent}%</span>
            <span className="guided-req-method">{req.method}</span>
          </div>
          <div className="guided-req-note">{req.note}</div>
          {req.supplemental.map((s, i) => <div key={i} className="guided-req-sup">+ {s}</div>)}
          {mismatch && <div className="guided-req-mismatch">Entered {f.nde_percent} is below the required {req.required_percent}% — document the reason below</div>}
        </div>
      ) : (
        <div className="guided-req guided-req-idle">
          <div className="guided-req-note">Set <b>Shop/Field</b> and <b>Joint Type</b> to compute the required NDE %.</div>
        </div>
      )}

      <div className={`guided-fields ${driversComplete ? "" : "section-locked-nde"}`}>
        <div className={`field span2 ${cls(f.stamp_number)}`}><label>Welder{rq}</label>
          <select value={f.stamp_number} onChange={(e) => setF({ ...f, stamp_number: e.target.value })}>
            <option value="">— pick —</option>
            {welders.map((w) => <option key={w.stamp} value={w.stamp}>{w.stamp} — {w.name}</option>)}
          </select>
        </div>
        <div className={`field ${cls(f.date_welded)}`}><label>Date welded{rq}</label>
          <input type="date" value={f.date_welded} onChange={(e) => setF({ ...f, date_welded: e.target.value })} /></div>
        <div className={`field ${cls(f.size)}`}><label>Size (NPS){rq}</label><Combobox value={f.size} options={sizes.map(String)} allowCustom onChange={(v) => setF({ ...f, size: v })} /></div>

        <div className="guided-sec">Table 4 drivers → NDE %</div>
        <div className={`field ${cls(f.joint_type)}`}><label>Joint Type{rq}</label><Combobox value={f.joint_type} options={opt("joint_type")} onChange={(v) => setF({ ...f, joint_type: v })} /></div>
        <div className={`field ${cls(f.shop_or_field)}`}><label>Shop / Field{rq}</label>
          <select value={f.shop_or_field} onChange={(e) => setF({ ...f, shop_or_field: e.target.value })}>
            <option value="">—</option>{SHOP_FIELD.map((o) => <option key={o} value={o}>{o === "FW" ? "Field" : "Shop"}</option>)}
          </select></div>
        <div className={`field ${cls(f.material)}`}><label>Material{rq}</label><Combobox value={f.material} options={opt("material")} allowCustom onChange={(v) => setF({ ...f, material: v, material_group: "" })} /></div>
        <div className="field"><label>Mat. group</label>
          <select value={f.material_group} onChange={(e) => setF({ ...f, material_group: e.target.value })}>
            <option value="">auto</option>{MATERIAL_GROUPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div className={`field ${cls(f.service_category)}`}><label>Service{rq}</label>
          <select value={f.service_category} onChange={(e) => setF({ ...f, service_category: e.target.value })}>
            <option value="">—</option>{SERVICE_CATEGORIES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div className={`field ${cls(f.flange_class)}`}><label>Flange class{rq}</label>
          <select value={f.flange_class} onChange={(e) => setF({ ...f, flange_class: e.target.value })}>
            <option value="">—</option>{FLANGE_CLASSES.map((o) => <option key={o} value={o}>#{o}</option>)}
          </select></div>
        <label className="guided-check"><input type="checkbox" checked={f.aes_service} onChange={(e) => setF({ ...f, aes_service: e.target.checked })} /> AES service</label>
        <label className="guided-check"><input type="checkbox" checked={f.new_to_existing} onChange={(e) => setF({ ...f, new_to_existing: e.target.checked })} /> New-to-existing tie-in (100%)</label>
        {tieIn && <>
          <div className="guided-lock-note" style={{ color: "var(--text-muted)", background: "var(--surface-2)", borderColor: "var(--border)" }}>
            UT <b>thickness</b> gauging (not NDE) — confirm the existing pipe is thick enough to weld to. The lesser reading governs the wall &amp; makes this a 100% weld.
          </div>
          <div className="field"><label>UT wall — existing (in)</label>
            <input type="number" step="0.001" value={f.ut_wall_existing} onChange={(e) => setF({ ...f, ut_wall_existing: e.target.value })} /></div>
          <div className="field"><label>UT wall — new (in)</label>
            <input type="number" step="0.001" value={f.ut_wall_new} onChange={(e) => setF({ ...f, ut_wall_new: e.target.value })} /></div>
          {(f.ut_wall_existing || f.ut_wall_new) && (
            <div className="field span2"><label>Governing wall</label>
              <div className="guided-gov">{Math.min(...[f.ut_wall_existing, f.ut_wall_new].filter(Boolean).map(Number)).toFixed(3)} in (lesser)</div></div>
          )}
        </>}

        <div className="guided-sec">NDE result <span className="faint">(record after examination)</span></div>
        {!driversComplete && <div className="guided-lock-note">Set the Table 4 drivers above (Shop/Field, Joint, Service, Flange, Material) to unlock NDE entry.</div>}
        <div className={`field nde-field ${cls(f.nde_percent)}`}><label>NDE %{rq}
          {reqResolved && f.nde_percent.replace(/[^0-9]/g, "") !== String(req!.required_percent) &&
            <button type="button" className="use-req" onClick={() => setF({ ...f, nde_percent: `${req!.required_percent}%` })}>use {req!.required_percent}%</button>}
        </label><Combobox value={f.nde_percent} options={opt("nde_percent")} allowCustom onChange={(v) => setF({ ...f, nde_percent: v })} /></div>
        <div className="field nde-field"><label>Accept / Reject</label>
          <select value={f.nde_result} onChange={(e) => setF({ ...f, nde_result: e.target.value })}>
            {NDE_RESULTS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
          </select></div>
        {mismatch && (
          <div className={`field span2 nde-field ${cls(f.nde_override_reason)}`}>
            <label>Below-spec reason{rq}</label>
            <input
              value={f.nde_override_reason}
              onChange={(e) => setF({ ...f, nde_override_reason: e.target.value })}
              placeholder="Engineering disposition, inaccessible joint…"
              title="Why this weld's NDE coverage deviates from the Table 4 requirement — kept on the record and shown in Exceptions"
            />
          </div>
        )}
        <div className="field span2 nde-field"><label>NDE methods / passes</label>
          <InlineMulti value={f.nde_types} options={NDE_TYPE_OPTIONS} onCommit={(v) => setF({ ...f, nde_types: v ?? "" })} /></div>
        <div className="field nde-field"><label>NDE date</label>
          <input type="date" value={f.nde_date} onChange={(e) => setF({ ...f, nde_date: e.target.value })} /></div>

        <button type="button" className="guided-more-btn" onClick={() => setShowMore((v) => !v)}>
          <Icon name={showMore ? "chevronDown" : "chevronRight"} size={13} /> More — code, schedule, heat-treat, hydro
        </button>
        {showMore && <>
          <div className="field"><label>Code</label>
            <select value={f.b31_code} onChange={(e) => setF({ ...f, b31_code: e.target.value })}>
              <option value="">B31.3</option>{B31_CODES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select></div>
          <div className="field"><label>Schedule</label><Combobox value={f.schedule} options={opt("schedule")} allowCustom onChange={(v) => setF({ ...f, schedule: v })} /></div>
          {hasBreak && (
            <div className="field span2"><label>Line Spec <span className="faint">(break)</span></label>
              <Combobox value={f.line_spec} options={specOptions} allowCustom onChange={(v) => setF({ ...f, line_spec: v })} /></div>
          )}
          <div className="field"><label>Groove</label><Combobox value={f.groove_type} options={opt("groove_type")} onChange={(v) => setF({ ...f, groove_type: v })} /></div>
          <div className="field"><label>Process</label><Combobox value={f.process} options={opt("process")} onChange={(v) => setF({ ...f, process: v })} /></div>
          <label className="guided-check"><input type="checkbox" checked={f.pwht_required} onChange={(e) => setF({ ...f, pwht_required: e.target.checked })} /> PWHT required</label>
          {f.pwht_required && (
            <div className="field"><label>PWHT temp (°F)</label>
              <input value={f.pwht_temp} onChange={(e) => setF({ ...f, pwht_temp: e.target.value })} /></div>
          )}
          <label className="guided-check"><input type="checkbox" checked={f.pmi_required} onChange={(e) => setF({ ...f, pmi_required: e.target.checked })} /> PMI required</label>
          <div className="field span2"><label>Hydrotest</label>
            <select value={f.hydro_status} onChange={(e) => setF({ ...f, hydro_status: e.target.value })}>
              <option value="">—</option>{HYDRO_STATES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select></div>
        </>}
      </div>
      <div className="guided-foot">
        <button className="btn btn-sm" onClick={onBack} disabled={index === 0} title="Previous weld">‹ Prev</button>
        <button className="btn btn-sm" onClick={onSkip} title="Leave this weld unchanged and go to the next">Skip</button>
        <div className="spacer" />
        {missing.length > 0 && (
          <span className="guided-req-missing" title={`Missing: ${missing.map((m) => m.label).join(", ")}`}>Fill required ({missing.length})</span>
        )}
        {missing.length === 0 && reqBlocked && (
          <span className="guided-req-missing" title={req ? `Unresolved: ${req.blockers.join(", ")}` : "Determining requirement…"}>
            {req ? "NDE requirement unresolved" : "Determining…"}
          </span>
        )}
        {missing.length === 0 && !reqBlocked && overrideMissing && (
          <span className="guided-req-missing" title="NDE % is below the Table 4 requirement — enter the below-spec reason to save">
            Document below-spec reason
          </span>
        )}
        <button className="btn btn-accent btn-sm" onClick={save} disabled={!canSave || busy}
          title={
            missing.length > 0
              ? `Fill out all required fields: ${missing.map((m) => m.label).join(", ")}`
              : reqBlocked
              ? `Resolve the NDE requirement first: ${req ? req.blockers.join(", ") : "computing…"}`
              : overrideMissing
              ? "NDE % is below the requirement — document the deviation reason first"
              : ""
          }>
          {busy ? "Saving…" : index + 1 >= total ? <>{"Save & review"} <Icon name="check" size={14} /></> : <>{"Save & next"} <Icon name="arrowRight" size={14} /></>}
        </button>
      </div>
    </div>
  );
}

// Mark a field wrapper red when a required value is missing.
function cls(v: string): string { return v.trim() ? "" : "missing"; }
