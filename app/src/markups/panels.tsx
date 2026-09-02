// Tool Chest dock, properties bar, context menu, markups list, text editor.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, errMsg } from "../api";
import type { MarkupKind, MarkupTool } from "../types";
import { Modal, localTime, useToast } from "../components/ui";
import type { DrawKind, MTool, MarkupEditor } from "./editor";
import { GroupEl } from "./render";
import { SYMBOLS, symbolTemplate } from "./symbols";
import {
  DEFAULT_STYLE, PALETTE, kindLabel, templateFrom, type PM, type Style, type ToolTemplate,
} from "./model";

// ---------------------------------------------------------------------------
// Icons for the redline tools
// ---------------------------------------------------------------------------

const DRAW_TOOLS: { kind: DrawKind; label: string; key: string; icon: string }[] = [
  { kind: "text", label: "Text", key: "T", icon: "M3 4h10M8 4v9" },
  { kind: "callout", label: "Callout", key: "K", icon: "M7 3h7v6H9l-3 3V9H7zM2 14l4-5" },
  { kind: "line", label: "Line", key: "L", icon: "M2 14L14 2" },
  { kind: "arrow", label: "Arrow", key: "A", icon: "M2 14L13 3M8 3h5v5" },
  { kind: "polyline", label: "Polyline", key: "N", icon: "M2 12l4-7 3 5 5-7" },
  { kind: "pen", label: "Pen", key: "P", icon: "M2 12c3-6 5 4 8-2s3 0 4 0" },
  { kind: "rect", label: "Rectangle", key: "R", icon: "M2.5 3.5h11v9h-11z" },
  { kind: "ellipse", label: "Ellipse", key: "E", icon: "M8 3a6 5 0 1 0 0 10a6 5 0 1 0 0-10z" },
  { kind: "cloud", label: "Cloud", key: "C", icon: "M4 12a2 2 0 0 1 0-4a2 2 0 0 1 2-3a3 3 0 0 1 5 0a2 2 0 0 1 2 3a2 2 0 0 1 0 4z" },
  { kind: "highlight", label: "Highlight", key: "H", icon: "M2 5h12v6H2z" },
  { kind: "dimension", label: "Dimension", key: "D", icon: "M2 3v10M14 3v10M2 8h12" },
];

