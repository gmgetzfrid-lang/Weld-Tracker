// Examination rules — the editor for the NDE rule set the engine runs on.
//
// One rule set is active at a time. It is locked (document control): edits are
// saved under a new revision id and then activated; the previous revision is
// retired but kept because welds carry the id they were judged under. Drafts
// that never judged a weld can be edited in place and deleted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, bytesToB64, errMsg, logErr } from "../api";
import { useAuth } from "../auth";
import { useNdeRules } from "../ndeRules";
import { Modal, localTime, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import type {
  NdeCoverageRow, NdeJointDef, NdeRequirement, NdeRuleSet, NdeRuleSetMeta, NdeSpecDef, NdeSupplementalRule, Weld,
} from "../types";

type Tab = "table" | "vocab" | "extras" | "compliance" | "test" | "about";
const TABS: [Tab, string][] = [
  ["table", "Coverage table"],
  ["vocab", "Vocabulary"],
  ["extras", "Tie-in & extras"],
  ["compliance", "Compliance specs"],
  ["test", "Test a weld"],
  ["about", "About & versions"],
];

/** Suggest the next revision id: "…R0.4" → "…R0.5", "X-2" → "X-3", else "X-R2". */
function nextRevisionId(id: string, taken: string[]): string {
  const bump = (base: string, n: number, pad = 0) => `${base}${String(n).padStart(pad, "0")}`;
  let cand = id;
  const m1 = id.match(/^(.*R\d+\.)(\d+)$/i);
  const m2 = id.match(/^(.*?)(\d+)$/);
  if (m1) cand = bump(m1[1], Number(m1[2]) + 1, m1[2].length);
  else if (m2) cand = bump(m2[1], Number(m2[2]) + 1, m2[2].length);
  else cand = `${id}-R2`;
  let n = 2;
  while (taken.some((t) => t.toLowerCase() === cand.toLowerCase())) { cand = `${id}-R${n++}`; }
  return cand;
}

function cloneRules(r: NdeRuleSet): NdeRuleSet {
  return JSON.parse(JSON.stringify(r)) as NdeRuleSet;
}

export function NdeRulesPage({ onBack }: { onBack: () => void }) {
  const { can } = useAuth();
  const admin = can("admin");
  const toast = useToast();
  const live = useNdeRules();
  const [list, setList] = useState<NdeRuleSetMeta[]>([]);
  const [draft, setDraft] = useState<NdeRuleSet | null>(null);
  /** The stored rule set the draft came from; null = not saved yet. */
  const [baseId, setBaseId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("table");
  const [problems, setProblems] = useState<string[]>([]);
  const [saveAs, setSaveAs] = useState<{ id: string; revision: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "activate" | "reevaluate" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = useMemo(() => list.find((m) => m.id === baseId) ?? null, [list, baseId]);
  /** Stored rule sets that must not change in place: active, retired, shipped, or used. */
  const locked = !!meta && (meta.status !== "draft" || meta.builtin || meta.weld_count > 0);
  const editable = admin;

  const loadList = useCallback(() => api.ndeRulesList().then(setList).catch(logErr("loading rule sets")), []);
  const open = useCallback(async (id: string) => {
    try {
      const r = await api.ndeRulesGet(id);
      setDraft(r); setBaseId(id); setDirty(false); setProblems([]);
    } catch (e) { toast.push("err", errMsg(e)); }
  }, [toast]);
  useEffect(() => {
    loadList().then(() => api.ndeRulesList()).then((l) => {
      const active = l.find((m) => m.status === "active") ?? l[0];
      if (active) void open(active.id);
    }).catch(logErr("loading rule sets"));
  }, [loadList, open]);

  const update = (fn: (d: NdeRuleSet) => void) => {
    setDraft((d) => { if (!d) return d; const c = cloneRules(d); fn(c); return c; });
    setDirty(true);
  };

  const validateDraft = async (): Promise<boolean> => {
    if (!draft) return false;
    const probs = await api.ndeRulesValidate(draft);
    setProblems(probs);
    if (probs.length) { toast.push("err", `${probs.length} thing${probs.length === 1 ? "" : "s"} to fix before saving`); setTab("about"); }
    return probs.length === 0;
  };

  const save = async () => {
    if (!draft || !editable) return;
    if (!(await validateDraft())) return;
    if (locked || list.some((m) => m.id.toLowerCase() === draft.id.toLowerCase() && m.id !== baseId)) {
      setSaveAs({ id: nextRevisionId(draft.id, list.map((m) => m.id)), revision: "" });
      return;
    }
    await doSave(draft);
  };
  const doSave = async (rs: NdeRuleSet) => {
    setBusy(true);
    try {
      const m = await api.ndeRulesSave(rs);
      toast.push("ok", `${m.id} saved as a draft`);
      await loadList();
      await open(m.id);
      setSaveAs(null);
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); }
  };
  const activate = async () => {
    if (!baseId) return;
    setBusy(true);
    try {
      const m = await api.ndeRulesActivate(baseId);
      toast.push("ok", `${m.id} now governs every new weld`);
      await live.refresh();
      await loadList();
      await open(m.id);
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); setConfirm(null); }
  };
  const remove = async () => {
    if (!baseId) return;
    setBusy(true);
    try {
      await api.ndeRulesDelete(baseId);
      toast.push("ok", `${baseId} deleted`);
      const l = await api.ndeRulesList(); setList(l);
      const active = l.find((m) => m.status === "active"); if (active) await open(active.id);
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); setConfirm(null); }
  };
  const reevaluate = async () => {
    setBusy(true);
    try {
      const o = await api.ndeRulesReevaluate();
      toast.push("ok", `${o.scanned} unexamined weld${o.scanned === 1 ? "" : "s"} checked · ${o.changed} updated · ${o.unresolved} unresolved`);
    } catch (e) { toast.push("err", errMsg(e)); }
    finally { setBusy(false); setConfirm(null); }
  };
  const loadPreset = async (key: "ep-5-5-1" | "asme-b31.3") => {
    try {
      const p = await api.ndeRulesPreset(key);
      p.id = nextRevisionId(p.id, list.map((m) => m.id));
      setDraft(p); setBaseId(null); setDirty(true); setProblems([]); setTab("table");
      toast.push("ok", `Loaded the ${key === "ep-5-5-1" ? "EP 5-5-1" : "ASME B31.3"} preset as a new draft — review, then save`);
    } catch (e) { toast.push("err", errMsg(e)); }
  };
  const copyAsNew = () => {
    if (!draft) return;
    const c = cloneRules(draft);
    c.id = nextRevisionId(draft.id, list.map((m) => m.id));
    c.revision = "";
    setDraft(c); setBaseId(null); setDirty(true); setProblems([]);
  };
  const importJson = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as NdeRuleSet;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) throw new Error("This file is not a rule set export");
      setDraft(parsed); setBaseId(null); setDirty(true); setProblems([]); setTab("table");
      toast.push("ok", `Imported ${parsed.id || "rule set"} as a new draft — review, then save`);
    } catch (e) { toast.push("err", errMsg(e)); }
  };
  const exportJson = () => {
    if (!draft) return;
    const bytes = new TextEncoder().encode(JSON.stringify(draft, null, 2));
    api.saveExport(`nde-rules-${draft.id || "draft"}.json`, bytesToB64(bytes), "reveal")
      .then((p) => toast.push("ok", `Saved ${p}`)).catch((e) => toast.push("err", errMsg(e)));
  };

  const status: { label: string; cls: string } = !meta
    ? { label: "Unsaved draft", cls: "badge-amber" }
    : meta.status === "active" ? { label: "Active", cls: "badge-green" }
    : meta.status === "draft" ? { label: "Draft", cls: "badge-blue" }
    : { label: "Retired", cls: "badge-gray" };

  if (!draft) return <div className="card card-pad"><p className="muted">Loading the examination rules…</p></div>;

  return (
    <div className="rules-page">
      <div className="rules-head">
        <button className="btn btn-sm" onClick={onBack} title="Back to Settings"><Icon name="chevronLeft" size={14} /> Settings</button>
        <div className="rules-title">
          <h2>Examination rules</h2>
          <span className={`badge ${status.cls}`}>{status.label}</span>
          {dirty && <span className="badge badge-amber">unsaved changes</span>}
          {live.ruleSetId && <span className="muted rules-live">In force: <b>{live.ruleSetId}</b></span>}
        </div>
        <div className="rules-actions">
          <label className="pill-select" title="Start from a shipped rule set">
            <select value="" onChange={(e) => { const v = e.target.value as "" | "ep-5-5-1" | "asme-b31.3"; if (v) void loadPreset(v); }} disabled={!editable}>
              <option value="">Load preset…</option>
              <option value="ep-5-5-1">EP 5-5-1 Rev 0.4 (shipped default)</option>
              <option value="asme-b31.3">ASME B31.3 code minimums (template)</option>
            </select>
          </label>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!editable} title="Import a rule set exported from this or another installation"><Icon name="upload" size={13} /> Import</button>
          <button className="btn btn-sm" onClick={exportJson} title="Export this rule set as JSON"><Icon name="download" size={13} /> Export</button>
          <button className="btn btn-sm" onClick={copyAsNew} disabled={!editable} title="Copy this rule set into a new draft"><Icon name="copy" size={13} /> New revision from this</button>
          {editable && (
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || (!dirty && !!meta)} title={locked ? "The stored rule set is locked — your changes are saved under a new revision id" : "Save this draft"}>
              <Icon name="check" size={13} /> {locked ? "Save as new revision…" : "Save draft"}
            </button>
          )}
          {editable && meta && meta.status === "draft" && !dirty && (
            <button className="btn btn-accent btn-sm" onClick={() => setConfirm("activate")} disabled={busy} title="Make this the rule set every new weld is judged under"><Icon name="play" size={13} /> Activate</button>
          )}
        </div>
      </div>

      <p className="rules-lede muted">
        Every weld's required NDE % is computed from this table and its vocabularies. Nothing is hard-coded: change a
        cell, save as a new revision, activate. Welds already judged keep the revision they were judged under.
        {!editable && " You are viewing; only an administrator can change or activate rules."}
      </p>

      {problems.length > 0 && (
        <div className="card card-pad rules-problems">
          <b><Icon name="alert" size={14} /> {problems.length} thing{problems.length === 1 ? "" : "s"} to fix</b>
          <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      <div className="rules-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`rules-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "table" && <CoverageTable rs={draft} editable={editable} update={update} />}
      {tab === "vocab" && <VocabTab rs={draft} editable={editable} update={update} />}
      {tab === "extras" && <ExtrasTab rs={draft} editable={editable} update={update} />}
      {tab === "compliance" && <ComplianceTab rs={draft} editable={editable} update={update} />}
      {tab === "test" && <TestTab rs={draft} />}
      {tab === "about" && (
        <AboutTab rs={draft} meta={meta} list={list} editable={editable} locked={locked} update={update}
          onOpen={(id) => void open(id)} onActivate={(id) => { setBaseId(id); setConfirm("activate"); }}
          onDelete={(id) => { setBaseId(id); setConfirm("delete"); }} onReevaluate={() => setConfirm("reevaluate")} busy={busy} />
      )}

      {saveAs && (
        <Modal title="Save as a new revision" onClose={() => setSaveAs(null)}
          footer={<>
            <button className="btn" onClick={() => setSaveAs(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !saveAs.id.trim()} onClick={() => { const rs = cloneRules(draft); rs.id = saveAs.id.trim(); if (saveAs.revision.trim()) rs.revision = saveAs.revision.trim(); void doSave(rs); }}>Save draft</button>
          </>}>
          <p className="muted" style={{ marginTop: 0 }}>
            {meta ? <><b>{meta.id}</b> is {meta.status === "active" ? "the active rule set" : meta.builtin ? "shipped with the app" : meta.weld_count > 0 ? `on record for ${meta.weld_count} weld${meta.weld_count === 1 ? "" : "s"}` : "stored"} and can't change in place.</> : "A rule set with this id already exists."}
            {" "}Your changes become a new draft revision. Activate it when it is ready.
          </p>
          <div className="form-grid cols-2">
            <div className="field"><label>New revision id</label><input value={saveAs.id} onChange={(e) => setSaveAs({ ...saveAs, id: e.target.value })} autoFocus /></div>
            <div className="field"><label>Revision note</label><input value={saveAs.revision} onChange={(e) => setSaveAs({ ...saveAs, revision: e.target.value })} placeholder={draft.revision || "Rev 1 — what changed"} /></div>
          </div>
          <p className="hint">The id is stamped on every weld judged under it and shown on exports. Letters, digits, '-', '.' and '_' only.</p>
        </Modal>
      )}
      {confirm === "activate" && baseId && (
        <Modal title={`Activate ${baseId}?`} onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-accent" disabled={busy} onClick={activate}>Activate</button></>}>
          <p style={{ marginTop: 0 }}>From now on every new or edited weld is judged under <b>{baseId}</b>. The current rule set is retired and stays on record for the welds it judged.</p>
          <p className="hint">Welds already examined are never re-scored. Welds not yet examined keep their existing requirement until you run <i>Re-evaluate unexamined welds</i> under About &amp; versions.</p>
        </Modal>
      )}
      {confirm === "delete" && baseId && (
        <Modal title={`Delete ${baseId}?`} onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-ghost-danger" disabled={busy} onClick={remove}>Delete</button></>}>
          <p style={{ marginTop: 0 }}>This draft never judged a weld, so it can be removed. This can't be undone.</p>
        </Modal>
      )}
      {confirm === "reevaluate" && (
        <Modal title="Re-evaluate unexamined welds?" onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={reevaluate}>Re-evaluate</button></>}>
          <p style={{ marginTop: 0 }}>Every live weld with no NDE result yet is re-judged under the active rule set <b>{live.ruleSetId}</b>, and its required % updated where it differs.</p>
          <p className="hint">Examined and voided welds are left exactly as judged. The pass is written to the activity log.</p>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small editors
// ---------------------------------------------------------------------------

function ChipList({ values, onChange, editable, placeholder, mono }: {
  values: string[]; onChange: (v: string[]) => void; editable: boolean; placeholder?: string; mono?: boolean;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setText("");
  };
  return (
    <div className="chips">
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className={`chip ${mono ? "mono" : ""}`}>{v}
          {editable && <button type="button" className="chip-x" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>}
        </span>
      ))}
      {editable && (
        <input className="chip-input" value={text} placeholder={placeholder ?? "add…"} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
      )}
      {!editable && values.length === 0 && <span className="faint">none</span>}
    </div>
  );
}

function MultiPick({ options, values, onChange, editable, anyLabel = "any" }: {
  options: string[]; values: string[]; onChange: (v: string[]) => void; editable: boolean; anyLabel?: string;
}) {
  const toggle = (o: string) => onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  return (
    <div className="chips">
      <button type="button" className={`chip pick ${values.length === 0 ? "on" : ""}`} disabled={!editable} onClick={() => onChange([])}>{anyLabel}</button>
      {options.map((o) => (
        <button type="button" key={o} className={`chip pick ${values.includes(o) ? "on" : ""}`} disabled={!editable} onClick={() => toggle(o)}>{o}</button>
      ))}
    </div>
  );
}

function Pct({ value, onChange, editable, title }: { value: number; onChange: (n: number) => void; editable: boolean; title: string }) {
  return editable
    ? <input className="rules-pct" type="number" min={0} max={100} value={value} title={title} onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
    : <span className="rules-pct-ro" title={title}>{value}%</span>;
}

function NumOpt({ value, onChange, editable, step = 1, placeholder }: { value: number | null; onChange: (n: number | null) => void; editable: boolean; step?: number; placeholder?: string }) {
  return <input type="number" step={step} className="rules-num" disabled={!editable} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
}

function conditionsSummary(r: NdeCoverageRow): string {
  const parts: string[] = [];
  if (r.codes.length) parts.push(r.codes.join(" / "));
  if (r.services.length) parts.push(r.services.join(" / "));
  if (r.materials.length) parts.push(r.materials.join(" / "));
  if (r.class_min != null && r.class_max != null) parts.push(`Class ${r.class_min}–${r.class_max}`);
  else if (r.class_min != null) parts.push(`Class ≥ ${r.class_min}`);
  else if (r.class_max != null) parts.push(`Class ≤ ${r.class_max}`);
  if (r.aes === true) parts.push("in AES"); else if (r.aes === false) parts.push("not AES");
  if (r.temp_above_f != null) parts.push(`> ${r.temp_above_f}°F`);
  if (r.temp_from_f != null || r.temp_to_f != null) parts.push(`${r.temp_from_f ?? "…"}–${r.temp_to_f ?? "…"}°F`);
  if (r.pressure_above_psig != null) parts.push(`> ${r.pressure_above_psig} psig`);
  return parts.length ? parts.join(" · ") : "any weld";
}

// ---------------------------------------------------------------------------
// Coverage table
// ---------------------------------------------------------------------------

function CoverageTable({ rs, editable, update }: { rs: NdeRuleSet; editable: boolean; update: (fn: (d: NdeRuleSet) => void) => void }) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const move = (i: number, d: number) => update((x) => { const j = i + d; if (j < 0 || j >= x.rows.length) return; const [r] = x.rows.splice(i, 1); x.rows.splice(j, 0, r); });
  const addRow = () => update((x) => {
    x.rows.push({ id: `row-${Date.now().toString(36)}`, label: "New row", codes: [], services: [], materials: [], class_min: null, class_max: null, aes: null, temp_above_f: null, temp_from_f: null, temp_to_f: null, pressure_above_psig: null, rt_shop: 10, rt_field: 20, ptmt_shop: 10, ptmt_field: 20, note: "", cite: "" });
    setOpenRow(x.rows.length - 1);
  });
  const dup = (i: number) => update((x) => { const c = { ...x.rows[i], id: `${x.rows[i].id}-copy`, label: `${x.rows[i].label} (copy)` }; x.rows.splice(i + 1, 0, c); });
  const codes = rs.codes.map((c) => c.key), services = rs.services.map((s) => s.key), materials = rs.materials.map((m) => m.key);
  return (
    <div className="card">
      <div className="card-pad rules-table-head">
        <div>
          <h3 style={{ margin: 0 }}>{rs.table_label || "Coverage table"}</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Rows are tried top to bottom; the first row whose conditions all fit governs. Put overrides (severe cyclic,
            Category M…) above the general rows. Click a row's conditions to edit them.
          </p>
        </div>
        {editable && <button className="btn btn-sm" onClick={addRow}><Icon name="plus" size={13} /> Add row</button>}
      </div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table className="data rules-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Service and material</th>
              <th>Applies when</th>
              <th className="num" title="Circumferential butt / branch welds by radiography — shop welds">RT shop</th>
              <th className="num" title="Circumferential butt / branch welds by radiography — field welds">RT field</th>
              <th className="num" title="Fillet / socket / branch welds by PT or MT — shop welds">PT/MT shop</th>
              <th className="num" title="Fillet / socket / branch welds by PT or MT — field welds">PT/MT field</th>
              {editable && <th style={{ width: 120 }} />}
            </tr>
          </thead>
          <tbody>
            {rs.rows.map((r, i) => (
              <RowEditor key={r.id || i} r={r} i={i} open={openRow === i} onToggle={() => setOpenRow(openRow === i ? null : i)}
                editable={editable} codes={codes} services={services} materials={materials}
                onChange={(patch) => update((x) => { x.rows[i] = { ...x.rows[i], ...patch }; })}
                onMove={(d) => move(i, d)} onDup={() => dup(i)} onDelete={() => update((x) => { x.rows.splice(i, 1); })} />
            ))}
            {rs.rows.length === 0 && <tr><td colSpan={8} className="faint" style={{ textAlign: "center", padding: 24 }}>No rows — every weld would be unresolved.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ padding: "0 16px 14px" }}>
        Fail closed: when a weld's drivers can't single out one row (a blank flange class where rows differ by class, an
        unrecognised material), the requirement is <i>unresolved</i> and names what is missing — never quietly the
        least-demanding row. Rows that give the same coverage need not be told apart.
      </p>
    </div>
  );
}

