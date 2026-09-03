import { useEffect, useMemo, useRef, useState } from "react";
import { api, logErr } from "../api";
import type { SearchHit } from "../types";
import { Icon, type IconName } from "./Icon";

const KIND_META: Record<SearchHit["kind"], { icon: IconName; label: string }> = {
  work_order: { icon: "folder", label: "Work Order" },
  welder: { icon: "user", label: "Welder" },
  drawing: { icon: "ruler", label: "Drawing" },
  weld: { icon: "target", label: "Weld" },
};

/**
 * The global Ctrl+K / Cmd+K jump box. Type a work order, welder, drawing or
 * weld number and Enter to go there. Arrow keys move, Esc closes. Opened from
 * App via a keyboard shortcut; `onPick` routes the chosen hit.
 */
export function CommandPalette({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus each time it opens.
  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      api.globalSearch(query)
        .then((r) => { if (live) { setHits(r); setActive(0); } })
        .catch((e) => { logErr("global search")(e); if (live) setHits([]); })
        .finally(() => { if (live) setLoading(false); });
    }, 140);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const grouped = useMemo(() => {
    const order: SearchHit["kind"][] = ["work_order", "welder", "drawing", "weld"];
    const out: { kind: SearchHit["kind"]; items: { hit: SearchHit; index: number }[] }[] = [];
    let i = 0;
    const flat: SearchHit[] = [];
    for (const k of order) {
      const items = hits.filter((h) => h.kind === k);
      if (items.length === 0) continue;
      out.push({ kind: k, items: items.map((hit) => ({ hit, index: i++ })) });
      flat.push(...items);
    }
    return { out, flat };
  }, [hits]);

  if (!open) return null;

  const choose = (hit: SearchHit) => { onPick(hit); onClose(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    const n = grouped.flat.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (n ? (a + 1) % n : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (n ? (a - 1 + n) % n : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (grouped.flat[active]) choose(grouped.flat[active]); }
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="cmdk-input">
          <span className="cmdk-search-ico"><Icon name="search" size={18} /></span>
          <input
            ref={inputRef}
            placeholder="Jump to a work order, welder, drawing or weld…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>
        <div className="cmdk-results">
          {q.trim() === "" ? (
            <div className="cmdk-hint">Start typing to search across everything.</div>
          ) : loading && hits.length === 0 ? (
            <div className="cmdk-hint">Searching…</div>
          ) : grouped.flat.length === 0 ? (
            <div className="cmdk-hint">No matches for “{q.trim()}”.</div>
          ) : (
            grouped.out.map((g) => (
              <div key={g.kind} className="cmdk-group">
                <div className="cmdk-group-label">{KIND_META[g.kind].label}</div>
                {g.items.map(({ hit, index }) => (
                  <button
                    key={`${g.kind}-${index}`}
                    className={`cmdk-item ${index === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(hit)}
                  >
                    <span className="cmdk-ico"><Icon name={KIND_META[hit.kind].icon} size={16} /></span>
                    <span className="cmdk-label">{hit.label}</span>
                    {hit.sublabel && <span className="cmdk-sub">{hit.sublabel}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
