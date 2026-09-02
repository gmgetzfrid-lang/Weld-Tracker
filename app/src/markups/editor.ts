// The markup editor: tool state, drafting, selection, dragging, history, and
// persistence. WeldAnnotator owns the stage and hands pointer events here.
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../api";
import type { Markup, MarkupKind } from "../types";
import {
  DEFAULT_STYLE, HIGHLIGHT, bboxPx, groupOf, instantiate, normBox, parseMarkup, resizeBox, rotatePt, simplify,
  toRow, translated, type Box, type Handle, type MData, type PM, type Pt, type Style, type ToolTemplate,
} from "./model";

export type DrawKind = "line" | "arrow" | "polyline" | "pen" | "rect" | "ellipse" | "cloud" | "highlight" | "text" | "callout" | "dimension";
export type MTool =
  | { type: "select" }
  | { type: "draw"; kind: DrawKind; styleOverride?: Partial<Style>; name?: string }
  | { type: "place"; template: ToolTemplate; name: string };

export interface Draft { kind: DrawKind; start: Pt; cur: Pt; pts: Pt[] }

type Drag =
  | { type: "move"; ids: number[]; start: Pt; orig: Map<number, PM>; moved: boolean }
  | { type: "handle"; id: number; handle: Handle; orig: PM; start: Pt }
  | { type: "vertex"; id: number; index: number; orig: PM }
  | { type: "anchor"; id: number; orig: PM }
  | { type: "rotate"; id: number; orig: PM; center: Pt; startAngle: number };

interface Opts {
  drawingId: number;
  page: number;
  W: number;
  H: number;
  editable: boolean;
  toast: (kind: "ok" | "err", msg: string) => void;
}

const HISTORY_MAX = 60;