function RowEditor({ r, i, open, onToggle, editable, codes, services, materials, onChange, onMove, onDup, onDelete }: {
  r: NdeCoverageRow; i: number; open: boolean; onToggle: () => void; editable: boolean;
  codes: string[]; services: string[]; materials: string[];
  onChange: (patch: Partial<NdeCoverageRow>) => void; onMove: (d: number) => void; onDup: () => void; onDelete: () => void;
}) {
  return (
    <>
      <tr className={open ? "rules-row-open" : ""}>
        <td className="faint">{i + 1}</td>
        <td>
          {editable ? <input className="rules-label" value={r.label} onChange={(e) => onChange({ label: e.target.value })} /> : <b>{r.label}</b>}
          {r.note && r.note !== r.label && <div className="faint rules-sub">{r.note}</div>}
        </td>
        <td><button type="button" className="rules-cond" onClick={onToggle} title="Edit the conditions">{conditionsSummary(r)} <Icon name={open ? "chevronUp" : "chevronDown"} size={12} /></button></td>
        <td className="num"><Pct value={r.rt_shop} editable={editable} title="RT, shop" onChange={(v) => onChange({ rt_shop: v })} /></td>
        <td className="num"><Pct value={r.rt_field} editable={editable} title="RT, field" onChange={(v) => onChange({ rt_field: v })} /></td>
        <td className="num"><Pct value={r.ptmt_shop} editable={editable} title="PT/MT, shop" onChange={(v) => onChange({ ptmt_shop: v })} /></td>
        <td className="num"><Pct value={r.ptmt_field} editable={editable} title="PT/MT, field" onChange={(v) => onChange({ ptmt_field: v })} /></td>
        {editable && (
          <td className="rules-rowactions">
            <button className="btn btn-sm btn-icon" title="Move up" onClick={() => onMove(-1)}><Icon name="chevronUp" size={13} /></button>
            <button className="btn btn-sm btn-icon" title="Move down" onClick={() => onMove(1)}><Icon name="chevronDown" size={13} /></button>
            <button className="btn btn-sm btn-icon" title="Duplicate" onClick={onDup}><Icon name="copy" size={13} /></button>
            <button className="btn btn-sm btn-icon btn-ghost-danger" title="Delete row" onClick={onDelete}><Icon name="trash" size={13} /></button>
          </td>
        )}
      </tr>
      {open && (
        <tr className="rules-expand">
          <td />
          <td colSpan={editable ? 7 : 6}>
            <div className="rules-cond-grid">
              <div className="field"><label>Piping code</label><MultiPick options={codes} values={r.codes} onChange={(v) => onChange({ codes: v })} editable={editable} anyLabel="any code" /></div>
              <div className="field"><label>Service category</label><MultiPick options={services} values={r.services} onChange={(v) => onChange({ services: v })} editable={editable} anyLabel="any service" /></div>
              <div className="field"><label>Material group</label><MultiPick options={materials} values={r.materials} onChange={(v) => onChange({ materials: v })} editable={editable} anyLabel="any material" /></div>
              <div className="field"><label>Flange class from / to (inclusive)</label>
                <div className="rules-inline"><NumOpt value={r.class_min} onChange={(v) => onChange({ class_min: v })} editable={editable} placeholder="any" /> <span className="faint">to</span> <NumOpt value={r.class_max} onChange={(v) => onChange({ class_max: v })} editable={editable} placeholder="any" /></div></div>
              <div className="field"><label>AES service</label>
                <select disabled={!editable} value={r.aes == null ? "" : r.aes ? "yes" : "no"} onChange={(e) => onChange({ aes: e.target.value === "" ? null : e.target.value === "yes" })}>
                  <option value="">either</option><option value="yes">in AES</option><option value="no">not in AES</option>
                </select></div>
              <div className="field"><label>Design temperature (°F): above / from / to</label>
                <div className="rules-inline"><NumOpt value={r.temp_above_f} onChange={(v) => onChange({ temp_above_f: v })} editable={editable} placeholder="above" /><NumOpt value={r.temp_from_f} onChange={(v) => onChange({ temp_from_f: v })} editable={editable} placeholder="from" /><NumOpt value={r.temp_to_f} onChange={(v) => onChange({ temp_to_f: v })} editable={editable} placeholder="to" /></div></div>
              <div className="field"><label>Design pressure above (psig)</label><NumOpt value={r.pressure_above_psig} onChange={(v) => onChange({ pressure_above_psig: v })} editable={editable} placeholder="any" /></div>
              <div className="field"><label>Shown on the weld record as</label><input disabled={!editable} value={r.note} onChange={(e) => onChange({ note: e.target.value })} placeholder={r.label} /></div>
              <div className="field"><label>Source / citation</label><input disabled={!editable} value={r.cite} onChange={(e) => onChange({ cite: e.target.value })} placeholder="Table 4, 18.2.5.5…" /></div>
              <div className="field"><label>Row id</label><input disabled={!editable} className="mono" value={r.id} onChange={(e) => onChange({ id: e.target.value })} /></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

function VocabTab({ rs, editable, update }: { rs: NdeRuleSet; editable: boolean; update: (fn: (d: NdeRuleSet) => void) => void }) {
  const renameIn = (list: "codes" | "services" | "materials", from: string, to: string) => (x: NdeRuleSet) => {
    if (!from || from === to) return;
    for (const r of x.rows) { const arr = r[list]; for (let k = 0; k < arr.length; k++) if (arr[k] === from) arr[k] = to; }
    if (list === "materials") for (const s of x.supplemental) for (let k = 0; k < s.materials.length; k++) if (s.materials[k] === from) s.materials[k] = to;
  };
  return (
    <div className="grid" style={{ gap: 16 }}>
      <p className="hint" style={{ margin: 0 }}>
        <b>Match terms</b> decide how what is typed on a weld is recognised: a term matches text that contains it
        ("P22" matches "A335-P22"); start a term with <code>=</code> to match a whole word only (<code>=CS</code> matches "CS"
        and "A106 CS", not "CSA"). Groups are tried in the order listed.
      </p>

      <div className="card card-pad">
        <h3>Piping codes</h3>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Key</th><th>Label</th><th>Match terms</th><th>Default</th><th title="Under this code a blank service category blocks the requirement">Service required</th>{editable && <th />}</tr></thead>
          <tbody>{rs.codes.map((c, i) => (
            <tr key={i}>
              <td><input disabled={!editable} className="rules-key" value={c.key} onChange={(e) => update((x) => { const old = x.codes[i].key; x.codes[i].key = e.target.value; renameIn("codes", old, e.target.value)(x); })} /></td>
              <td><input disabled={!editable} value={c.label} onChange={(e) => update((x) => { x.codes[i].label = e.target.value; })} /></td>
              <td><ChipList editable={editable} mono values={c.aliases} onChange={(v) => update((x) => { x.codes[i].aliases = v; })} /></td>
              <td><input type="radio" name="default-code" disabled={!editable} checked={c.is_default} onChange={() => update((x) => { x.codes.forEach((d, j) => { d.is_default = j === i; }); })} /></td>
              <td><input type="checkbox" disabled={!editable} checked={c.service_required} onChange={(e) => update((x) => { x.codes[i].service_required = e.target.checked; })} /></td>
              {editable && <td><button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.codes.splice(i, 1); })}><Icon name="trash" size={13} /></button></td>}
            </tr>))}</tbody></table></div>
        {editable && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update((x) => { x.codes.push({ key: "", label: "", aliases: [], is_default: x.codes.length === 0, service_required: true }); })}><Icon name="plus" size={13} /> Add code</button>}
      </div>

      <div className="card card-pad">
        <h3>Service categories</h3>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Key</th><th>Label</th><th>Match terms</th><th title="Fillet / socket welds in this service are examined on the final pass only">Final pass only</th><th>Note</th>{editable && <th />}</tr></thead>
          <tbody>{rs.services.map((s, i) => (
            <tr key={i}>
              <td><input disabled={!editable} className="rules-key" value={s.key} onChange={(e) => update((x) => { const old = x.services[i].key; x.services[i].key = e.target.value; renameIn("services", old, e.target.value)(x); })} /></td>
              <td><input disabled={!editable} value={s.label} onChange={(e) => update((x) => { x.services[i].label = e.target.value; })} /></td>
              <td><ChipList editable={editable} mono values={s.aliases} onChange={(v) => update((x) => { x.services[i].aliases = v; })} /></td>
              <td><input type="checkbox" disabled={!editable} checked={s.ptmt_final_pass_only} onChange={(e) => update((x) => { x.services[i].ptmt_final_pass_only = e.target.checked; })} /></td>
              <td><input disabled={!editable} value={s.note} onChange={(e) => update((x) => { x.services[i].note = e.target.value; })} /></td>
              {editable && <td><button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.services.splice(i, 1); })}><Icon name="trash" size={13} /></button></td>}
            </tr>))}</tbody></table></div>
        {editable && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update((x) => { x.services.push({ key: "", label: "", aliases: [], ptmt_final_pass_only: false, note: "" }); })}><Icon name="plus" size={13} /> Add service category</button>}
      </div>

      <div className="card card-pad">
        <h3>Material groups</h3>
        <p className="muted" style={{ marginTop: 0 }}>A weld's free-text material is classified into the first group whose terms match, so grade strings ("A335-P22", "316L") land in the right row without a picklist.</p>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Key</th><th>Label</th><th>P-numbers</th><th>Match terms</th>{editable && <th />}</tr></thead>
          <tbody>{rs.materials.map((m, i) => (
            <tr key={i}>
              <td><input disabled={!editable} className="rules-key" value={m.key} onChange={(e) => update((x) => { const old = x.materials[i].key; x.materials[i].key = e.target.value; renameIn("materials", old, e.target.value)(x); })} /></td>
              <td><input disabled={!editable} value={m.label} onChange={(e) => update((x) => { x.materials[i].label = e.target.value; })} /></td>
              <td><input disabled={!editable} className="rules-key" value={m.p_numbers} onChange={(e) => update((x) => { x.materials[i].p_numbers = e.target.value; })} /></td>
              <td><ChipList editable={editable} mono values={m.aliases} onChange={(v) => update((x) => { x.materials[i].aliases = v; })} /></td>
              {editable && <td className="rules-rowactions">
                <button className="btn btn-sm btn-icon" title="Move up" onClick={() => update((x) => { if (i > 0) { const [r] = x.materials.splice(i, 1); x.materials.splice(i - 1, 0, r); } })}><Icon name="chevronUp" size={13} /></button>
                <button className="btn btn-sm btn-icon" title="Move down" onClick={() => update((x) => { if (i < x.materials.length - 1) { const [r] = x.materials.splice(i, 1); x.materials.splice(i + 1, 0, r); } })}><Icon name="chevronDown" size={13} /></button>
                <button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.materials.splice(i, 1); })}><Icon name="trash" size={13} /></button>
              </td>}
            </tr>))}</tbody></table></div>
        {editable && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update((x) => { x.materials.push({ key: "", label: "", p_numbers: "", aliases: [] }); })}><Icon name="plus" size={13} /> Add material group</button>}
      </div>

      <div className="card card-pad">
        <h3>Flange classes</h3>
        <ChipList editable={editable} values={rs.flange_classes} onChange={(v) => update((x) => { x.flange_classes = v; })} placeholder="add class, e.g. 2500" />
      </div>

      <div className="card card-pad">
        <h3>Joint kinds</h3>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Kind</th><th>Label</th><th>Match terms</th><th>Column</th><th>Method label</th><th title="Examined on the root and final passes">Root &amp; final</th><th>Always-on notes</th>{editable && <th />}</tr></thead>
          <tbody>{rs.joints.map((j, i) => (
            <tr key={i}>
              <td><select disabled={!editable} value={j.kind} onChange={(e) => update((x) => { x.joints[i].kind = e.target.value as NdeJointDef["kind"]; })}>{["butt", "fillet", "socket", "olet"].map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
              <td><input disabled={!editable} value={j.label} onChange={(e) => update((x) => { x.joints[i].label = e.target.value; })} /></td>
              <td><ChipList editable={editable} mono values={j.aliases} onChange={(v) => update((x) => { x.joints[i].aliases = v; })} /></td>
              <td><select disabled={!editable} value={j.column} onChange={(e) => update((x) => { x.joints[i].column = e.target.value as "rt" | "ptmt"; })}><option value="rt">RT</option><option value="ptmt">PT/MT</option></select></td>
              <td><input disabled={!editable} value={j.method} onChange={(e) => update((x) => { x.joints[i].method = e.target.value; })} /></td>
              <td><input type="checkbox" disabled={!editable} checked={j.root_and_final} onChange={(e) => update((x) => { x.joints[i].root_and_final = e.target.checked; })} /></td>
              <td><ChipList editable={editable} values={j.notes} onChange={(v) => update((x) => { x.joints[i].notes = v; })} placeholder="add note…" /></td>
              {editable && <td><button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.joints.splice(i, 1); })}><Icon name="trash" size={13} /></button></td>}
            </tr>))}</tbody></table></div>
        {editable && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update((x) => { x.joints.push({ kind: "fillet", label: "", aliases: [], column: "ptmt", method: "PT/MT root & final", root_and_final: true, notes: [] }); })}><Icon name="plus" size={13} /> Add joint kind</button>}
      </div>

      <div className="card card-pad">
        <h3>Shop and field</h3>
        <div className="form-grid cols-2">
          <div className="field"><label>Terms that mean shop</label><ChipList editable={editable} mono values={rs.locations.shop} onChange={(v) => update((x) => { x.locations.shop = v; })} /></div>
          <div className="field"><label>Terms that mean field</label><ChipList editable={editable} mono values={rs.locations.field} onChange={(v) => update((x) => { x.locations.field = v; })} /></div>
        </div>
        <p className="hint">The first term of each list is what the weld form stores.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tie-in & extras
