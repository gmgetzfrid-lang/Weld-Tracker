import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Click-to-edit primitives. Every cell shows its value as plain text; click (or
 * focus + Enter) turns it into an input in place. Enter / blur commits, Esc
 * reverts. No "select a row then edit above" — you edit the value you clicked.
 */

export function InlineText({
  value,
  onCommit,
  placeholder = "—",
  numeric,
  date,
  align,
}: {
  value: string | number | null | undefined;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  numeric?: boolean;
  date?: boolean;
  align?: "left" | "right";
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);

  const commit = () => {
    setEditing(false);
    const trimmed = v.trim();
    const orig = value == null ? "" : String(value);
    if (trimmed !== orig) onCommit(trimmed === "" ? null : trimmed);
  };

  if (!editing) {
    const shown = value == null || value === "" ? null : String(value);
    return (
      <span
        className={`inline-cell ${align === "right" ? "r" : ""}`}
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F2") setEditing(true);
        }}
      >
        {shown ?? <span className="inline-empty">{placeholder}</span>}
        <span className="inline-pen">✎</span>
      </span>
    );
  }
  return (
    <input
      autoFocus
      className={`inline-input ${align === "right" ? "r" : ""}`}
      type={date ? "date" : numeric ? "number" : "text"}
      step={numeric ? "any" : undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value == null ? "" : String(value));
          setEditing(false);
        }
      }}
    />
  );
}

/** Type-to-filter combobox. Click the value, start typing to filter, click or
 * Enter to pick. Optionally allows a free-typed value not in the list. */
export function InlineSelect({
  value,
  options,
  onCommit,
  placeholder = "—",
  allowCustom,
  render,
}: {
  value: string | null | undefined;
  options: string[];
  onCommit: (v: string | null) => void;
  placeholder?: string;
  allowCustom?: boolean;
  render?: (v: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(q.trim().toLowerCase())
  );

  useLayoutEffect(() => {
    if (open) boxRef.current?.querySelector("input")?.focus();
  }, [open]);

  const pick = (val: string | null) => {
    setOpen(false);
    setQ("");
    if ((val ?? "") !== (value ?? "")) onCommit(val);
  };

  if (!open) {
    return (
      <span
        className="inline-cell"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F2") setOpen(true);
        }}
      >
        {value ? (render ? render(value) : value) : <span className="inline-empty">{placeholder}</span>}
        <span className="inline-caret">▾</span>
      </span>
    );
  }

  return (
    <div className="inline-combo" ref={boxRef}>
      <input
        className="inline-input"
        value={q}
        placeholder={value ?? "type to filter…"}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(filtered.length - 1, h + 1));
          if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
          if (e.key === "Enter") {
            if (filtered[hi]) pick(filtered[hi]);
            else if (allowCustom && q.trim()) pick(q.trim());
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="inline-menu">
        {value && (
          <div className="inline-opt clear" onMouseDown={() => pick(null)}>
            clear
          </div>
        )}
        {filtered.map((o, i) => (
          <div
            key={o}
            className={`inline-opt ${i === hi ? "hi" : ""} ${o === value ? "cur" : ""}`}
            onMouseDown={() => pick(o)}
            onMouseEnter={() => setHi(i)}
          >
            {render ? render(o) : o}
          </div>
        ))}
        {allowCustom && q.trim() && !filtered.includes(q.trim()) && (
          <div className="inline-opt add" onMouseDown={() => pick(q.trim())}>
            add “{q.trim()}”
          </div>
        )}
        {filtered.length === 0 && !allowCustom && (
          <div className="inline-opt none">no match</div>
        )}
      </div>
    </div>
  );
}

/** A form-field combobox (always visible, not click-to-reveal) for wizards. */
export function Combobox({
  value,
  options,
  onChange,
  placeholder = "select…",
  allowCustom,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const filtered = options.filter((o) =>
    o.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="combo" ref={ref}>
      <input
        className="combo-input"
        value={open ? q : value}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
      />
      <span className="combo-caret">▾</span>
      {open && (
        <div className="combo-menu">
          {value && (
            <div className="inline-opt clear" onMouseDown={() => { onChange(""); setOpen(false); }}>clear</div>
          )}
          {filtered.map((o) => (
            <div
              key={o}
              className={`inline-opt ${o === value ? "cur" : ""}`}
              onMouseDown={() => { onChange(o); setOpen(false); }}
            >
              {o}
            </div>
          ))}
          {allowCustom && q.trim() && !options.includes(q.trim()) && (
            <div className="inline-opt add" onMouseDown={() => { onChange(q.trim()); setOpen(false); }}>
              use “{q.trim()}”
            </div>
          )}
          {filtered.length === 0 && !allowCustom && <div className="inline-opt none">no match</div>}
        </div>
      )}
    </div>
  );
}

/** Segmented chip control — click a chip to set the value (no dropdown). */
export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string; cls?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg ${value === o.value ? "on" : ""} ${o.cls ?? ""}`}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