function ToolIcon({ d, color }: { d: string; color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={color ?? "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function TemplatePreview({ t, size = 30 }: { t: ToolTemplate; size?: number }) {
  if (t.kind === "group" && t.d.items) {
    const pad = 3;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <GroupEl items={t.d.items} box={{ x: pad / size, y: pad / size, w: (size - pad * 2) / size, h: (size - pad * 2) / size }} rot={0} flip={t.d.flip} style={{ ...t.d.style, width: 1.5 }} z={1} W={size} H={size} />
      </svg>
    );
  }
  const dt = DRAW_TOOLS.find((x) => x.kind === t.kind);
  return <ToolIcon d={dt?.icon ?? "M2 8h12"} color={t.d.style.stroke} />;
}

function parseTemplate(tool: MarkupTool): ToolTemplate | null {
  try {
    const raw = JSON.parse(tool.data) as Partial<ToolTemplate>;
    return { kind: tool.kind, d: { ...(raw.d ?? { style: DEFAULT_STYLE }), style: { ...DEFAULT_STYLE, ...(raw.d?.style ?? {}) } }, sizePx: raw.sizePx ?? { w: 40, h: 40 }, mode: tool.mode };
  } catch { return null; }
}

// Recently used tools survive dock open/close for the session.
const RECENT: { name: string; tool: MTool; preview: ToolTemplate | DrawKind }[] = [];
function noteRecent(name: string, tool: MTool, preview: ToolTemplate | DrawKind) {
  const i = RECENT.findIndex((r) => r.name === name);
  if (i >= 0) RECENT.splice(i, 1);
  RECENT.unshift({ name, tool, preview });
  if (RECENT.length > 8) RECENT.pop();
}

// ---------------------------------------------------------------------------
// Tool Chest
// ---------------------------------------------------------------------------

export function ToolChest({ editor, tools, onReloadTools, editable, onClose }: {
  editor: MarkupEditor; tools: MarkupTool[]; onReloadTools: () => void; editable: boolean; onClose: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("wm-chest-open") || "{}"); } catch { return {}; }
  });
  const [newSet, setNewSet] = useState("");
  const [toolMenu, setToolMenu] = useState<{ x: number; y: number; tool: MarkupTool } | null>(null);
  const [setMenu, setSetMenu] = useState<{ x: number; y: number; cat: string } | null>(null);
  const [rename, setRename] = useState<{ tool?: MarkupTool; cat?: string; value: string } | null>(null);
  const [moveTool, setMoveTool] = useState<MarkupTool | null>(null);
  const isOpen = (k: string, dflt = true) => open[k] ?? dflt;
  const toggle = (k: string, dflt = true) => setOpen((o) => { const n = { ...o, [k]: !isOpen(k, dflt) }; try { localStorage.setItem("wm-chest-open", JSON.stringify(n)); } catch { /* ignore */ } return n; });

  const cats = useMemo(() => {
    const m = new Map<string, MarkupTool[]>();
    for (const t of tools) { const arr = m.get(t.category) ?? []; arr.push(t); m.set(t.category, arr); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tools]);

  const pickDraw = (kind: DrawKind, label: string) => {
    const t: MTool = { type: "draw", kind, name: label };
    editor.setTool(t); noteRecent(label, t, kind);
  };
  const pickSymbol = (key: string, name: string) => {
    const tpl = symbolTemplate(key, editor.style.stroke);
    if (!tpl) return;
    const t: MTool = { type: "place", template: tpl, name };
    editor.setTool(t); noteRecent(name, t, tpl);
  };
  const pickTool = (tool: MarkupTool) => {
    const tpl = parseTemplate(tool);
    if (!tpl) { toast.push("err", "This tool's data is unreadable"); return; }
    const t: MTool = { type: "place", template: tpl, name: tool.name };
    editor.setTool(t); noteRecent(tool.name, t, tpl);
  };
  const active = (m: MTool) => JSON.stringify(m) === JSON.stringify(editor.tool);
  const selectOn = editor.tool.type === "select";

  const saveRename = async () => {
    if (!rename) return;
    try {
      if (rename.tool) await api.updateMarkupTool({ ...rename.tool, name: rename.value });
      else if (rename.cat) await api.renameMarkupCategory(rename.cat, rename.value);
      setRename(null); onReloadTools();
    } catch (e) { toast.push("err", errMsg(e)); }
  };
  const delTool = async (t: MarkupTool) => { try { await api.deleteMarkupTool(t.id); onReloadTools(); } catch (e) { toast.push("err", errMsg(e)); } };
  const delSet = async (cat: string) => {
    try { for (const t of tools.filter((x) => x.category === cat)) await api.deleteMarkupTool(t.id); onReloadTools(); toast.push("ok", `Tool set "${cat}" removed`); }
    catch (e) { toast.push("err", errMsg(e)); }
  };
  const toggleMode = async (t: MarkupTool) => {
    try { await api.updateMarkupTool({ ...t, mode: t.mode === "drawing" ? "properties" : "drawing" }); onReloadTools(); }
    catch (e) { toast.push("err", errMsg(e)); }
  };
  const doMove = async (t: MarkupTool, cat: string) => {
    try { await api.updateMarkupTool({ ...t, category: cat }); setMoveTool(null); onReloadTools(); }
    catch (e) { toast.push("err", errMsg(e)); }
  };
  const [pendingSets, setPendingSets] = useState<string[]>([]);
  const createSet = () => {
    const name = newSet.trim();
    if (!name) return;
    // A set exists once it has a tool; until then show it as pending.
    setPendingSets((p) => (p.includes(name) ? p : [...p, name]));
    setNewSet("");
    setOpen((o) => ({ ...o, [`cat:${name}`]: true }));
  };
  const allCats = useMemo(() => {
    const names = new Set([...cats.map(([c]) => c), ...pendingSets]);
    return [...names].sort();
  }, [cats, pendingSets]);

  return (
    <aside className="anno-dock" onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="dock-head">
        <b>Tool Chest</b>
        <span className="muted" style={{ fontSize: 11 }}>{editor.tool.type === "select" ? "Select" : editor.tool.type === "draw" ? editor.tool.name ?? editor.tool.kind : editor.tool.name}</span>
        <button className="wm-x" title="Close (Esc)" onClick={onClose}>×</button>
      </div>

      {/* Appearance for the next markup (and the selection) */}
      <div className="chest-swatches">
        {PALETTE.map((c) => (
          <button key={c} className={`swatch ${editor.style.stroke === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => editor.setStyle({ stroke: c })} />
        ))}
        <select value={editor.style.width} onChange={(e) => editor.setStyle({ width: Number(e.target.value) })} title="Line width">
          {[1, 1.5, 2, 3, 4, 6].map((w) => <option key={w} value={w}>{w}px</option>)}
        </select>
        <select value={editor.style.dash} onChange={(e) => editor.setStyle({ dash: e.target.value as Style["dash"] })} title="Line style">
          <option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option>
        </select>
      </div>

      <div className="dock-body">
        <button className={`chest-tool wide ${selectOn ? "on" : ""}`} onClick={() => editor.setTool({ type: "select" })} title="Select / move (V)">
          <ToolIcon d="M4 2l9 7-4 1-2 4z" /> <span>Select</span><kbd>V</kbd>
        </button>

        {RECENT.length > 0 && (
          <section className="chest-sec">
            <button className="chest-sec-head" onClick={() => toggle("recent")}><span>{isOpen("recent") ? "▾" : "▸"}</span> Recent</button>
            {isOpen("recent") && (
              <div className="chest-grid">
                {RECENT.map((r) => (
                  <button key={r.name} className={`chest-tool ${active(r.tool) ? "on" : ""}`} title={r.name} onClick={() => editor.setTool(r.tool)} disabled={!editable}>
                    {typeof r.preview === "string" ? <ToolIcon d={DRAW_TOOLS.find((d) => d.kind === r.preview)?.icon ?? ""} /> : <TemplatePreview t={r.preview} />}
                    <span>{r.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="chest-sec">
          <button className="chest-sec-head" onClick={() => toggle("redline")}><span>{isOpen("redline") ? "▾" : "▸"}</span> Redline</button>
          {isOpen("redline") && (
            <div className="chest-grid">
              {DRAW_TOOLS.map((t) => (
                <button key={t.kind} className={`chest-tool ${editor.tool.type === "draw" && editor.tool.kind === t.kind && !editor.tool.styleOverride ? "on" : ""}`}
                  title={`${t.label} (${t.key})`} onClick={() => pickDraw(t.kind, t.label)} disabled={!editable}>
                  <ToolIcon d={t.icon} /><span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="chest-sec">
          <button className="chest-sec-head" onClick={() => toggle("piping")}><span>{isOpen("piping") ? "▾" : "▸"}</span> Piping</button>
          {isOpen("piping") && (
            <div className="chest-grid">
              {SYMBOLS.map((s) => {
                const tpl = symbolTemplate(s.key, editor.style.stroke)!;
                const on = editor.tool.type === "place" && editor.tool.template.d.symbol === s.key;
                return (
                  <button key={s.key} className={`chest-tool ${on ? "on" : ""}`} title={s.name} onClick={() => pickSymbol(s.key, s.name)} disabled={!editable}>
                    <TemplatePreview t={tpl} /><span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {allCats.map((cat) => {
          const list = cats.find(([c]) => c === cat)?.[1] ?? [];
          const k = `cat:${cat}`;
          return (
            <section className="chest-sec" key={cat}>
              <button className="chest-sec-head" onClick={() => toggle(k)} onContextMenu={(e) => { e.preventDefault(); setSetMenu({ x: e.clientX, y: e.clientY, cat }); }}>
                <span>{isOpen(k) ? "▾" : "▸"}</span> {cat} <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{list.length}</span>
                <span className="chest-more" title="Rename or delete this set" onClick={(e) => { e.stopPropagation(); setSetMenu({ x: e.clientX, y: e.clientY, cat }); }}>⋯</span>
              </button>
              {isOpen(k) && (
                <div className="chest-grid">
                  {list.length === 0 && <div className="muted" style={{ fontSize: 11.5, padding: "2px 4px", gridColumn: "1 / -1" }}>Empty — right-click a markup and send it here.</div>}
                  {list.map((t) => {
                    const tpl = parseTemplate(t);
                    const on = editor.tool.type === "place" && editor.tool.name === t.name && JSON.stringify(editor.tool.template) === JSON.stringify(tpl);
                    return (
                      <button key={t.id} className={`chest-tool ${on ? "on" : ""} ${t.mode === "properties" ? "props" : ""}`}
                        title={`${t.name} · ${t.mode === "properties" ? "Properties mode: you draw, it styles" : "Drawing mode: places an exact copy"}\nRight-click for options`}
                        onClick={() => pickTool(t)} onContextMenu={(e) => { e.preventDefault(); setToolMenu({ x: e.clientX, y: e.clientY, tool: t }); }} disabled={!editable}>
                        {tpl ? <TemplatePreview t={tpl} /> : <ToolIcon d="M2 8h12" />}
                        <span>{t.name}</span>
                        {t.mode === "properties" && <i className="chest-mode" title="Properties mode">P</i>}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {editable && (
          <div className="chest-newset">
            <input placeholder="New tool set…" value={newSet} onChange={(e) => setNewSet(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createSet(); }} />
            <button className="btn btn-sm" onClick={createSet} disabled={!newSet.trim()}>＋</button>
          </div>
        )}
        <div className="muted" style={{ fontSize: 11, padding: "8px 4px 2px", lineHeight: 1.5 }}>
          Draw, then right-click a markup → <b>Add to Tool Chest</b> to reuse it. Sets are shared with the team.
        </div>
      </div>

      {toolMenu && (
        <ContextMenu x={toolMenu.x} y={toolMenu.y} onClose={() => setToolMenu(null)} items={[
          { label: "Rename…", onClick: () => setRename({ tool: toolMenu.tool, value: toolMenu.tool.name }) },
          { label: "Move to set…", onClick: () => setMoveTool(toolMenu.tool) },
          { label: toolMenu.tool.mode === "drawing" ? "Switch to Properties mode" : "Switch to Drawing mode", onClick: () => toggleMode(toolMenu.tool), disabled: toolMenu.tool.kind === "group" },
          { label: "Delete tool", onClick: () => delTool(toolMenu.tool), danger: true },
        ]} />
      )}
      {setMenu && (
        <ContextMenu x={setMenu.x} y={setMenu.y} onClose={() => setSetMenu(null)} items={[
          { label: "Rename set…", onClick: () => setRename({ cat: setMenu.cat, value: setMenu.cat }) },
          { label: "Delete set and its tools", onClick: () => delSet(setMenu.cat), danger: true },
        ]} />
      )}
      {rename && (
        <Modal title={rename.tool ? "Rename tool" : "Rename tool set"} onClose={() => setRename(null)}
          footer={<><button className="btn" onClick={() => setRename(null)}>Cancel</button><button className="btn btn-primary" onClick={saveRename} disabled={!rename.value.trim()}>Save</button></>}>
          <input autoFocus value={rename.value} onChange={(e) => setRename({ ...rename, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }} style={{ width: "100%" }} />
        </Modal>
      )}
      {moveTool && (
        <Modal title={`Move "${moveTool.name}" to…`} onClose={() => setMoveTool(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allCats.filter((c) => c !== moveTool.category).map((c) => <button key={c} className="btn" onClick={() => doMove(moveTool, c)}>{c}</button>)}
            <div style={{ display: "flex", gap: 6 }}>
              <input placeholder="New set name" value={newSet} onChange={(e) => setNewSet(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={!newSet.trim()} onClick={() => { doMove(moveTool, newSet.trim()); setNewSet(""); }}>Move</button>
            </div>
          </div>
        </Modal>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; sub?: MenuItem[]; sep?: boolean }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [subOpen, setSubOpen] = useState<number | null>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", down); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);
  // Keep the menu on screen.
  const W = typeof window !== "undefined" ? window.innerWidth : 1200, H = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(x, W - 230), top = Math.min(y, H - Math.min(400, items.length * 30 + 12));
  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.sep ? <div key={i} className="ctx-sep" /> : (
        <div key={i} className={`ctx-item ${it.danger ? "danger" : ""} ${it.disabled ? "disabled" : ""}`}
          onMouseEnter={() => setSubOpen(it.sub ? i : null)}
          onClick={() => { if (it.disabled) return; if (it.sub) { setSubOpen(i); return; } it.onClick?.(); onClose(); }}>
          <span>{it.label}</span>
          {it.sub && <span className="ctx-arrow">▸</span>}
          {it.sub && subOpen === i && (
            <div className="ctx-menu sub">
              {it.sub.map((s, j) => s.sep ? <div key={j} className="ctx-sep" /> : (
                <div key={j} className={`ctx-item ${s.danger ? "danger" : ""} ${s.disabled ? "disabled" : ""}`} onClick={(e) => { e.stopPropagation(); if (s.disabled) return; s.onClick?.(); onClose(); }}>{s.label}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add to Tool Chest
// ---------------------------------------------------------------------------

export function AddToChestDialog({ pms, W, H, categories, initialCategory, onClose, onSaved }: {
  pms: PM[]; W: number; H: number; categories: string[]; initialCategory?: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const single = pms.length === 1 ? pms[0] : null;
  const canProps = !!single && single.kind !== "group";
  const [name, setName] = useState(single ? (single.subject || kindLabel(single.kind, single.d)) : "Group");
  const [cat, setCat] = useState(initialCategory ?? categories[0] ?? "My tools");
  const [newCat, setNewCat] = useState("");
  const [mode, setMode] = useState<"drawing" | "properties">("drawing");
  const [busy, setBusy] = useState(false);
  const tpl = useMemo(() => templateFrom(pms, W, H, mode), [pms, W, H, mode]);
  const save = async () => {
    const category = (newCat.trim() || cat).trim();
    if (!name.trim() || !category) return;
    setBusy(true);
    try {
      await api.createMarkupTool({ category, name: name.trim(), kind: tpl.kind, data: JSON.stringify({ d: tpl.d, sizePx: tpl.sizePx }), mode: tpl.mode });
      toast.push("ok", `"${name.trim()}" added to ${category}`);
      onSaved();
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add to Tool Chest" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Add tool"}</button></>}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div className="chest-preview"><TemplatePreview t={tpl} size={72} /></div>
        <div style={{ flex: 1 }}>
          <div className="field"><label>Tool name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field">
            <label>Tool set</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={cat} onChange={(e) => setCat(e.target.value)} disabled={!!newCat.trim()} style={{ flex: 1 }}>
                {categories.length === 0 && <option value="My tools">My tools</option>}
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="or new set…" value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>How it applies</label>
            <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 6 }}>
              <input type="radio" checked={mode === "drawing"} onChange={() => setMode("drawing")} style={{ marginTop: 3 }} />
              <span><b>Drawing mode</b> — one click places an exact copy (shape, size, text). Symbols and groups always work this way.</span>
            </label>
            <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, opacity: canProps ? 1 : 0.5 }}>
              <input type="radio" checked={mode === "properties"} disabled={!canProps} onChange={() => setMode("properties")} style={{ marginTop: 3 }} />
              <span><b>Properties mode</b> — keeps only the appearance (color, width, style); you draw the shape each time.</span>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Properties bar for the selection
// ---------------------------------------------------------------------------

export function MarkupBar({ editor, onAddToChest, onEditText, onClose }: {
  editor: MarkupEditor; onAddToChest: () => void; onEditText: (id: number) => void; onClose: () => void;
}) {
  const sel = editor.selected;
  if (!sel.length) return null;
  const one = sel.length === 1 ? sel[0] : null;
  const s = one?.d.style ?? editor.style;
  const textual = !!one && (one.kind === "text" || one.kind === "callout" || one.kind === "dimension");
  const hasFill = sel.some((m) => ["rect", "ellipse", "cloud", "polyline", "callout", "text"].includes(m.kind));
  const [meta, setMeta] = useState({ subject: one?.subject ?? "", comment: one?.comment ?? "" });
  useEffect(() => { setMeta({ subject: one?.subject ?? "", comment: one?.comment ?? "" }); }, [one?.id, one?.subject, one?.comment]);
  const commitMeta = () => { if (one && (meta.subject !== (one.subject ?? "") || meta.comment !== (one.comment ?? ""))) editor.setMeta(one.id, { subject: meta.subject || null, comment: meta.comment || null }); };
  const locked = sel.every((m) => m.locked);
  return (
    <div className="mk-bar">
      <div className="mk-bar-row">
        <b className="mk-bar-title">{one ? kindLabel(one.kind, one.d) : `${sel.length} markups`}</b>
        {one && <span className="muted" style={{ fontSize: 11 }}>{one.created_by ?? "?"} · {localTime(one.created_at)}{one.locked ? " · locked" : ""}{one.status === "Resolved" ? " · resolved" : ""}</span>}
        <div className="spacer" />
        <button className="wm-x" onClick={onClose} title="Deselect (Esc)">×</button>
      </div>
      <div className="mk-bar-row">
        <span className="mk-swatches">
          {PALETTE.map((c) => <button key={c} className={`swatch ${s.stroke === c ? "on" : ""}`} style={{ background: c }} onClick={() => editor.setStyle({ stroke: c })} disabled={locked} />)}
        </span>
        <select value={s.width} onChange={(e) => editor.setStyle({ width: Number(e.target.value) })} disabled={locked} title="Line width">
          {[1, 1.5, 2, 3, 4, 6].map((w) => <option key={w} value={w}>{w}px</option>)}
        </select>
        <select value={s.dash} onChange={(e) => editor.setStyle({ dash: e.target.value as Style["dash"] })} disabled={locked} title="Line style">
          <option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option>
        </select>
        {hasFill && (
          <label className="mk-fill" title="Fill">
            <input type="checkbox" checked={!!s.fill} disabled={locked} onChange={(e) => editor.setStyle({ fill: e.target.checked ? s.stroke : null })} /> Fill
            {s.fill && <input type="range" min={0.1} max={1} step={0.05} value={s.fillOpacity} onChange={(e) => editor.setStyle({ fillOpacity: Number(e.target.value) })} />}
          </label>
        )}
        <label className="mk-fill" title="Opacity">Opacity <input type="range" min={0.2} max={1} step={0.05} value={s.opacity} disabled={locked} onChange={(e) => editor.setStyle({ opacity: Number(e.target.value) })} /></label>
        {textual && (
          <select value={s.fontSize} onChange={(e) => editor.setStyle({ fontSize: Number(e.target.value) })} disabled={locked} title="Text size">
            {[9, 10, 12, 14, 16, 18, 22, 28, 36].map((f) => <option key={f} value={f}>{f}pt</option>)}
          </select>
        )}
        {(one?.kind === "line" || one?.kind === "arrow") && (
          <label className="mk-fill" title="Arrowheads">
            <input type="checkbox" checked={!!s.arrowStart} disabled={locked} onChange={(e) => editor.setStyle({ arrowStart: e.target.checked })} />◂
            <input type="checkbox" checked={one.kind === "arrow" || !!s.arrowEnd} disabled={locked || one.kind === "arrow"} onChange={(e) => editor.setStyle({ arrowEnd: e.target.checked })} />▸
          </label>
        )}
      </div>
      <div className="mk-bar-row">
        {textual && one && <button className="btn btn-sm" onClick={() => onEditText(one.id)} disabled={locked}>✎ Edit text</button>}
        <button className="btn btn-sm" title="Rotate −15° ( [ )" onClick={() => editor.rotate(-15)} disabled={locked}>↺</button>
        <button className="btn btn-sm" title="Rotate +15° ( ] )" onClick={() => editor.rotate(15)} disabled={locked}>↻</button>
        <button className="btn btn-sm" title="Rotate 90°" onClick={() => editor.rotate(90)} disabled={locked}>90°</button>
        <button className="btn btn-sm" title="Flip horizontally" onClick={editor.flip} disabled={locked}>⇋</button>
        {sel.length > 1 && <button className="btn btn-sm" title="Group (Ctrl+G)" onClick={editor.group}>⧉ Group</button>}
        {one?.kind === "group" && (one.d.items?.length ?? 0) > 1 && <button className="btn btn-sm" title="Ungroup (Ctrl+Shift+G)" onClick={editor.ungroup}>Ungroup</button>}
        <button className="btn btn-sm" title="Bring to front" onClick={() => editor.reorder(true)}>⬆</button>
        <button className="btn btn-sm" title="Send to back" onClick={() => editor.reorder(false)}>⬇</button>
        <button className="btn btn-sm" title="Duplicate (Ctrl+D)" onClick={() => editor.duplicate()}>⎘</button>
        <button className="btn btn-sm" title={locked ? "Unlock" : "Lock (no accidental moves)"} onClick={editor.toggleLock}>{locked ? "🔓" : "🔒"}</button>
        <button className="btn btn-sm" title={sel.every((m) => m.status === "Resolved") ? "Reopen" : "Mark resolved"} onClick={() => editor.setStatus(sel.every((m) => m.status === "Resolved") ? "Open" : "Resolved")}>
          {sel.every((m) => m.status === "Resolved") ? "↩ Reopen" : "✓ Resolve"}
        </button>
        <button className="btn btn-sm btn-primary" title="Save to a tool set for reuse" onClick={onAddToChest}>＋ Tool Chest</button>
        <div className="spacer" />
        <button className="btn btn-sm btn-danger" title="Delete (Del)" onClick={() => editor.remove()} disabled={locked}>🗑</button>
      </div>
      {one && (
        <div className="mk-bar-row">
          <input className="mk-meta" placeholder="Subject (e.g. Add flange)" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} onBlur={commitMeta} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <input className="mk-meta wide" placeholder="Comment for the record" value={meta.comment} onChange={(e) => setMeta({ ...meta, comment: e.target.value })} onBlur={commitMeta} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markups list (right drawer)
// ---------------------------------------------------------------------------

export function MarkupsList({ editor, page, onJump, onClose }: {
  editor: MarkupEditor; page: number; onJump: (pm: PM) => void; onClose: () => void;
}) {
  const [allPages, setAllPages] = useState(false);
  const [filter, setFilter] = useState<"all" | "Open" | "Resolved">("all");
  const rows = (allPages ? editor.all : editor.pageMarkups).filter((m) => filter === "all" || m.status === filter);
  return (
    <aside className="anno-drawer mk-list" onMouseDown={(e) => e.stopPropagation()}>
      <div className="dock-head">
        <b>Markups</b>
        <span className="muted" style={{ fontSize: 11 }}>{rows.length}</span>
        <button className="wm-x" onClick={onClose}>×</button>
      </div>
      <div className="mk-list-filters">
        <div className="pill-tabs">
          {(["all", "Open", "Resolved"] as const).map((f) => <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f}</button>)}
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} /> All pages</label>
      </div>
      <div className="mk-list-body">
        {rows.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: 10 }}>No markups{filter !== "all" ? ` (${filter.toLowerCase()})` : ""} on {allPages ? "this sheet" : "this page"}.</div>}
        {rows.map((m) => (
          <button key={m.id} className={`mk-row ${editor.selection.includes(m.id) ? "on" : ""} ${m.status === "Resolved" ? "resolved" : ""}`} onClick={() => onJump(m)}>
            <span className="mk-row-dot" style={{ background: m.d.style.stroke }} />
            <span className="mk-row-body">
              <b>{m.subject || kindLabel(m.kind, m.d)}{m.d.text ? ` — ${m.d.text.slice(0, 40)}` : ""}</b>
              <span className="muted">{kindLabel(m.kind, m.d)}{allPages && m.page !== page ? ` · p${m.page}` : ""} · {m.created_by ?? "?"} · {localTime(m.created_at)}{m.locked ? " · 🔒" : ""}</span>
              {m.comment && <span className="mk-row-comment">{m.comment}</span>}
            </span>
            <span className={`badge ${m.status === "Resolved" ? "badge-green" : "badge-amber"}`}>{m.status}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// In-place text editing
// ---------------------------------------------------------------------------

export function TextEditOverlay({ pm, W, H, z, onCommit, onCancel }: {
  pm: PM; W: number; H: number; z: number; onCommit: (text: string) => void; onCancel: () => void;
}) {
  const [val, setVal] = useState(pm.d.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const fs = pm.d.style.fontSize * z;
  const style: CSSProperties = pm.kind === "dimension"
    ? (() => { const [a, b] = (pm.d.pts ?? []).map((p) => ({ x: p.x * W, y: p.y * H })); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; return { left: mx - 60 * z, top: my - 26 * z, width: 120 * z, height: fs * 1.6, textAlign: "center" as const }; })()
    : (() => { const b = pm.d.box!; return { left: b.x * W, top: b.y * H, width: Math.max(60, b.w * W), height: Math.max(fs * 1.6, b.h * H) }; })();
  return (
    <textarea
      ref={ref}
      className="mk-textedit"
      style={{ ...style, fontSize: fs, lineHeight: 1.25, color: pm.d.style.stroke, padding: 4 * z, borderColor: pm.d.style.stroke }}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { onCancel(); }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommit(val); }
      }}
      onBlur={() => onCommit(val)}
      placeholder={pm.kind === "dimension" ? "e.g. 12'-6\"" : "Type, Enter to finish, Shift+Enter for a new line"}
    />
  );
}

export { DRAW_TOOLS };
export type { MarkupKind };