// ---------------------------------------------------------------------------

function ExtrasTab({ rs, editable, update }: { rs: NdeRuleSet; editable: boolean; update: (fn: (d: NdeRuleSet) => void) => void }) {
  const materials = rs.materials.map((m) => m.key);
  const addRule = (kind: NdeSupplementalRule["kind"]) => update((x) => {
    x.supplemental.push({ id: `sup-${Date.now().toString(36)}`, label: kind === "nps" ? "Large-bore spot RT" : "Thick-wall UT", kind, nps_min: kind === "nps" ? 24 : null, nps_below: null, wall_over: kind === "wall" ? 1.25 : null, materials: [], only_below_100_rt: kind === "nps", text: "" });
  });
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card card-pad">
        <h3>New-to-existing tie-in</h3>
        <label className="guided-check"><input type="checkbox" disabled={!editable} checked={rs.tie_in.enabled} onChange={(e) => update((x) => { x.tie_in.enabled = e.target.checked; })} /> A tie-in weld overrides the table</label>
        <div className="form-grid cols-3" style={{ marginTop: 10 }}>
          <div className="field"><label>RT %</label><Pct value={rs.tie_in.rt_percent} editable={editable} title="RT for tie-in butt welds" onChange={(v) => update((x) => { x.tie_in.rt_percent = v; })} /></div>
          <div className="field"><label>PT/MT %</label><Pct value={rs.tie_in.ptmt_percent} editable={editable} title="PT/MT for tie-in fillet / socket / branch welds" onChange={(v) => update((x) => { x.tie_in.ptmt_percent = v; })} /></div>
          <div className="field"><label>Shown on the weld record as</label><input disabled={!editable} value={rs.tie_in.note} onChange={(e) => update((x) => { x.tie_in.note = e.target.value; })} /></div>
        </div>
        <p className="hint">A tie-in resolves with only its joint type and shop/field known — no service, material or class needed.</p>
      </div>

      <div className="card card-pad">
        <h3>Joint type not recognised</h3>
        <p className="muted" style={{ marginTop: 0 }}>The more demanding of the two columns is used and the weld is flagged unresolved with this note:</p>
        <input disabled={!editable} value={rs.other_joint_note} onChange={(e) => update((x) => { x.other_joint_note = e.target.value; })} />
      </div>

      <div className="card card-pad">
        <div className="rules-table-head" style={{ padding: 0, marginBottom: 8 }}>
          <div><h3 style={{ margin: 0 }}>Supplemental requirements</h3><p className="muted" style={{ margin: "4px 0 0" }}>Notes added on top of the base coverage when a threshold is crossed.</p></div>
          {editable && <div className="rules-inline"><button className="btn btn-sm" onClick={() => addRule("nps")}><Icon name="plus" size={13} /> Pipe-size rule</button><button className="btn btn-sm" onClick={() => addRule("wall")}><Icon name="plus" size={13} /> Wall-thickness rule</button></div>}
        </div>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Rule</th><th>Trigger</th><th>Materials</th><th title="Only when the base radiography is below 100%">Below 100% RT only</th><th>Note on the weld record</th>{editable && <th />}</tr></thead>
          <tbody>{rs.supplemental.map((s, i) => (
            <tr key={i}>
              <td><input disabled={!editable} value={s.label} onChange={(e) => update((x) => { x.supplemental[i].label = e.target.value; })} /></td>
              <td>
                {s.kind === "nps"
                  ? <div className="rules-inline"><span className="faint">NPS ≥</span><NumOpt value={s.nps_min} editable={editable} step={0.5} onChange={(v) => update((x) => { x.supplemental[i].nps_min = v; })} /><span className="faint">and &lt;</span><NumOpt value={s.nps_below} editable={editable} step={0.5} placeholder="∞" onChange={(v) => update((x) => { x.supplemental[i].nps_below = v; })} /></div>
                  : <div className="rules-inline"><span className="faint">wall &gt;</span><NumOpt value={s.wall_over} editable={editable} step={0.05} onChange={(v) => update((x) => { x.supplemental[i].wall_over = v; })} /><span className="faint">in</span></div>}
              </td>
              <td><MultiPick options={materials} values={s.materials} editable={editable} onChange={(v) => update((x) => { x.supplemental[i].materials = v; })} /></td>
              <td><input type="checkbox" disabled={!editable} checked={s.only_below_100_rt} onChange={(e) => update((x) => { x.supplemental[i].only_below_100_rt = e.target.checked; })} /></td>
              <td><input disabled={!editable} value={s.text} onChange={(e) => update((x) => { x.supplemental[i].text = e.target.value; })} /></td>
              {editable && <td><button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.supplemental.splice(i, 1); })}><Icon name="trash" size={13} /></button></td>}
            </tr>))}
            {rs.supplemental.length === 0 && <tr><td colSpan={6} className="faint" style={{ textAlign: "center", padding: 18 }}>No supplemental rules.</td></tr>}
          </tbody></table></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance specs
