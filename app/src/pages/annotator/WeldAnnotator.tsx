import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../../api";
import { useAuth } from "../../auth";
import type { Drawing, Lookups, Weld, Welder } from "../../types";
import { Spinner, useToast } from "../../components/ui";
import { Combobox, InlineMulti } from "../../components/inline";
import { base64ToBytes, loadPdf, type PdfDoc } from "../../pdf";

interface Pt { x: number; y: number }
type Tool = "bubble" | "select" | "pan" | "legend";

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
// A drag in progress on a selected weld: "both" translates the bubble + leader
// together (move the whole thing); "joint" moves only the joint end of the
// leader (re-extend / re-aim the line).
type DragState = {
  id: number; mode: "both" | "joint";
  sx: number; sy: number;   // where the drag started (normalised)
  bx: number; by: number;   // bubble at drag start
  jx: number; jy: number;   // joint at drag start
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
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Transform-based viewport: the page is translated by `pan` (px) inside a
  // non-scrolling stage, and `scale` is the render zoom. This replaces the
  // three fighting scrollbars with one grab-to-pan / ctrl-scroll-to-zoom model.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const downRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const scaleRef = useRef(1);
  const panStateRef = useRef({ x: 0, y: 0 });

  const [welds, setWelds] = useState<Weld[]>([]);
  const [stamp, setStamp] = useState("");
  const [nextNum, setNextNum] = useState(1);
  const [tool, setTool] = useState<Tool>("bubble");
  const [pending, setPending] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selId, setSelId] = useState<number | null>(null);

  const [legendOn, setLegendOn] = useState(true);
  const [legendPos, setLegendPos] = useState<Pt>({ x: 0.72, y: 0.04 });
  const legendKey = `wm-legend-${drawing.id}`;

  const [guided, setGuided] = useState<number | null>(null); // index into ordered welds
  // Carry-forward: the driver values last entered in the guided walk, so the
  // next weld inherits them and the welder only changes what differs.
  const stickyRef = useRef<Partial<Weld>>({});
  const [showCoach, setShowCoach] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem("wm-coach-seen")) setShowCoach(true); } catch { /* ignore */ }
  }, []);
  const dismissCoach = () => { setShowCoach(false); try { localStorage.setItem("wm-coach-seen", "1"); } catch { /* ignore */ } };

  const refreshWelds = useCallback(async () => {
    const rows = await api.listDrawingWelds(drawing.id);
    setWelds(rows);
    onChange?.(rows);
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
          const cw = (stageRef.current?.clientWidth ?? 900) - 24;
          setScale(Math.max(0.2, Math.min(3, cw / vp.width)));
          setPan({ x: 16, y: 16 });
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

  // render page
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext("2d")!;
      canvas.width = vp.width; canvas.height = vp.height;
      setSize({ w: vp.width, h: vp.height });
      try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
      const task = page.render({ canvasContext: ctx, viewport: vp });
      renderTaskRef.current = task;
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; };
  }, [pageNum, scale, hasPdf]);

  // With no PDF attached, give the blank grid a real pixel size so bubbles, the
  // legend and the guided-fill popup have coordinates to anchor to (otherwise
  // size stays {0,0} and everything collapses onto the origin).
  useEffect(() => {
    if (loading || hasPdf) return;
    if (size.w > 0 && size.h > 0) return;
    const cw = Math.max(700, (stageRef.current?.clientWidth ?? 900) - 24);
    setSize({ w: cw, h: Math.round(cw * 1.3) });
  }, [loading, hasPdf, size.w, size.h]);

  const ordered = useMemo(
    () => [...welds].sort((a, b) => (a.weld_number ?? "").localeCompare(b.weld_number ?? "", undefined, { numeric: true })),
    [welds]
  );

  // number-key welder shortcuts + Enter/Esc to end a run
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (guided !== null) return;
      if ((e.key === "Enter" || e.key === "Escape")) { setPending(null); setCursor(null); }
      if (/^[1-9]$/.test(e.key) && document.activeElement?.tagName !== "INPUT") {
        const w = welders[Number(e.key) - 1];
        if (w) setStamp(w.stamp);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [welders, guided]);

  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // Fit the page to the stage width and reset the pan. Used on load, page
  // change, fullscreen toggle, and the Fit button.
  const fitToWidth = useCallback(async () => {
    const doc = docRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    const avail = stage.clientWidth - 24;
    let base = 1;
    if (doc) {
      try {
        const vp = (await doc.getPage(pageNum)).getViewport({ scale: 1 });
        base = avail / vp.width;
      } catch { /* ignore */ }
    } else if (size.w > 0) {
      base = avail / size.w;
    }
    const s = Math.max(0.15, Math.min(4, base));
    setScale(s);
    setPan({ x: 12, y: 12 });
  }, [pageNum, size.w]);

  // Centre a normalized point in the stage. `rightInset` reserves space on the
  // right (the guided drawer) so the bubble is centred in the visible area.
  const centerOn = (nx: number, ny: number, rightInset = 0) => {
    const stage = stageRef.current;
    if (!stage) return;
    const availW = stage.clientWidth - rightInset;
    setPan({ x: availW / 2 - nx * size.w, y: stage.clientHeight / 2.15 - ny * size.h });
  };
  const DRAWER_W = 384;

  // Press on the background: begin either a pan (if the pointer moves) or a
  // click action (place / select / legend, on release without moving).
  const onStageDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (dragRef.current) return; // a bubble drag owns the gesture
    // A press on a bubble is handled by the bubble's own click/drag handlers.
    if ((e.target as Element).closest?.(".wm-g")) return;
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
    if (!editable || guided !== null) return;
    const p = norm(e);
    if (tool === "legend") { setLegendPos(p); setLegendOn(true); persistLegend(p, true); return; }
    if (tool === "select") { setSelId(null); return; }
    if (tool === "pan") return;
    // bubble tool
    if (!stamp) { toast.push("err", "Pick a welder first"); return; }
    if (!pending) { setSelId(null); setPending(p); setCursor(p); return; }
    await dropBubble(pending, p);
  };

  // Begin dragging a selected weld — the whole thing ("both") or just the joint.
  const startDrag = (w: Weld, mode: "both" | "joint", e: React.MouseEvent) => {
    if (!editable) return;
    const p = norm(e);
    dragRef.current = {
      id: w.id, mode, sx: p.x, sy: p.y,
      bx: w.bubble_x ?? 0, by: w.bubble_y ?? 0,
      jx: w.joint_x ?? w.bubble_x ?? 0, jy: w.joint_y ?? w.bubble_y ?? 0,
    };
  };

  const onMove = (e: React.MouseEvent) => {
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
    if (!d) return;
    const w = welds.find((x) => x.id === d.id);
    if (w && w.bubble_x != null && w.bubble_y != null) {
      try { await api.setWeldBubble(d.id, pageNum, w.bubble_x, w.bubble_y, w.joint_x ?? w.bubble_x, w.joint_y ?? w.bubble_y); } catch { /* ignore */ }
    }
  };

  // Release on the stage: finish a bubble drag, finish a pan, or — if the
  // pointer never moved — perform the tool's click action at that point.
  const onStageUp = async (e: React.MouseEvent) => {
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

  // welder totals for the legend
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    welds.forEach((w) => { if (w.stamp_number) m.set(w.stamp_number, (m.get(w.stamp_number) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [welds]);

  // guided fill: pan the active bubble to the centre of the stage
  useEffect(() => {
    if (guided === null) return;
    const w = ordered[guided];
    if (!w || w.bubble_x == null) return;
    if ((w.bubble_page ?? 1) !== pageNum) setPageNum(w.bubble_page ?? 1);
    centerOn(w.bubble_x ?? 0.5, w.bubble_y ?? 0.5, DRAWER_W);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, ordered, size.w, size.h, pageNum]);

  // Keep refs current for the native wheel handler (which must be non-passive
  // to preventDefault the browser's ctrl-zoom / page-scroll).
  scaleRef.current = scale;
  panStateRef.current = pan;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = stage.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const cur = scaleRef.current;
        const next = Math.max(0.15, Math.min(6, cur * factor));
        const r = next / cur;
        const p = panStateRef.current;
        setPan({ x: mx - (mx - p.x) * r, y: my - (my - p.y) * r });
        setScale(next);
      } else {
        const p = panStateRef.current;
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    stage.addEventListener("wheel", handler, { passive: false });
    return () => stage.removeEventListener("wheel", handler);
    // Re-attach once loading finishes and the stage element actually exists.
  }, [loading]);

  // Re-fit when entering/leaving fullscreen (the stage size changes). Esc exits.
  useEffect(() => {
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

  if (loading) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;

  const pageWelds = ordered.filter((w) => (w.bubble_page ?? 1) === pageNum && w.bubble_x != null);
  // Bubbles are drawn in rendered-pixel space, so their size scales with the
  // zoom — zooming out shrinks them (no crowding), zooming in enlarges them.
  const z = scale;
  const R = 17 * z;
  const activeId = guided !== null ? ordered[guided]?.id : null;
  // The line's spec(s). A spec break gives two — the guided popup then lets you
  // put each weld on the correct side of the break.
  const specOptions = [drawing.line_spec, drawing.line_spec_2].filter(Boolean) as string[];
  const gActive = guided !== null ? ordered[guided] : null;
  const panning = downRef.current?.moved ?? false;
  const placing = editable && tool === "bubble" && stamp && !pending;

  const hint = !editable ? "Read-only — drag to pan, Ctrl+scroll to zoom." :
    guided !== null ? `Guided fill — weld ${guided + 1} of ${ordered.length}. Enter for the next field, Save & next on the last.` :
    tool === "bubble" ? (!stamp ? "Pick a welder, then click a joint to start a leader." : pending ? "Click where the bubble goes." : "Click a joint to place a weld · drag to pan · Ctrl+scroll to zoom.") :
    tool === "select" ? "Click a bubble to edit — drag it to move, drag its joint dot to re-aim the leader." :
    "Click to place the legend · drag to pan.";

  const selWeld = selId != null && guided === null ? welds.find((x) => x.id === selId) : null;

  return (
    <div className={`anno ${fullscreen ? "anno-full" : ""}`}>
      {editable && showCoach && <CoachMarks onDone={dismissCoach} />}

      <div
        className="anno-stage"
        ref={stageRef}
        onMouseDown={onStageDown}
        onMouseMove={onMove}
        onMouseUp={onStageUp}
        onMouseLeave={() => { setCursor(null); if (dragRef.current) endDrag(); downRef.current = null; panRef.current = null; }}
        style={{ cursor: panning ? "grabbing" : placing ? "crosshair" : "grab" }}
      >
        {!hasPdf && <div className="anno-empty">No PDF attached — place bubbles on the blank grid, or attach the isometric in the previous step.</div>}

        {/* the page — translated (pan) and rendered at `scale` (zoom) */}
        <div className="anno-viewport" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <div className="anno-page" style={{ width: size.w || 800, height: size.h || 600 }}>
            <canvas ref={canvasRef} />
            <svg ref={svgRef} className="anno-svg" width={size.w || 800} height={size.h || 600}>
              {pageWelds.map((w) => {
                const cx = (w.bubble_x ?? 0) * size.w, cy = (w.bubble_y ?? 0) * size.h;
                const jx = (w.joint_x ?? w.bubble_x ?? 0) * size.w, jy = (w.joint_y ?? w.bubble_y ?? 0) * size.h;
                const sel = w.id === selId, active = w.id === activeId;
                const editing = sel && editable;
                const grab = editable && (sel || tool === "select");
                const selectable = tool === "select" || (tool === "bubble" && !pending);
                return (
                  <g key={w.id} className={`${active ? "wm-g active" : "wm-g"} ${editing ? "editing" : ""}`}
                    onClick={(e) => { if (selectable) { e.stopPropagation(); setSelId(w.id); } }}
                    onMouseDown={(e) => { if (grab) { e.stopPropagation(); setSelId(w.id); startDrag(w, "both", e); } }}
                    style={{ cursor: grab ? "move" : "pointer" }}
                  >
                    <line x1={jx} y1={jy} x2={cx} y2={cy} className={`anno-leader ${sel ? "sel" : ""}`} style={{ strokeWidth: (sel ? 2.4 : 1.7) * z }} />
                    <circle
                      cx={jx} cy={jy} r={(editing ? 7 : 2.6) * z}
                      className={`anno-joint ${editing ? "handle" : ""}`}
                      onMouseDown={editing ? (e) => { e.stopPropagation(); startDrag(w, "joint", e); } : undefined}
                      style={editing ? { cursor: "crosshair", strokeWidth: 2 * z } : undefined}
                    />
                    <circle cx={cx} cy={cy} r={R} className={`anno-bubble ${sel ? "sel" : ""} ${active ? "active" : ""}`} style={{ strokeWidth: (active ? 3 : sel ? 2.6 : 1.9) * z }} />
                    <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} className="anno-divider" style={{ strokeWidth: 1.4 * z }} />
                    <text x={cx} y={cy - R * 0.42} className="anno-txt" style={{ fontSize: 11 * z }}>{w.stamp_number ?? ""}</text>
                    <text x={cx} y={cy + R * 0.42} className="anno-txt" style={{ fontSize: 11 * z }}>{w.weld_number ?? ""}</text>
                  </g>
                );
              })}
              {pending && cursor && (
                <>
                  <line x1={pending.x * size.w} y1={pending.y * size.h} x2={cursor.x * size.w} y2={cursor.y * size.h} className="anno-leader" style={{ strokeWidth: 1.7 * z }} />
                  <circle cx={pending.x * size.w} cy={pending.y * size.h} r={3 * z} className="anno-joint" />
                  <circle cx={cursor.x * size.w} cy={cursor.y * size.h} r={R} className="anno-bubble ghost" style={{ strokeWidth: 1.9 * z }} />
                </>
              )}
            </svg>

            {legendOn && (
              <Legend
                pos={legendPos}
                size={size}
                totals={totals}
                editable={editable}
                onMove={(p) => { setLegendPos(p); persistLegend(p, true); }}
                onClose={() => { setLegendOn(false); persistLegend(legendPos, false); }}
              />
            )}
          </div>
        </div>

        {/* floating tools (top-left) */}
        {guided === null && (
          <div className="anno-hud tl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="toolchest">
              {([
                ["bubble", "◎", "Place weld bubbles"],
                ["select", "▧", "Select / move"],
                ["legend", "🏷", "Legend stamp"],
              ] as [Tool, string, string][]).map(([t, ico, label]) => (
                <button key={t} className={`tool ${tool === t ? "on" : ""}`} title={label} onClick={() => setTool(t)} disabled={!editable}>{ico}</button>
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
          {editable && guided === null && ordered.length > 0 && (
            <button className="btn btn-accent btn-sm" title="Walk each weld in order and fill its data" onClick={() => setGuided(0)}>▶ Fill attributes ({ordered.length})</button>
          )}
          {!legendOn && <button className="btn btn-sm" onClick={() => { setLegendOn(true); persistLegend(legendPos, true); }}>🏷</button>}
          <button className="btn btn-sm" title="How to use the weld map" onClick={() => setShowCoach(true)}>?</button>
          <button className="btn btn-sm" title={fullscreen ? "Exit full screen (Esc)" : "Full screen"} onClick={() => setFullscreen((v) => !v)}>{fullscreen ? "⤢" : "⛶"}</button>
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
          <button className="btn btn-sm" title="Zoom out" onClick={() => setScale((s) => Math.max(0.2, (Math.ceil(s * 10 - 0.01) - 1) / 10))}>−</button>
          <button className="btn btn-sm" title="Fit to width" onClick={fitToWidth}>{Math.round(scale * 100)}%</button>
          <button className="btn btn-sm" title="Zoom in" onClick={() => setScale((s) => Math.min(6, (Math.floor(s * 10 + 0.01) + 1) / 10))}>+</button>
        </div>

        {/* hint (bottom-left) */}
        <div className={`anno-hud bl anno-hintchip ${pending || guided !== null ? "active" : ""}`}>{hint}</div>

        {/* selection bar (bottom-center) */}
        {selWeld && (
          <div className="anno-hud sel" onMouseDown={(e) => e.stopPropagation()}>
            <SelBar
              weld={selWeld}
              editable={editable}
              stamp={stamp}
              onRenumber={renumber}
              onReassign={() => reassign(selWeld.id)}
              onDelete={() => delWeld(selWeld.id)}
              onClose={() => setSelId(null)}
            />
          </div>
        )}

        {/* guided-fill — docked right drawer with guaranteed space */}
        {guided !== null && gActive && (
          <aside className="anno-drawer" style={{ width: DRAWER_W }} onMouseDown={(e) => e.stopPropagation()}>
          <GuidedPopup
            key={gActive.id}
            weld={gActive}
            index={guided}
            total={ordered.length}
            welders={welders}
            lookups={lookups}
            sizes={sizes}
            specOptions={specOptions}
            sticky={stickyRef.current}
            onSaveNext={async (changes) => {
              const w = ordered[guided];
              stickyRef.current = { ...stickyRef.current, ...pickSticky(changes) };
              try {
                await api.updateWeld({ ...w, ...changes });
                await refreshWelds();
              } catch (e) { toast.push("err", errMsg(e)); }
              if (guided + 1 >= ordered.length) {
                setGuided(null);
                toast.push("ok", "All welds filled — review & save");
                onComplete?.();
              } else setGuided(guided + 1);
            }}
            onBack={() => setGuided((g) => (g && g > 0 ? g - 1 : 0))}
            onSkip={() => {
              if (guided + 1 >= ordered.length) { setGuided(null); onComplete?.(); }
              else setGuided(guided + 1);
            }}
            onExit={() => setGuided(null)}
          />
          </aside>
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
  { eyebrow: "The efficient way", title: "Place all, then fill", body: "Get every bubble down first, then hit “Fill attributes ▶”. The map jumps to each weld and pulses it while a small card pops up right beside it, so you never lose track of which one is W4." },
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
  pos, size, totals, editable, onMove, onClose,
}: {
  pos: Pt; size: { w: number; h: number };
  totals: [string, number][]; editable: boolean;
  onMove: (p: Pt) => void; onClose: () => void;
}) {
  // Drag by the header with window listeners — robust under the panned/zoomed
  // viewport (no CSS scale, so a client-pixel maps 1:1 to a rendered pixel).
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sizeRef = useRef(size); sizeRef.current = size;
  const moveRef = useRef(onMove); moveRef.current = onMove;
  const onMouseDownHead = (e: React.MouseEvent) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const s = start.current; if (!s) return;
      const nx = s.x + (e.clientX - s.px) / (sizeRef.current.w || 1);
      const ny = s.y + (e.clientY - s.py) / (sizeRef.current.h || 1);
      moveRef.current({ x: Math.max(0, Math.min(0.98, nx)), y: Math.max(0, Math.min(0.98, ny)) });
    };
    const up = () => { start.current = null; setDragging(false); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging]);
  return (
    <div className="wm-legend" style={{ left: pos.x * size.w, top: pos.y * size.h }} onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="wm-legend-head"
        style={{ cursor: editable ? (dragging ? "grabbing" : "grab") : "default", touchAction: "none" }}
        onMouseDown={onMouseDownHead}
      >
        <span className="wm-grip">⠿</span> WELD MAP LEGEND
        {editable && <button className="wm-x" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>✕</button>}
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
  onSaveNext: (c: Partial<Weld>) => void; onBack: () => void; onSkip: () => void; onExit: () => void;
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
      nde_result: w.nde_result ?? "", nde_date: w.nde_date ?? "", date_welded: str("date_welded"),
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
  ];
  const missing = REQUIRED.filter((r) => !String(f[r.k] ?? "").trim());
  const canSave = missing.length === 0;
  const save = () => { if (canSave) onSaveNext(changes()); };

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
      api.computeNde({ ...weld, ...changes() }).then((r) => { if (live) setReq(r); }).catch(() => {});
    }, 120);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const enteredPct = f.nde_percent.replace(/[^0-9]/g, "");
  const mismatch = req && enteredPct && Number(enteredPct) < req.required_percent;

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
        <button className="btn btn-sm btn-ghost" onClick={onExit} title="Exit guided fill">✕</button>
      </div>

      {driversReady && req ? (
        <div className={`guided-req ${mismatch ? "warn" : ""}`}>
          <div className="guided-req-main">
            <span className="guided-req-pct">{req.required_percent}%</span>
            <span className="guided-req-method">{req.method}</span>
          </div>
          <div className="guided-req-note">{req.note}</div>
          {req.supplemental.map((s, i) => <div key={i} className="guided-req-sup">＋ {s}</div>)}
          {mismatch && <div className="guided-req-mismatch">Entered {f.nde_percent} is below the required {req.required_percent}%</div>}
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
        <div className="field nde-field"><label>NDE %
          {driversReady && req && f.nde_percent.replace(/[^0-9]/g, "") !== String(req.required_percent) &&
            <button type="button" className="use-req" onClick={() => setF({ ...f, nde_percent: `${req.required_percent}%` })}>use {req.required_percent}%</button>}
        </label><Combobox value={f.nde_percent} options={opt("nde_percent")} allowCustom onChange={(v) => setF({ ...f, nde_percent: v })} /></div>
        <div className="field nde-field"><label>Accept / Reject</label>
          <select value={f.nde_result} onChange={(e) => setF({ ...f, nde_result: e.target.value })}>
            {NDE_RESULTS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
          </select></div>
        <div className="field span2 nde-field"><label>NDE methods / passes</label>
          <InlineMulti value={f.nde_types} options={NDE_TYPE_OPTIONS} onCommit={(v) => setF({ ...f, nde_types: v ?? "" })} /></div>
        <div className="field nde-field"><label>NDE date</label>
          <input type="date" value={f.nde_date} onChange={(e) => setF({ ...f, nde_date: e.target.value })} /></div>

        <button type="button" className="guided-more-btn" onClick={() => setShowMore((v) => !v)}>
          {showMore ? "▾" : "▸"} More — code, schedule, heat-treat, hydro
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
        {!canSave && <span className="guided-req-missing" title={`Missing: ${missing.map((m) => m.label).join(", ")}`}>Fill required ({missing.length})</span>}
        <button className="btn btn-accent btn-sm" onClick={save} disabled={!canSave}
          title={canSave ? "" : `Fill out all required fields: ${missing.map((m) => m.label).join(", ")}`}>
          {index + 1 >= total ? "Save & review ✓" : "Save & next ▶"}
        </button>
      </div>
    </div>
  );
}

// Mark a field wrapper red when a required value is missing.
function cls(v: string): string { return v.trim() ? "" : "missing"; }
