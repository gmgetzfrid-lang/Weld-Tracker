import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../../api";
import { useAuth } from "../../auth";
import type { Drawing, Lookups, Weld, Welder } from "../../types";
import { Spinner, useToast } from "../../components/ui";
import { Combobox } from "../../components/inline";
import { base64ToBytes, loadPdf, type PdfDoc } from "../../pdf";

interface Pt { x: number; y: number }
type Tool = "bubble" | "select" | "pan" | "legend";

export function WeldAnnotator({
  drawing,
  welders,
  lookups,
  sizes,
  onChange,
}: {
  drawing: Drawing;
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onChange?: (welds: Weld[]) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("editor");

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderTaskRef = useRef<any>(null);
  const dragRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPdf, setHasPdf] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });

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
          setHasPdf(true);
          const page = await doc.getPage(1);
          const vp = page.getViewport({ scale: 1 });
          const cw = (stageRef.current?.clientWidth ?? 900) - 24;
          setScale(Math.max(0.2, Math.min(3, cw / vp.width)));
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
    if (!pending) { setPending(p); setCursor(p); return; }
    await dropBubble(pending, p);
  };

  const onMove = (e: React.MouseEvent) => {
    if (pending) setCursor(norm(e));
    if (dragRef.current != null) {
      const p = norm(e);
      setWelds((prev) => prev.map((w) => (w.id === dragRef.current ? { ...w, bubble_x: p.x, bubble_y: p.y } : w)));
    }
  };
  const endDrag = async () => {
    const id = dragRef.current;
    dragRef.current = null;
    if (id == null) return;
    const w = welds.find((x) => x.id === id);
    if (w && w.bubble_x != null && w.bubble_y != null) {
      try { await api.setWeldBubble(id, pageNum, w.bubble_x, w.bubble_y, w.joint_x ?? w.bubble_x, w.joint_y ?? w.bubble_y); } catch { /* ignore */ }
    }
  };

  const reassign = async (id: number) => {
    const w = welds.find((x) => x.id === id);
    if (!w || !stamp) return;
    try { await api.updateWeld({ ...w, stamp_number: stamp }); await refreshWelds(); } catch (e) { toast.push("err", errMsg(e)); }
  };
  const delWeld = async (id: number) => {
    try { await api.deleteWeld(id); setSelId(null); await refreshWelds(); } catch (e) { toast.push("err", errMsg(e)); }
  };

  // welder totals for the legend
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    welds.forEach((w) => { if (w.stamp_number) m.set(w.stamp_number, (m.get(w.stamp_number) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [welds]);

  // guided fill: pan to the active bubble
  useEffect(() => {
    if (guided === null) return;
    const w = ordered[guided];
    if (!w || w.bubble_x == null) return;
    if ((w.bubble_page ?? 1) !== pageNum) setPageNum(w.bubble_page ?? 1);
    const stage = stageRef.current;
    if (stage) {
      stage.scrollTo({ left: (w.bubble_x ?? 0) * size.w - stage.clientWidth / 2, top: (w.bubble_y ?? 0) * size.h - stage.clientHeight / 2.4, behavior: "smooth" });
    }
  }, [guided, ordered, size.w, size.h, pageNum]);

  if (loading) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;

  const pageWelds = ordered.filter((w) => (w.bubble_page ?? 1) === pageNum && w.bubble_x != null);
  const R = 17;
  const activeId = guided !== null ? ordered[guided]?.id : null;
  // The line's spec(s). A spec break gives two — the guided popup then lets you
  // put each weld on the correct side of the break.
  const specOptions = [drawing.line_spec, drawing.line_spec_2].filter(Boolean) as string[];
  const gActive = guided !== null ? ordered[guided] : null;
  const gcx = (gActive?.bubble_x ?? 0) * size.w;
  const gcy = (gActive?.bubble_y ?? 0) * size.h;
  const gLeftSide = gcx > size.w * 0.55; // pop to the left when the bubble sits on the right

  const hint = !editable ? "Read-only." :
    guided !== null ? `Guided fill — weld ${guided + 1} of ${ordered.length}. Fill the card, press Enter for the next.` :
    tool === "bubble" ? (!stamp ? "Pick a welder, then click a joint to start a leader." : pending ? "Click where the bubble goes." : "Click a weld joint on the map.") :
    tool === "select" ? "Click a bubble to select; drag to move." :
    tool === "legend" ? "Click to place the legend stamp." : "Drag to pan.";

  return (
    <div className="anno">
      <div className="anno-toolbar">
        {/* tool chest */}
        <div className="toolchest">
          {([
            ["bubble", "◎", "Weld bubble"],
            ["select", "▧", "Select / move"],
            ["legend", "🏷", "Legend stamp"],
            ["pan", "✋", "Pan"],
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
        <label className="anno-num">Next&nbsp;<b>W{nextNum}</b></label>

        <div className="spacer" />
        {pageCount > 1 && (
          <div className="anno-pages">
            <button className="btn btn-sm" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>‹</button>
            <span className="muted">Pg {pageNum}/{pageCount}</span>
            <button className="btn btn-sm" disabled={pageNum >= pageCount} onClick={() => setPageNum((p) => p + 1)}>›</button>
          </div>
        )}
        <button className="btn btn-sm" onClick={() => setScale((s) => Math.max(0.2, s - 0.2))}>−</button>
        <span className="muted" style={{ width: 42, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button className="btn btn-sm" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>+</button>
        {editable && guided === null && ordered.length > 0 && (
          <button className="btn btn-sm btn-accent" onClick={() => setGuided(0)}>Fill attributes ▶</button>
        )}
        <button className="btn btn-sm" title="How to use the weld map" onClick={() => setShowCoach(true)}>?</button>
      </div>

      {editable && showCoach && <CoachMarks onDone={dismissCoach} />}

      <div className={`anno-hint ${pending || guided !== null ? "active" : ""}`}>{hint}</div>

      <div className="anno-stage" ref={stageRef} style={{ cursor: tool === "pan" ? "grab" : "default" }}>
        {!hasPdf && <div className="anno-empty">No PDF attached — place bubbles on the blank grid, or attach the isometric in the previous step.</div>}
        <div className="anno-page" style={{ width: size.w || 800, height: size.h || 600 }}>
          <canvas ref={canvasRef} />
          <svg
            ref={svgRef} className="anno-svg" width={size.w || 800} height={size.h || 600}
            style={{ cursor: editable && tool === "bubble" && stamp ? "crosshair" : "default" }}
            onClick={onStageClick} onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={() => { setCursor(null); endDrag(); }}
          >
            {pageWelds.map((w) => {
              const cx = (w.bubble_x ?? 0) * size.w, cy = (w.bubble_y ?? 0) * size.h;
              const jx = (w.joint_x ?? w.bubble_x ?? 0) * size.w, jy = (w.joint_y ?? w.bubble_y ?? 0) * size.h;
              const sel = w.id === selId, active = w.id === activeId;
              return (
                <g key={w.id} className={active ? "wm-g active" : "wm-g"}
                  onClick={(e) => { if (tool === "select") { e.stopPropagation(); setSelId(w.id); } }}
                  onMouseDown={(e) => { if (tool === "select") { e.stopPropagation(); dragRef.current = w.id; setSelId(w.id); } }}
                  style={{ cursor: tool === "select" ? "move" : "pointer" }}
                >
                  <line x1={jx} y1={jy} x2={cx} y2={cy} className="anno-leader" />
                  <circle cx={jx} cy={jy} r={2.5} className="anno-joint" />
                  <circle cx={cx} cy={cy} r={R} className={`anno-bubble ${sel ? "sel" : ""} ${active ? "active" : ""}`} />
                  <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} className="anno-divider" />
                  <text x={cx} y={cy - 4} className="anno-txt">{w.stamp_number ?? ""}</text>
                  <text x={cx} y={cy + R - 4} className="anno-txt">{w.weld_number ?? ""}</text>
                </g>
              );
            })}
            {pending && cursor && (
              <>
                <line x1={pending.x * size.w} y1={pending.y * size.h} x2={cursor.x * size.w} y2={cursor.y * size.h} className="anno-leader" />
                <circle cx={pending.x * size.w} cy={pending.y * size.h} r={3} className="anno-joint" />
                <circle cx={cursor.x * size.w} cy={cursor.y * size.h} r={R} className="anno-bubble ghost" />
              </>
            )}
          </svg>

          {/* Legend stamp overlay */}
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

          {/* Guided-fill popup, docked right beside the active weld bubble */}
          {guided !== null && gActive && (
            <GuidedPopup
              key={gActive.id}
              weld={gActive}
              index={guided}
              total={ordered.length}
              lookups={lookups}
              sizes={sizes}
              specOptions={specOptions}
              anchor={{ cx: gcx, cy: gcy, left: gLeftSide, pageH: size.h }}
              onSaveNext={async (changes) => {
                const w = ordered[guided];
                try {
                  await api.updateWeld({ ...w, ...changes });
                  await refreshWelds();
                } catch (e) { toast.push("err", errMsg(e)); }
                if (guided + 1 >= ordered.length) { setGuided(null); toast.push("ok", "All welds filled"); }
                else setGuided(guided + 1);
              }}
              onBack={() => setGuided((g) => (g && g > 0 ? g - 1 : 0))}
              onSkip={() => { if (guided + 1 >= ordered.length) setGuided(null); else setGuided(guided + 1); }}
              onExit={() => setGuided(null)}
            />
          )}
        </div>
      </div>

      {!legendOn && (
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => { setLegendOn(true); persistLegend(legendPos, true); }}>Show legend</button>
      )}

      {selId != null && guided === null && (
        <div className="anno-selbar">
          {(() => { const w = welds.find((x) => x.id === selId); return (
            <>
              <strong>Weld {w?.weld_number}</strong><span className="muted">welder {w?.stamp_number ?? "—"}</span>
              <div className="spacer" />
              {editable && <>
                <button className="btn btn-sm" onClick={() => reassign(selId)} disabled={!stamp}>Reassign to {stamp || "…"}</button>
                <button className="btn btn-sm btn-danger" onClick={() => delWeld(selId)}>Delete</button>
              </>}
              <button className="btn btn-sm btn-ghost" onClick={() => setSelId(null)}>Close</button>
            </>
          ); })()}
        </div>
      )}

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
  // Pointer-capture drag: grabbing the header keeps the legend glued to the
  // cursor even when it moves fast or leaves the box — it moves on the page
  // exactly like a weld bubble, not like a floating window.
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable) return;
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const nx = start.current.x + (e.clientX - start.current.px) / (size.w || 1);
    const ny = start.current.y + (e.clientY - start.current.py) / (size.h || 1);
    onMove({ x: Math.max(0, Math.min(0.98, nx)), y: Math.max(0, Math.min(0.98, ny)) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    start.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  return (
    <div className="wm-legend" style={{ left: pos.x * size.w, top: pos.y * size.h }}>
      <div
        className="wm-legend-head"
        style={{ cursor: editable ? "grab" : "default", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="wm-grip">⠿</span> WELD MAP LEGEND
        {editable && <button className="wm-x" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>✕</button>}
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
  weld, index, total, lookups, sizes, specOptions, anchor, onSaveNext, onBack, onSkip, onExit,
}: {
  weld: Weld; index: number; total: number; lookups: Lookups; sizes: number[];
  specOptions: string[];
  anchor: { cx: number; cy: number; left: boolean; pageH: number };
  onSaveNext: (c: Partial<Weld>) => void; onBack: () => void; onSkip: () => void; onExit: () => void;
}) {
  const mk = (w: Weld) => ({
    size: w.size?.toString() ?? "", joint_type: w.joint_type ?? "", groove_type: w.groove_type ?? "",
    process: w.process ?? "", schedule: w.schedule ?? "", material: w.material ?? "",
    line_spec: w.line_spec ?? "", nde_percent: w.nde_percent ?? "",
  });
  const [f, setF] = useState(mk(weld));
  useEffect(() => { setF(mk(weld)); }, [weld.id]);
  const save = () => onSaveNext({
    size: f.size ? Number(f.size) : null, joint_type: f.joint_type || null, groove_type: f.groove_type || null,
    process: f.process || null, schedule: f.schedule || null, material: f.material || null,
    line_spec: f.line_spec || null, nde_percent: f.nde_percent || null,
  });
  const opt = (k: string) => lookups[k] ?? [];
  const hasBreak = specOptions.length > 1;

  const W = 312;
  const left = anchor.left ? Math.max(8, anchor.cx - W - 34) : anchor.cx + 34;
  const top = Math.max(8, anchor.cy - 54);

  return (
    <div
      className={`guided-pop ${anchor.left ? "to-left" : "to-right"}`}
      style={{ left, top, width: W }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "INPUT") save(); }}
    >
      <div className="guided-head">
        <span className="guided-weld">{weld.weld_number}</span>
        <span className="muted">welder {weld.stamp_number ?? "—"}</span>
        <div className="spacer" />
        <span className="guided-prog">{index + 1}/{total}</span>
        <button className="btn btn-sm btn-ghost" onClick={onExit} title="Exit guided fill">✕</button>
      </div>
      <div className="guided-fields">
        <div className="field"><label>Size (NPS)</label><Combobox value={f.size} options={sizes.map(String)} allowCustom onChange={(v) => setF({ ...f, size: v })} /></div>
        <div className="field"><label>Joint Type</label><Combobox value={f.joint_type} options={opt("joint_type")} onChange={(v) => setF({ ...f, joint_type: v })} /></div>
        <div className="field"><label>Schedule</label><Combobox value={f.schedule} options={opt("schedule")} allowCustom onChange={(v) => setF({ ...f, schedule: v })} /></div>
        <div className="field"><label>Material</label><Combobox value={f.material} options={opt("material")} allowCustom onChange={(v) => setF({ ...f, material: v })} /></div>
        {hasBreak && (
          <div className="field span2"><label>Line Spec <span className="faint">(spec break)</span></label>
            <Combobox value={f.line_spec} options={specOptions} allowCustom onChange={(v) => setF({ ...f, line_spec: v })} /></div>
        )}
        <div className="field"><label>Groove</label><Combobox value={f.groove_type} options={opt("groove_type")} onChange={(v) => setF({ ...f, groove_type: v })} /></div>
        <div className="field"><label>Process</label><Combobox value={f.process} options={opt("process")} onChange={(v) => setF({ ...f, process: v })} /></div>
        <div className="field"><label>NDE %</label><Combobox value={f.nde_percent} options={opt("nde_percent")} allowCustom onChange={(v) => setF({ ...f, nde_percent: v })} /></div>
      </div>
      <div className="guided-foot">
        <button className="btn btn-sm" onClick={onBack} disabled={index === 0}>‹</button>
        <button className="btn btn-sm" onClick={onSkip}>Skip</button>
        <div className="spacer" />
        <button className="btn btn-accent btn-sm" onClick={save}>{index + 1 >= total ? "Save & finish ✓" : "Save & next ▶"}</button>
      </div>
    </div>
  );
}