// ---------------------------------------------------------------------------

function ComplianceTab({ rs, editable, update }: { rs: NdeRuleSet; editable: boolean; update: (fn: (d: NdeRuleSet) => void) => void }) {
  const labels = rs.specs.map((s) => s.label);
  const [extras, setExtras] = useState(rs.progressive.extra_after_reject.join(", "));
  useEffect(() => { setExtras(rs.progressive.extra_after_reject.join(", ")); }, [rs.progressive.extra_after_reject]);
  const commitExtras = () => {
    const nums = extras.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    update((x) => { x.progressive.extra_after_reject = nums; });
  };
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="rules-table-head" style={{ padding: 0, marginBottom: 8 }}>
          <div><h3 style={{ margin: 0 }}>Coverage specs</h3><p className="muted" style={{ margin: "4px 0 0" }}>What a weld's NDE % field can say, and how each welder is judged against it. These labels are offered in the NDE % dropdown.</p></div>
          {editable && <button className="btn btn-sm" onClick={() => update((x) => { x.specs.push({ label: "", percent: 10, mode: "percent", aliases: [], description: "" }); })}><Icon name="plus" size={13} /> Add spec</button>}
        </div>
        <div className="table-wrap rules-wrap"><table className="data rules-vocab"><thead><tr><th>Label</th><th className="num">Percent</th><th>How it is met</th><th>Match terms</th><th>Description</th>{editable && <th />}</tr></thead>
          <tbody>{rs.specs.map((s: NdeSpecDef, i) => (
            <tr key={i}>
              <td><input disabled={!editable} className="rules-key" value={s.label} onChange={(e) => update((x) => { x.specs[i].label = e.target.value; })} /></td>
              <td className="num"><Pct value={s.percent} editable={editable} title="Share of the welder's welds carrying this spec that must be examined" onChange={(v) => update((x) => { x.specs[i].percent = v; })} /></td>
              <td><select disabled={!editable} value={s.mode} onChange={(e) => update((x) => { x.specs[i].mode = e.target.value as NdeSpecDef["mode"]; })}><option value="percent">random share examined</option><option value="two_form">every weld holds its two NDE forms</option></select></td>
              <td><ChipList editable={editable} mono values={s.aliases} onChange={(v) => update((x) => { x.specs[i].aliases = v; })} placeholder={s.mode === "two_form" ? "API, 570" : "optional"} /></td>
              <td><input disabled={!editable} value={s.description} onChange={(e) => update((x) => { x.specs[i].description = e.target.value; })} /></td>
              {editable && <td><button className="btn btn-sm btn-icon btn-ghost-danger" title="Remove" onClick={() => update((x) => { x.specs.splice(i, 1); })}><Icon name="trash" size={13} /></button></td>}
            </tr>))}</tbody></table></div>
        <p className="hint">A two-form spec (API 570 in lieu of hydrotest) counts a butt weld when it holds PT root &amp; final and RT, and a fillet / socket / branch weld when it holds PT root &amp; final.</p>
      </div>

      <div className="card card-pad">
        <h3>Progressive sampling</h3>
        <label className="guided-check"><input type="checkbox" disabled={!editable} checked={rs.progressive.enabled} onChange={(e) => update((x) => { x.progressive.enabled = e.target.checked; })} /> Within a lot, a rejected random examination adds more of that welder's welds</label>
        <div className="form-grid cols-2" style={{ marginTop: 10 }}>
          <div className="field"><label>Extra examinations after the 1st, 2nd… reject (cumulative)</label><input disabled={!editable} value={extras} onChange={(e) => setExtras(e.target.value)} onBlur={commitExtras} placeholder="2, 4" /></div>
          <div className="field"><label>Every remaining weld after this many rejects</label><input type="number" min={1} disabled={!editable} value={rs.progressive.full_after_rejects} onChange={(e) => update((x) => { x.progressive.full_after_rejects = Math.max(1, Number(e.target.value) || 1); })} /></div>
        </div>
        <p className="hint">ASME B31.3 341.3.4 shape: +2 after one reject, +4 (total) after two, 100% after three.</p>
      </div>

      <div className="card card-pad">
        <h3>Facility default spec</h3>
        <label className="guided-check"><input type="checkbox" disabled={!editable} checked={rs.facility_defaults.enabled} onChange={(e) => update((x) => { x.facility_defaults.enabled = e.target.checked; })} /> Flag welds whose logged NDE % is off the facility rule for their shop / field / tie-in status</label>
        <div className="form-grid cols-3" style={{ marginTop: 10 }}>
          {([["shop_spec", "Shop welds"], ["field_spec", "Field welds"], ["tie_in_spec", "Tie-ins"]] as const).map(([k, l]) => (
            <div className="field" key={k}><label>{l}</label>
              <select disabled={!editable || !rs.facility_defaults.enabled} value={rs.facility_defaults[k]} onChange={(e) => update((x) => { x.facility_defaults[k] = e.target.value; })}>
                <option value="">— none —</option>{labels.map((o) => <option key={o} value={o}>{o}</option>)}
              </select></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test a weld
// ---------------------------------------------------------------------------

function TestTab({ rs }: { rs: NdeRuleSet }) {
  const shop = rs.locations.shop[0]?.replace(/^=/, "") ?? "SHOP";
  const field = rs.locations.field[0]?.replace(/^=/, "") ?? "FW";
  const [w, setW] = useState<Partial<Weld>>({ joint_type: "BW", shop_or_field: shop, service_category: rs.services[0]?.key ?? "", material_group: rs.materials[rs.materials.length - 1]?.key ?? "", flange_class: rs.flange_classes[1] ?? rs.flange_classes[0] ?? "", aes_service: false, new_to_existing: false });
  const [req, setReq] = useState<NdeRequirement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.ndeRulesEvaluate(rs, w).then((r) => { if (alive) { setReq(r); setErr(null); } }).catch((e) => { if (alive) setErr(errMsg(e)); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [rs, w]);
  const set = (patch: Partial<Weld>) => setW((x) => ({ ...x, ...patch }));
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <div className="rules-test">
      <div className="card card-pad">
        <h3>Drivers</h3>
        <p className="muted" style={{ marginTop: 0 }}>Try any combination against <b>this draft</b> before it goes live. The same engine judges every weld.</p>
        <div className="form-grid cols-2">
          <div className="field"><label>Joint type</label><select value={w.joint_type ?? ""} onChange={(e) => set({ joint_type: e.target.value })}><option value="">— blank —</option>{rs.joints.map((j) => <option key={j.kind} value={j.aliases[0]?.replace(/^=/, "") ?? j.label}>{j.label}</option>)}<option value="Other">Other</option></select></div>
          <div className="field"><label>Shop / field</label><select value={w.shop_or_field ?? ""} onChange={(e) => set({ shop_or_field: e.target.value })}><option value="">— blank —</option><option value={shop}>Shop</option><option value={field}>Field</option></select></div>
          <div className="field"><label>Piping code</label><select value={w.b31_code ?? ""} onChange={(e) => set({ b31_code: e.target.value || null })}><option value="">default</option>{rs.codes.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}</select></div>
          <div className="field"><label>Service category</label><select value={w.service_category ?? ""} onChange={(e) => set({ service_category: e.target.value || null })}><option value="">— blank —</option>{rs.services.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}</select></div>
          <div className="field"><label>Material (group or grade)</label><input list="rules-test-mats" value={w.material_group ?? ""} onChange={(e) => set({ material_group: e.target.value || null })} placeholder="Carbon Steel, A335-P22, 316L…" /><datalist id="rules-test-mats">{rs.materials.map((m) => <option key={m.key} value={m.key} />)}</datalist></div>
          <div className="field"><label>Flange class</label><select value={w.flange_class ?? ""} onChange={(e) => set({ flange_class: e.target.value || null })}><option value="">— blank —</option>{rs.flange_classes.map((c) => <option key={c} value={c}>#{c}</option>)}</select></div>
          <label className="guided-check"><input type="checkbox" checked={!!w.aes_service} onChange={(e) => set({ aes_service: e.target.checked })} /> AES service</label>
          <label className="guided-check"><input type="checkbox" checked={!!w.new_to_existing} onChange={(e) => set({ new_to_existing: e.target.checked })} /> New-to-existing tie-in</label>
          <div className="field"><label>Size (NPS)</label><input type="number" step={0.5} value={w.size ?? ""} onChange={(e) => set({ size: num(e.target.value) })} /></div>
          <div className="field"><label>Governing wall (in)</label><input type="number" step={0.01} value={w.governing_wall ?? ""} onChange={(e) => set({ governing_wall: num(e.target.value) })} /></div>
          <div className="field"><label>Design temperature (°F)</label><input type="number" value={w.b31_temp_f ?? ""} onChange={(e) => set({ b31_temp_f: num(e.target.value) })} /></div>
          <div className="field"><label>Design pressure (psig)</label><input type="number" value={w.b31_pressure_psig ?? ""} onChange={(e) => set({ b31_pressure_psig: num(e.target.value) })} /></div>
        </div>
      </div>
      <div className={`card card-pad rules-result ${req ? (req.resolved ? "ok" : "bad") : ""}`}>
        <h3>Outcome</h3>
        {err && <p className="spec-bad">{err}</p>}
        {!req && !err && <p className="muted">Computing…</p>}
        {req && (
          <>
            <div className="rules-result-big">{req.resolved ? <>{req.required_percent}% <span className="rules-result-method">{req.method}</span></> : <>Unresolved</>}</div>
            <p className="muted" style={{ margin: "6px 0" }}>{req.note}</p>
            {!req.resolved && <p className="spec-bad" style={{ margin: "6px 0" }}>Missing or unrecognised: {req.blockers.join(", ")}. The percentages below are a conservative placeholder, not a specification.</p>}
            <dl className="kv">
              <dt>RT column</dt><dd>{req.rt_percent}%</dd>
              <dt>PT/MT column</dt><dd>{req.ptmt_percent}%</dd>
              <dt>Root &amp; final</dt><dd>{req.root_and_final ? "yes" : "no"}</dd>
              <dt>Rule set</dt><dd className="mono">{req.rule_set}</dd>
            </dl>
            {req.supplemental.length > 0 && <><b>Supplemental</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{req.supplemental.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About & versions
// ---------------------------------------------------------------------------

function AboutTab({ rs, meta, list, editable, locked, update, onOpen, onActivate, onDelete, onReevaluate, busy }: {
  rs: NdeRuleSet; meta: NdeRuleSetMeta | null; list: NdeRuleSetMeta[]; editable: boolean; locked: boolean;
  update: (fn: (d: NdeRuleSet) => void) => void; onOpen: (id: string) => void; onActivate: (id: string) => void; onDelete: (id: string) => void; onReevaluate: () => void; busy: boolean;
}) {
  const idEditable = editable && !meta; // a stored rule set keeps its id; a new revision gets one on save
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card card-pad">
        <h3>This rule set</h3>
        <div className="form-grid cols-2">
          <div className="field"><label>Id (stamped on welds and exports)</label><input className="mono" disabled={!idEditable} value={rs.id} onChange={(e) => update((x) => { x.id = e.target.value; })} title={locked ? "Saved under a new id when you save" : ""} /></div>
          <div className="field"><label>Revision</label><input disabled={!editable} value={rs.revision} onChange={(e) => update((x) => { x.revision = e.target.value; })} /></div>
          <div className="field"><label>Name</label><input disabled={!editable} value={rs.name} onChange={(e) => update((x) => { x.name = e.target.value; })} /></div>
          <div className="field"><label>Short label used in the app ("… requires 5%")</label><input disabled={!editable} value={rs.table_label} onChange={(e) => update((x) => { x.table_label = e.target.value; })} placeholder="Table 4" /></div>
          <div className="field span2"><label>Source</label><input disabled={!editable} value={rs.source} onChange={(e) => update((x) => { x.source = e.target.value; })} /></div>
          <div className="field span2"><label>Notes</label><textarea disabled={!editable} rows={3} value={rs.notes} onChange={(e) => update((x) => { x.notes = e.target.value; })} /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-pad rules-table-head">
          <div><h3 style={{ margin: 0 }}>Versions</h3><p className="muted" style={{ margin: "4px 0 0" }}>Every rule set this database has held. A revision that judged welds stays on record forever.</p></div>
          {editable && <button className="btn btn-sm" onClick={onReevaluate} disabled={busy} title="Re-judge welds not yet examined under the active rule set"><Icon name="refresh" size={13} /> Re-evaluate unexamined welds</button>}
        </div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="data">
            <thead><tr><th>Id</th><th>Name</th><th>Revision</th><th>Status</th><th className="num">Welds judged</th><th>Activated</th><th>Updated</th><th /></tr></thead>
            <tbody>{list.map((m) => (
              <tr key={m.id} className={m.id === meta?.id ? "rules-current" : ""}>
                <td className="mono">{m.id}{m.builtin && <span className="faint" title="Shipped with the app"> · shipped</span>}</td>
                <td>{m.name}</td>
                <td>{m.revision}</td>
                <td><span className={`badge ${m.status === "active" ? "badge-green" : m.status === "draft" ? "badge-blue" : "badge-gray"}`}>{m.status}</span></td>
                <td className="num">{m.weld_count}</td>
                <td>{m.activated_at ? localTime(m.activated_at) : <span className="faint">—</span>}</td>
                <td>{localTime(m.updated_at)}{m.updated_by ? <span className="faint"> · {m.updated_by}</span> : null}</td>
                <td className="rules-rowactions">
                  <button className="btn btn-sm" onClick={() => onOpen(m.id)}>Open</button>
                  {editable && m.status === "draft" && <button className="btn btn-sm btn-accent" onClick={() => onActivate(m.id)} disabled={busy}>Activate</button>}
                  {editable && m.status !== "active" && !m.builtin && m.weld_count === 0 && <button className="btn btn-sm btn-ghost-danger" onClick={() => onDelete(m.id)} disabled={busy}>Delete</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
