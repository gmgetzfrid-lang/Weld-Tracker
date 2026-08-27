import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../../api";
import { useAuth } from "../../auth";
import type { Drawing, Weld, Welder } from "../../types";
import { Spinner, useToast } from "../../components/ui";
import { base64ToBytes, loadPdf, type PdfDoc } from "../../pdf";

interface Pt {
  x: number;
  y: number;
}

export function WeldAnnotator({
  drawing,
  welders,
  onChange,
}: {
  drawing: Drawing;
  welders: Welder[];
  onChange?: (welds: Weld[]) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("editor");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderTaskRef = useRef<any>(null);
  const createdStack = useRef<number[]>([]);

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
  const [pending, setPending] = useState<Pt | null>(null); // joint point (normalized)
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selId, setSelId] = useState<number | null>(null);

  const refreshWelds = useCallback(async () => {
    const rows = await api.listDrawingWelds(drawing.id);
    setWelds(rows);
    onChange?.(rows);
  }, [drawing.id, onChange]);

  // Load PDF + welds + next number once.
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
          // fit width
          const page = await doc.getPage(1);
          const vp = page.getViewport({ scale: 1 });
          const cw = (containerRef.current?.clientWidth ?? 900) - 24;
          setScale(Math.max(0.2, Math.min(3, cw / vp.width)));
        }
      } catch (e) {
        setError(errMsg(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id]);

  // Render current page whenever page/scale changes.
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
      canvas.width = vp.width;
      canvas.height = vp.height;
      setSize({ w: vp.width, h: vp.height });
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* ignore */
      }
      const task = page.render({ canvasContext: ctx, viewport: vp });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* render cancelled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, hasPdf]);

  // Keyboard: Enter/Esc end the current leader run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        setPending(null);
        setCursor(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        undoLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welds]);

  const norm = (e: React.MouseEvent): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onStageClick = async (e: React.MouseEvent) => {
    if (!editable) return;
    setSelId(null);
    if (!stamp) {
      toast.push("err", "Select a welder first");
      return;
    }
    const p = norm(e);
    if (!pending) {
      // first click = weld joint
      setPending(p);
      setCursor(p);
      return;
    }
    // second click = drop the bubble
    try {
      const num = String(nextNum);
      const w = await api.addBubbleWeld(
        drawing.id,
        stamp,
        num,
        pageNum,
        p.x,
        p.y,
        pending.x,
        pending.y
      );
      createdStack.current.push(w.id);
      setWelds((prev) => {
        const next = [...prev, w];
        onChange?.(next);
        return next;
      });
      setNextNum((n) => n + 1);
      setPending(null); // stay armed for the next joint
    } catch (err) {
      toast.push("err", errMsg(err));
    }
  };

  const onMove = (e: React.MouseEvent) => {
    if (pending) setCursor(norm(e));
  };

  const undoLast = async () => {
    const id = createdStack.current.pop();
    if (id == null) return;
    try {
      await api.deleteWeld(id);
      await refreshWelds();
      toast.push("ok", "Removed last bubble");
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const reassignSelected = async () => {
    const w = welds.find((x) => x.id === selId);
    if (!w || !stamp) return;
    try {
      await api.updateWeld({ ...w, stamp_number: stamp });
      await refreshWelds();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const deleteSelected = async () => {
    if (selId == null) return;
    try {
      await api.deleteWeld(selId);
      setSelId(null);
      await refreshWelds();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;

  const pageWelds = welds.filter(
    (w) => (w.bubble_page ?? 1) === pageNum && w.bubble_x != null && w.bubble_y != null
  );
  const R = 17;
  const hint = !editable
    ? "Read-only — you need editor access to place bubbles."
    : !stamp
    ? "① Select a welder to arm the bubble tool."
    : pending
    ? "② Click where the bubble should sit — the number auto-increments."
    : "① Click a weld joint on the drawing to pull a leader line.";

  return (
    <div className="anno">
      <div className="anno-toolbar">
        <div className="field" style={{ margin: 0, minWidth: 210 }}>
          <select value={stamp} onChange={(e) => setStamp(e.target.value)} disabled={!editable}>
            <option value="">— select welder —</option>
            {welders.map((w) => (
              <option key={w.stamp} value={w.stamp}>
                {w.stamp} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <label className="anno-num">
          Next&nbsp;#
          <input
            type="number"
            value={nextNum}
            min={1}
            disabled={!editable}
            onChange={(e) => setNextNum(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button className="btn btn-sm" onClick={undoLast} disabled={!editable}>↶ Undo</button>
        <div className="spacer" />
        {pageCount > 1 && (
          <div className="anno-pages">
            <button className="btn btn-sm" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>‹</button>
            <span className="muted">Page {pageNum}/{pageCount}</span>
            <button className="btn btn-sm" disabled={pageNum >= pageCount} onClick={() => setPageNum((p) => p + 1)}>›</button>
          </div>
        )}
        <button className="btn btn-sm" onClick={() => setScale((s) => Math.max(0.2, s - 0.2))}>−</button>
        <span className="muted" style={{ width: 44, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button className="btn btn-sm" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>+</button>
      </div>

      <div className={`anno-hint ${pending ? "active" : ""}`}>{hint}</div>

      <div className="anno-stage" ref={containerRef}>
        {!hasPdf ? (
          <div className="anno-empty">
            No PDF attached to this drawing. You can still place bubbles on a blank
            grid, or attach the isometric PDF in the previous step.
          </div>
        ) : null}
        <div
          className="anno-page"
          style={{ width: size.w || 800, height: size.h || 600 }}
        >
          <canvas ref={canvasRef} />
          <svg
            ref={svgRef}
            className="anno-svg"
            width={size.w || 800}
            height={size.h || 600}
            style={{ cursor: editable && stamp ? "crosshair" : "default" }}
            onClick={onStageClick}
            onMouseMove={onMove}
            onMouseLeave={() => setCursor(null)}
          >
            {/* placed bubbles */}
            {pageWelds.map((w) => {
              const cx = (w.bubble_x ?? 0) * size.w;
              const cy = (w.bubble_y ?? 0) * size.h;
              const jx = (w.joint_x ?? w.bubble_x ?? 0) * size.w;
              const jy = (w.joint_y ?? w.bubble_y ?? 0) * size.h;
              const sel = w.id === selId;
              return (
                <g
                  key={w.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelId(w.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <line x1={jx} y1={jy} x2={cx} y2={cy} className="anno-leader" />
                  <circle cx={jx} cy={jy} r={2.5} className="anno-joint" />
                  <circle cx={cx} cy={cy} r={R} className={`anno-bubble ${sel ? "sel" : ""}`} />
                  <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} className="anno-divider" />
                  <text x={cx} y={cy - 4} className="anno-txt">{w.stamp_number ?? ""}</text>
                  <text x={cx} y={cy + R - 4} className="anno-txt">{w.weld_number ?? ""}</text>
                </g>
              );
            })}
            {/* rubber-band leader */}
            {pending && cursor && (
              <>
                <line
                  x1={pending.x * size.w}
                  y1={pending.y * size.h}
                  x2={cursor.x * size.w}
                  y2={cursor.y * size.h}
                  className="anno-leader pending"
                />
                <circle cx={pending.x * size.w} cy={pending.y * size.h} r={3} className="anno-joint" />
                <circle cx={cursor.x * size.w} cy={cursor.y * size.h} r={R} className="anno-bubble ghost" />
              </>
            )}
          </svg>
        </div>
      </div>

      {selId != null && (
        <div className="anno-selbar">
          {(() => {
            const w = welds.find((x) => x.id === selId);
            return (
              <>
                <strong>Weld {w?.weld_number}</strong>
                <span className="muted">welder {w?.stamp_number ?? "—"}</span>
                <div className="spacer" />
                {editable && (
                  <>
                    <button className="btn btn-sm" onClick={reassignSelected} disabled={!stamp}>
                      Reassign to {stamp || "…"}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={deleteSelected}>Delete</button>
                  </>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setSelId(null)}>Close</button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