export function useMarkupEditor({ drawingId, page, W, H, editable, toast }: Opts) {
  const [all, setAll] = useState<PM[]>([]);
  const [selection, setSelection] = useState<number[]>([]);
  const [tool, setToolState] = useState<MTool>({ type: "select" });
  const [style, setStyleState] = useState<Style>({ ...DEFAULT_STYLE });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingText, setEditingText] = useState<number | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const allRef = useRef<PM[]>([]);
  allRef.current = all;
  const hist = useRef<{ stack: PM[][]; idx: number }>({ stack: [], idx: -1 });
  const clipRef = useRef<PM[]>([]);
  const recentRef = useRef<string[]>([]);

  const pageMarkups = useMemo(() => all.filter((m) => m.page === page).sort((a, b) => a.z - b.z || a.id - b.id), [all, page]);
  const selected = useMemo(() => pageMarkups.filter((m) => selection.includes(m.id)), [pageMarkups, selection]);

  // ---- load + history -------------------------------------------------------
  const snapshot = useCallback(() => allRef.current.filter((m) => m.page === page).map((m) => ({ ...m, d: JSON.parse(JSON.stringify(m.d)) as MData })), [page]);
  const pushHistory = useCallback(() => {
    const h = hist.current;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(snapshot());
    if (h.stack.length > HISTORY_MAX) h.stack.shift();
    h.idx = h.stack.length - 1;
    setHistVersion((v) => v + 1);
  }, [snapshot]);

  const load = useCallback(async () => {
    try {
      const rows = await api.listMarkups(drawingId);
      setAll(rows.map(parseMarkup));
    } catch (e) { toast("err", `Could not load markups: ${errMsg(e)}`); }
  }, [drawingId, toast]);
  useEffect(() => { load(); }, [load]);
  // Start history from the loaded state of this page.
  useEffect(() => {
    hist.current = { stack: [], idx: -1 };
    const t = setTimeout(() => { hist.current = { stack: [snapshot()], idx: 0 }; setHistVersion((v) => v + 1); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, drawingId, all.length === 0]);

  // ---- persistence ----------------------------------------------------------
  const persistCreate = useCallback(async (kind: MarkupKind, d: MData, subject?: string | null): Promise<PM | null> => {
    try {
      const row = await api.createMarkup({ drawing_id: drawingId, page, kind, data: JSON.stringify(d), subject: subject ?? null } as Partial<Markup>);
      const pm = parseMarkup(row);
      setAll((prev) => [...prev, pm]);
      allRef.current = [...allRef.current, pm];
      return pm;
    } catch (e) { toast("err", errMsg(e)); return null; }
  }, [drawingId, page, toast]);

  const persistUpdate = useCallback((pm: PM) => {
    setAll((prev) => prev.map((m) => (m.id === pm.id ? pm : m)));
    allRef.current = allRef.current.map((m) => (m.id === pm.id ? pm : m));
    api.updateMarkup(toRow(pm)).catch(async (e) => { toast("err", errMsg(e)); await load(); });
  }, [load, toast]);

  const persistDelete = useCallback((ids: number[]) => {
    setAll((prev) => prev.filter((m) => !ids.includes(m.id)));
    allRef.current = allRef.current.filter((m) => !ids.includes(m.id));
    for (const id of ids) api.deleteMarkup(id).catch(async (e) => { toast("err", errMsg(e)); await load(); });
  }, [load, toast]);

  /** Bring this page to a history snapshot: delete extras, recreate missing, update changed. */
  const applySnapshot = useCallback(async (target: PM[]) => {
    const cur = allRef.current.filter((m) => m.page === page);
    const curIds = new Set(cur.map((m) => m.id));
    const tgtIds = new Set(target.map((m) => m.id));
    const toDelete = cur.filter((m) => !tgtIds.has(m.id)).map((m) => m.id);
    if (toDelete.length) persistDelete(toDelete);
    for (const t of target) {
      if (!curIds.has(t.id)) {
        const made = await persistCreate(t.kind, t.d, t.subject);
        if (made) {
          // The recreated markup has a new id — rewrite it through history.
          const old = t.id;
          for (const snap of hist.current.stack) for (const m of snap) if (m.id === old) m.id = made.id;
          if (t.comment || t.status !== "Open" || t.locked) persistUpdate({ ...made, comment: t.comment, status: t.status, locked: t.locked });
        }
      } else {
        const c = cur.find((m) => m.id === t.id)!;
        if (JSON.stringify(c.d) !== JSON.stringify(t.d) || c.subject !== t.subject || c.comment !== t.comment || c.status !== t.status || c.locked !== t.locked || c.z !== t.z) {
          persistUpdate({ ...c, d: JSON.parse(JSON.stringify(t.d)), subject: t.subject, comment: t.comment, status: t.status, locked: t.locked, z: t.z });
        }
      }
    }
    setSelection([]);
  }, [page, persistCreate, persistDelete, persistUpdate]);

  const canUndo = hist.current.idx > 0;
  const canRedo = hist.current.idx < hist.current.stack.length - 1;
  const undo = useCallback(async () => {
    const h = hist.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    await applySnapshot(h.stack[h.idx]);
    setHistVersion((v) => v + 1);
  }, [applySnapshot]);
  const redo = useCallback(async () => {
    const h = hist.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    await applySnapshot(h.stack[h.idx]);
    setHistVersion((v) => v + 1);
  }, [applySnapshot]);

  // ---- tool ------------------------------------------------------------------
  const setTool = useCallback((t: MTool) => {
    setDraft(null);
    setToolState(t);
    if (t.type !== "select") setSelection([]);
    if (t.type === "place") recentRef.current = [t.name, ...recentRef.current.filter((n) => n !== t.name)].slice(0, 8);
  }, []);
  const effStyle = useMemo<Style>(() => {
    if (tool.type === "draw") {
      const base = { ...style, ...(tool.styleOverride ?? {}) };
      if (tool.kind === "highlight") return { ...base, fill: base.fill ?? HIGHLIGHT, stroke: base.stroke };
      return base;
    }
    return style;
  }, [style, tool]);

  // ---- create helpers --------------------------------------------------------
  const norm = (p: Pt): Pt => ({ x: p.x / W, y: p.y / H });
  const finishDraft = useCallback(async (dr: Draft) => {
    const s = { ...effStyle };
    const box: Box = normBox({ x: dr.start.x, y: dr.start.y, w: dr.cur.x - dr.start.x, h: dr.cur.y - dr.start.y });
    const tiny = Math.hypot((dr.cur.x - dr.start.x) * W, (dr.cur.y - dr.start.y) * H) < 3;
    let created: PM | null = null;
    switch (dr.kind) {
      case "line": case "arrow": case "dimension":
        if (tiny) return;
        created = await persistCreate(dr.kind, { style: dr.kind === "arrow" ? { ...s, arrowEnd: true } : s, pts: [dr.start, dr.cur], text: dr.kind === "dimension" ? "" : undefined });
        break;
      case "rect": case "ellipse": case "cloud": case "highlight":
        if (tiny) return;
        created = await persistCreate(dr.kind, { style: dr.kind === "highlight" ? { ...s, fill: s.fill ?? HIGHLIGHT } : s, box });
        break;
      case "text": {
        const b = tiny ? { x: dr.start.x, y: dr.start.y, w: 170 / W, h: (s.fontSize * 1.6 + 8) / H } : box;
        created = await persistCreate("text", { style: s, box: b, text: "" });
        if (created) setEditingText(created.id);
        break;
      }
      case "callout": {
        // Drag from the thing you're pointing at to where the note goes.
        const anchor = dr.start;
        const at = tiny ? { x: dr.start.x + 60 / W, y: dr.start.y - 50 / H } : dr.cur;
        const b = { x: at.x, y: at.y - (s.fontSize * 1.6 + 8) / H, w: 160 / W, h: (s.fontSize * 1.6 + 8) / H };
        created = await persistCreate("callout", { style: s, box: b, text: "", anchor });
        if (created) setEditingText(created.id);
        break;
      }
      case "polyline": case "pen":
        break; // handled by their own finishers
    }
    if (created) { setSelection([created.id]); pushHistory(); }
  }, [effStyle, W, H, persistCreate, pushHistory]);

  const finishPolyline = useCallback(async (pts: Pt[]) => {
    setDraft(null);
    if (pts.length < 2) return;
    const created = await persistCreate("polyline", { style: { ...effStyle }, pts });
    if (created) { setSelection([created.id]); pushHistory(); }
  }, [effStyle, persistCreate, pushHistory]);

  const finishPen = useCallback(async (pts: Pt[]) => {
    setDraft(null);
    if (pts.length < 2) return;
    const px = pts.map((p) => ({ x: p.x * W, y: p.y * H }));
    const simp = simplify(px, 1.4).map(norm);
    const created = await persistCreate("pen", { style: { ...effStyle }, pts: simp, smooth: true });
    if (created) { setSelection([created.id]); pushHistory(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effStyle, W, H, persistCreate, pushHistory]);

  const placeTemplate = useCallback(async (t: ToolTemplate, atPx: Pt, name: string) => {
    if (t.mode === "properties") { setTool({ type: "draw", kind: t.kind as DrawKind, styleOverride: t.d.style, name }); return; }
    const inst = instantiate(t, atPx, W, H);
    const created = await persistCreate(inst.kind, inst.d, t.d.symbol ? undefined : name);
    if (created) { setSelection([created.id]); pushHistory(); }
  }, [W, H, persistCreate, pushHistory, setTool]);

  // ---- stage pointer events (pt = px on the page) ----------------------------
  const onDown = useCallback((e: React.MouseEvent, px: Pt): boolean => {
    if (!editable) return false;
    if (tool.type === "select") return false; // let the stage pan / clear selection
    const p = norm(px);
    if (tool.type === "place") { placeTemplate(tool.template, px, tool.name); return true; }
    if (tool.kind === "polyline") {
      setDraft((dr) => (dr ? { ...dr, pts: [...dr.pts, p], cur: p } : { kind: "polyline", start: p, cur: p, pts: [p] }));
      return true;
    }
    setDraft({ kind: tool.kind, start: p, cur: p, pts: tool.kind === "pen" ? [p] : [] });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, tool, W, H, placeTemplate]);

  const onMove = useCallback((e: React.MouseEvent, px: Pt): boolean => {
    const p = norm(px);
    const d = dragRef.current;
    if (d) {
      const clamp = (v: number) => Math.max(-0.2, Math.min(1.2, v));
      if (d.type === "move") {
        const dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx * W, dy * H) > 2) d.moved = true;
        if (d.moved) {
          setAll((prev) => prev.map((m) => { const o = d.orig.get(m.id); return o ? translated(o, dx, dy) : m; }));
        }
      } else if (d.type === "handle") {
        const dx = p.x - d.start.x, dy = p.y - d.start.y;
        const keep = d.orig.kind === "group" || e.shiftKey;
        const nb = resizeBox(d.orig.d.box!, d.handle, dx, dy, keep, W, H);
        setAll((prev) => prev.map((m) => (m.id === d.id ? { ...m, d: { ...m.d, box: nb } } : m)));
      } else if (d.type === "vertex") {
        setAll((prev) => prev.map((m) => (m.id === d.id ? { ...m, d: { ...m.d, pts: (m.d.pts ?? []).map((q, i) => (i === d.index ? { x: clamp(p.x), y: clamp(p.y) } : q)) } } : m)));
      } else if (d.type === "anchor") {
        setAll((prev) => prev.map((m) => (m.id === d.id ? { ...m, d: { ...m.d, anchor: { x: clamp(p.x), y: clamp(p.y) } } } : m)));
      } else if (d.type === "rotate") {
        const ang = (Math.atan2(px.y - d.center.y, px.x - d.center.x) * 180) / Math.PI;
        let rot = ((d.orig.d.rot ?? 0) + (ang - d.startAngle)) % 360;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        setAll((prev) => prev.map((m) => (m.id === d.id ? { ...m, d: { ...m.d, rot: Math.round(rot * 10) / 10 } } : m)));
      }
      return true;
    }
    if (draft) {
      if (draft.kind === "pen") setDraft({ ...draft, cur: p, pts: [...draft.pts, p] });
      else setDraft({ ...draft, cur: p });
      return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, W, H]);

  const onUp = useCallback(async (_e: React.MouseEvent, px: Pt): Promise<boolean> => {
    const d = dragRef.current;
    if (d) {
      dragRef.current = null;
      if (d.type === "move") {
        if (!d.moved) return true;
        for (const id of d.ids) { const m = allRef.current.find((x) => x.id === id); if (m) persistUpdate(m); }
      } else {
        const m = allRef.current.find((x) => x.id === d.id);
        if (m) persistUpdate(m);
      }
      pushHistory();
      return true;
    }
    if (draft) {
      const p = norm(px);
      if (draft.kind === "polyline") return true; // clicks accumulate; Enter / double-click finishes
      if (draft.kind === "pen") { await finishPen([...draft.pts, p]); return true; }
      setDraft(null);
      await finishDraft({ ...draft, cur: p });
      return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, finishDraft, finishPen, persistUpdate, pushHistory]);

  const onDouble = useCallback((_e: React.MouseEvent, _px: Pt): boolean => {
    if (draft?.kind === "polyline") { finishPolyline(draft.pts); return true; }
    return false;
  }, [draft, finishPolyline]);

  // ---- grabs from the layer ---------------------------------------------------
  const grab = useCallback((pm: PM, e: React.MouseEvent, px: Pt) => {
    if (e.button !== 0) return;
    // With a draw / place tool active the press starts a new markup even over
    // an existing one — let it reach the stage.
    if (tool.type !== "select") return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey;
    let ids: number[];
    if (additive) ids = selection.includes(pm.id) ? selection.filter((i) => i !== pm.id) : [...selection, pm.id];
    else ids = selection.includes(pm.id) ? selection : [pm.id];
    setSelection(ids);
    if (!editable || pm.locked || additive) return;
    const orig = new Map<number, PM>();
    for (const id of ids) { const m = allRef.current.find((x) => x.id === id); if (m && !m.locked) orig.set(id, m); }
    dragRef.current = { type: "move", ids: [...orig.keys()], start: norm(px), orig, moved: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selection, editable, W, H]);

  const grabHandle = useCallback((pm: PM, h: Handle, _e: React.MouseEvent, px: Pt) => {
    if (!editable || pm.locked) return;
    dragRef.current = { type: "handle", id: pm.id, handle: h, orig: pm, start: norm(px) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, W, H]);
  const grabVertex = useCallback((pm: PM, i: number) => {
    if (!editable || pm.locked) return;
    dragRef.current = { type: "vertex", id: pm.id, index: i, orig: pm };
  }, [editable]);
  const grabAnchor = useCallback((pm: PM) => {
    if (!editable || pm.locked) return;
    dragRef.current = { type: "anchor", id: pm.id, orig: pm };
  }, [editable]);
  const grabRotate = useCallback((pm: PM, _e: React.MouseEvent, px: Pt) => {
    if (!editable || pm.locked) return;
    const bb = bboxPx(pm, W, H);
    const center = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
    dragRef.current = { type: "rotate", id: pm.id, orig: pm, center, startAngle: (Math.atan2(px.y - center.y, px.x - center.x) * 180) / Math.PI };
  }, [editable, W, H]);

  // ---- actions on the selection -------------------------------------------------
  const mutateSelected = useCallback((fn: (m: PM) => PM, unlockOnly = false) => {
    let changed = false;
    for (const m of selected) {
      if (m.locked && !unlockOnly) continue;
      const n = fn(m);
      if (n !== m) { persistUpdate(n); changed = true; }
    }
    if (changed) pushHistory();
  }, [selected, persistUpdate, pushHistory]);

  const setStyle = useCallback((patch: Partial<Style>) => {
    setStyleState((s) => ({ ...s, ...patch }));
    if (selected.length) mutateSelected((m) => ({ ...m, d: { ...m.d, style: { ...m.d.style, ...patch } } }));
  }, [selected.length, mutateSelected]);

  const setText = useCallback((id: number, text: string) => {
    const m = allRef.current.find((x) => x.id === id);
    if (!m) return;
    let d = { ...m.d, text };
    // Grow a text/callout box to fit its lines.
    if ((m.kind === "text" || m.kind === "callout") && d.box) {
      const fs = m.d.style.fontSize, lines = Math.max(1, text.split(/\r?\n/).length);
      const need = (fs * 1.25 * lines + 8) / H;
      if (need > d.box.h) d = { ...d, box: { ...d.box, h: need } };
    }
    persistUpdate({ ...m, d });
    pushHistory();
  }, [H, persistUpdate, pushHistory]);

  const setMeta = useCallback((id: number, patch: Partial<Pick<PM, "subject" | "comment" | "status" | "locked">>) => {
    const m = allRef.current.find((x) => x.id === id);
    if (!m) return;
    persistUpdate({ ...m, ...patch });
    pushHistory();
  }, [persistUpdate, pushHistory]);

  const remove = useCallback((ids?: number[]) => {
    const targets = (ids ?? selection).filter((id) => { const m = allRef.current.find((x) => x.id === id); return m && !m.locked; });
    if (!targets.length) return;
    persistDelete(targets);
    setSelection((s) => s.filter((i) => !targets.includes(i)));
    pushHistory();
  }, [selection, persistDelete, pushHistory]);

  const duplicate = useCallback(async (offsetPx = 14) => {
    const made: number[] = [];
    for (const m of selected) {
      const c = await persistCreate(m.kind, translated(m, offsetPx / W, offsetPx / H).d, m.subject);
      if (c) made.push(c.id);
    }
    if (made.length) { setSelection(made); pushHistory(); }
  }, [selected, W, H, persistCreate, pushHistory]);

  const copy = useCallback(() => { clipRef.current = selected.map((m) => ({ ...m, d: JSON.parse(JSON.stringify(m.d)) })); }, [selected]);
  const paste = useCallback(async () => {
    const made: number[] = [];
    for (const m of clipRef.current) {
      const c = await persistCreate(m.kind, translated(m, 14 / W, 14 / H).d, m.subject);
      if (c) made.push(c.id);
    }
    if (made.length) { setSelection(made); pushHistory(); }
  }, [W, H, persistCreate, pushHistory]);

  const group = useCallback(async () => {
    if (selected.length < 2) return;
    const g = groupOf(selected, W, H);
    persistDelete(selected.map((m) => m.id));
    const c = await persistCreate("group", g, "Group");
    if (c) setSelection([c.id]);
    pushHistory();
  }, [selected, W, H, persistDelete, persistCreate, pushHistory]);

  const ungroup = useCallback(async () => {
    // Expand a group back into markups. Children come back as primitive-backed
    // groups of one (their geometry is unit-box), which is still editable.
    const made: number[] = [];
    for (const m of selected.filter((x) => x.kind === "group" && x.d.items && x.d.items.length > 1)) {
      persistDelete([m.id]);
      for (const it of m.d.items!) {
        const c = await persistCreate("group", { ...m.d, items: [it], symbol: undefined }, m.subject);
        if (c) made.push(c.id);
      }
    }
    if (made.length) { setSelection(made); pushHistory(); }
  }, [selected, persistDelete, persistCreate, pushHistory]);

  const rotate = useCallback((deg: number) => {
    mutateSelected((m) => {
      if (m.kind === "group") return { ...m, d: { ...m.d, rot: (((m.d.rot ?? 0) + deg) % 360 + 360) % 360 } };
      // Lines and points rotate about their bbox centre.
      if (m.d.pts) {
        const bb = bboxPx(m, W, H); const c = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
        const pts = m.d.pts.map((p) => { const r = rotatePt({ x: p.x * W, y: p.y * H }, c, deg); return { x: r.x / W, y: r.y / H }; });
        const anchor = m.d.anchor ? (() => { const r = rotatePt({ x: m.d.anchor!.x * W, y: m.d.anchor!.y * H }, c, deg); return { x: r.x / W, y: r.y / H }; })() : m.d.anchor;
        return { ...m, d: { ...m.d, pts, anchor } };
      }
      return m;
    });
  }, [mutateSelected, W, H]);

  const flip = useCallback(() => {
    mutateSelected((m) => {
      if (m.kind === "group") return { ...m, d: { ...m.d, flip: !m.d.flip } };
      if (m.d.pts) { const bb = bboxPx(m, W, H); const cx = bb.x + bb.w / 2; return { ...m, d: { ...m.d, pts: m.d.pts.map((p) => ({ x: (2 * cx - p.x * W) / W, y: p.y })) } }; }
      return m;
    });
  }, [mutateSelected, W, H]);

  const reorder = useCallback((front: boolean) => {
    if (!selected.length) return;
    const others = pageMarkups.filter((m) => !selection.includes(m.id));
    const ordered = front ? [...others, ...selected] : [...selected, ...others];
    const pairs: [number, number][] = ordered.map((m, i) => [m.id, i + 1]);
    setAll((prev) => prev.map((m) => { const z = pairs.find(([id]) => id === m.id)?.[1]; return z != null ? { ...m, z } : m; }));
    api.reorderMarkups(pairs).catch(async (e) => { toast("err", errMsg(e)); await load(); });
    pushHistory();
  }, [selected, selection, pageMarkups, load, toast, pushHistory]);

  const toggleLock = useCallback(() => {
    for (const m of selected) persistUpdate({ ...m, locked: !m.locked });
    pushHistory();
  }, [selected, persistUpdate, pushHistory]);

  const setStatus = useCallback((status: "Open" | "Resolved") => {
    for (const m of selected) persistUpdate({ ...m, status });
    pushHistory();
  }, [selected, persistUpdate, pushHistory]);

  const nudge = useCallback((dxPx: number, dyPx: number) => {
    mutateSelected((m) => translated(m, dxPx / W, dyPx / H));
  }, [mutateSelected, W, H]);

  const cancel = useCallback(() => {
    if (draft?.kind === "polyline" && draft.pts.length >= 2) { finishPolyline(draft.pts); return; }
    setDraft(null);
    dragRef.current = null;
    if (tool.type !== "select") setToolState({ type: "select" });
    else setSelection([]);
  }, [draft, tool.type, finishPolyline]);

  /** Keyboard: returns true when handled. */
  const onKey = useCallback((e: KeyboardEvent): boolean => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
    if (typing || editingText != null) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") { cancel(); return true; }
    if (e.key === "Enter" && draft?.kind === "polyline") { finishPolyline(draft.pts); return true; }
    if (!editable) return false;
    if (ctrl && (e.key === "z" || e.key === "Z")) { if (e.shiftKey) redo(); else undo(); return true; }
    if (ctrl && (e.key === "y" || e.key === "Y")) { redo(); return true; }
    if (!selected.length) return false;
    if ((e.key === "Delete" || e.key === "Backspace")) { remove(); return true; }
    if (ctrl && (e.key === "d" || e.key === "D")) { duplicate(); return true; }
    if (ctrl && (e.key === "c" || e.key === "C")) { copy(); return true; }
    if (ctrl && (e.key === "v" || e.key === "V")) { paste(); return true; }
    if (ctrl && e.shiftKey && (e.key === "g" || e.key === "G")) { ungroup(); return true; }
    if (ctrl && (e.key === "g" || e.key === "G")) { group(); return true; }
    if (e.key === "[") { rotate(e.shiftKey ? -90 : -15); return true; }
    if (e.key === "]") { rotate(e.shiftKey ? 90 : 15); return true; }
    if (e.key === "ArrowLeft") { nudge(e.shiftKey ? -10 : -1, 0); return true; }
    if (e.key === "ArrowRight") { nudge(e.shiftKey ? 10 : 1, 0); return true; }
    if (e.key === "ArrowUp") { nudge(0, e.shiftKey ? -10 : -1); return true; }
    if (e.key === "ArrowDown") { nudge(0, e.shiftKey ? 10 : 1); return true; }
    return false;
  }, [editingText, editable, cancel, draft, finishPolyline, undo, redo, selected.length, remove, duplicate, copy, paste, group, ungroup, rotate, nudge]);

  return {
    all, pageMarkups, selected, selection, setSelection,
    tool, setTool, style, setStyle, effStyle, draft, editingText, setEditingText,
    load, onDown, onMove, onUp, onDouble, onKey, cancel,
    grab, grabHandle, grabVertex, grabAnchor, grabRotate,
    setText, setMeta, remove, duplicate, copy, paste, group, ungroup, rotate, flip, reorder, toggleLock, setStatus,
    undo, redo, canUndo, canRedo, histVersion, placeTemplate,
    recent: recentRef.current,
    dragging: dragRef.current != null,
  };
}

export type MarkupEditor = ReturnType<typeof useMarkupEditor>;
