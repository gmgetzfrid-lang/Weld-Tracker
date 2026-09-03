import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, bytesToB64, errMsg } from "../api";
import { APP_NAME, APP_VERSION, NDE_RULE_SET } from "../version";
import { Icon } from "./Icon";

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

/** Placeholder rows while a list loads — keeps the layout in place instead of a lone wheel. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card skeleton-rows" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${96 - ((i * 17) % 38)}%` }} />)}
    </div>
  );
}

export function ErrorBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="error-box">{message}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Makes the card a drill-down — every dashboard number should go somewhere. */
  onClick?: () => void;
}) {
  return (
    <div
      className={`stat ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub != null && <div className="sub">{sub}</div>}
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  Required: "st st-required",
  Requested: "st st-requested",
  Pending: "st st-pending",
  PWHT: "st st-pwht",
  Clear: "st st-clear",
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="badge st-none">—</span>;
  const cls = STATUS_CLASS[status] || "st-none";
  return <span className={`badge ${cls}`}>{status}</span>;
}

/** Open modals, bottom to top — Esc goes to the last one. */
const modalStack: object[] = [];

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  // Esc closes, like every other dialog people use all day — but only the
  // topmost one, so a confirm sitting on top of an editor doesn't take the
  // editor down with it.
  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || modalStack[modalStack.length - 1] !== token) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? "wide" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * App-styled confirmation dialog (replaces browser confirm()/prompt()). When
 * `requireReason` is set the confirm button stays disabled until a reason is
 * typed — used for Void and other controlled-record actions.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  requireReason,
  reasonLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = !requireReason || reason.trim().length > 0;
  return (
    <Modal title={title} onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={!ok}
            onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>{body}</div>
      {requireReason && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{reasonLabel ?? "Reason"}</label>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ok) onConfirm(reason.trim()); }} />
        </div>
      )}
    </Modal>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder ?? "—"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/* ---- Simple horizontal bar chart (no dependency) ---- */
export function BarChart({
  data,
  format,
}: {
  data: { label: string; value: number }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <div className="bar-label">{d.label}</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <div className="bar-val">{format ? format(d.value) : d.value}</div>
        </div>
      ))}
    </div>
  );
}

export function pct(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}
export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/* ---- Toast system ---- */
type Toast = { id: number; kind: "ok" | "err"; msg: string };
const ToastCtx = createContext<{
  push: (kind: "ok" | "err", msg: string) => void;
}>({ push: () => {} });

// Module-level bridge so plain helper functions (the CSV/PDF exporters) can
// surface their outcome without threading a hook through every call site.
let toastBridge: (kind: "ok" | "err", msg: string) => void = () => {};
export function notify(kind: "ok" | "err", msg: string) {
  toastBridge(kind, msg);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: "ok" | "err", msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  useEffect(() => {
    toastBridge = push;
    return () => { toastBridge = () => {}; };
  }, [push]);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-ico"><Icon name={t.kind === "ok" ? "checkCircle" : "alertCircle"} size={16} stroke={2} /></span>
            <span className="toast-msg">{t.msg}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}><Icon name="x" size={13} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}

/**
 * Cert continuity label. The backend stores "Active"/"Inactive", but on
 * screen a qualification is "Current" (X-rayed or qualified within six
 * months) or "Lapsed" — so it never collides with the welder's own
 * on-roster Active flag, which means something different.
 */
export function certLabel(status: string): "Current" | "Lapsed" {
  return status === "Active" ? "Current" : "Lapsed";
}

/** Render a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") in the user's local time. */
export function localTime(utc: string): string {
  const d = new Date(utc.includes("T") ? utc : utc.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? utc : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Export rows as a CSV into the SENTRIX Reports folder (browser download
 * links are inert inside the WebView) and reveal the file when written. When
 * `meta` is given, a provenance block is prepended so an exported record
 * proves which build and rule set produced it, who exported it, and under
 * what filters — the audit trail an issued report needs.
 */
export function downloadCsv(
  filename: string,
  rows: (string | number)[][],
  meta?: { user?: string; filters?: string },
) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let out = rows;
  if (meta) {
    const head: (string | number)[][] = [
      [`${APP_NAME} v${APP_VERSION} — NDE rule set ${NDE_RULE_SET}`],
      [`Exported ${new Date().toLocaleString()}${meta.user ? ` by ${meta.user}` : ""}`],
    ];
    if (meta.filters) head.push([`Filters: ${meta.filters}`]);
    head.push([]); // blank separator row
    out = [...head, ...rows];
  }
  const csv = out.map((r) => r.map(esc).join(",")).join("\r\n");
  api
    .saveExport(filename, bytesToB64(new TextEncoder().encode(csv)), "reveal")
    .then((p) => notify("ok", `Saved ${p}`))
    .catch((e) => notify("err", errMsg(e)));
}
