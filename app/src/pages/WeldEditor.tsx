import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import type { Lookups, Weld, Welder } from "../types";
import { ErrorBox, Modal, useToast } from "../components/ui";

const EMPTY: Weld = {
  id: 0,
  spec_5: false,
  spec_10: false,
  spec_20: false,
  spec_25: false,
  spec_50: false,
  spec_100: false,
  count_omission: false,
  status: "",
};

export function WeldEditor({
  weld,
  welders,
  lookups,
  sizes,
  onClose,
  onSaved,
}: {
  weld: Weld | null; // null = new
  welders: Welder[];
  lookups: Lookups;
  sizes: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("editor");
  const [w, setW] = useState<Weld>(weld ? { ...weld } : { ...EMPTY });
  const [thickness, setThickness] = useState<number | null>(weld?.thickness ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Weld>(k: K, v: Weld[K]) =>
    setW((prev) => ({ ...prev, [k]: v }));

  // Live thickness lookup on size/schedule change (backend recomputes on save).
  useEffect(() => {
    if (w.size != null && w.schedule) {
      api
        .lookupThickness(Number(w.size), w.schedule)
        .then((t) => setThickness(t))
        .catch(() => setThickness(null));
    }
  }, [w.size, w.schedule]);

  const weldInches = w.size != null ? Number(w.size) * Math.PI : null;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (w.id) {
        await api.updateWeld(w);
      } else {
        await api.createWeld(w);
      }
      toast.push("ok", w.id ? "Weld updated" : "Weld added");
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!w.id) return;
    if (!confirm(`Delete weld ${w.weld_number ?? w.id}? This cannot be undone.`))
      return;
    try {
      await api.deleteWeld(w.id);
      toast.push("ok", "Weld deleted");
      onSaved();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const repair = async (tracers: boolean) => {
    if (!w.id) return;
    try {
      const ids = await api.createRepair(w.id, tracers);
      toast.push("ok", `Created ${ids.length} row(s): repair${tracers ? " + tracers" : ""}`);
      onSaved();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const T = (
    label: string,
    key: keyof Weld,
    type: "text" | "date" | "number" = "text"
  ) => (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        disabled={!editable}
        value={(w[key] as any) ?? ""}
        onChange={(e) =>
          set(
            key,
            (type === "number"
              ? e.target.value === ""
                ? null
                : Number(e.target.value)
              : e.target.value) as any
          )
        }
      />
    </div>
  );

  const Sel = (label: string, key: keyof Weld, opts: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select
        disabled={!editable}
        value={(w[key] as any) ?? ""}
        onChange={(e) => set(key, (e.target.value || null) as any)}
      >
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  const Chk = (label: string, key: keyof Weld) => (
    <label className="checkline">
      <input
        type="checkbox"
        disabled={!editable}
        checked={Boolean(w[key])}
        onChange={(e) => set(key, e.target.checked as any)}
      />
      {label}
    </label>
  );

  const stamps = welders.map((x) => x.stamp);

  return (
    <Modal
      wide
      title={w.id ? `Weld ${w.weld_number ?? w.id}` : "New Weld"}
      onClose={onClose}
      footer={
        <>
          {w.id && editable && (
            <>
              <button className="btn btn-danger" onClick={del}>
                Delete
              </button>
              <button className="btn" onClick={() => repair(false)} title="Insert a repair row (nR1)">
                + Repair
              </button>
              <button className="btn" onClick={() => repair(true)} title="Insert repair + 2 tracers">
                + Repair &amp; Tracers
              </button>
              <div style={{ flex: 1 }} />
            </>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {editable && (
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </>
      }
    >
      <ErrorBox message={error} />

      <h4 className="muted" style={{ marginTop: 0 }}>Identification</h4>
      <div className="form-grid cols-4">
        {T("Unit", "unit")}
        {T("Drawing #", "drawing_no")}
        {T("Work Order #", "work_order")}
        {T("Line Spec.", "line_spec")}
        {T("Weld Number", "weld_number")}
        {Sel("Joint Type", "joint_type", lookups.joint_type ?? [])}
        {Sel("Old to New", "old_to_new", lookups.old_to_new ?? ["Y", "N"])}
        {Sel("Status", "status", lookups.status ?? [])}
      </div>

      <h4 className="muted">NDE Requirement (RT coverage)</h4>
      <div className="form-grid cols-4" style={{ marginBottom: 8 }}>
        {Chk("5%", "spec_5")}
        {Chk("10%", "spec_10")}
        {Chk("20%", "spec_20")}
        {Chk("25%", "spec_25")}
        {Chk("50%", "spec_50")}
        {Chk("100%", "spec_100")}
      </div>

      <h4 className="muted">Pipe &amp; Material</h4>
      <div className="form-grid cols-4">
        {Sel("Material", "material", lookups.material ?? [])}
        {Sel("Schedule", "schedule", lookups.schedule ?? [])}
        <div className="field">
          <label>Size (NPS)</label>
          <input
            list="pipe-sizes"
            type="number"
            step="any"
            disabled={!editable}
            value={w.size ?? ""}
            onChange={(e) =>
              set("size", e.target.value === "" ? null : Number(e.target.value))
            }
          />
          <datalist id="pipe-sizes">
            {sizes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>Wall Thickness</label>
          <input value={thickness ?? "—"} disabled readOnly />
          <div className="hint">
            auto from Pipe Table · weld inches ={" "}
            {weldInches != null ? weldInches.toFixed(2) : "—"}
          </div>
        </div>
        {T("WPS Number", "wps_number")}
        {Sel("Shop or Field", "shop_or_field", lookups.shop_field ?? ["SHOP", "FW"])}
      </div>

      <h4 className="muted">Welder</h4>
      <div className="form-grid cols-4">
        <div className="field">
          <label>Welder Stamp</label>
          <select
            disabled={!editable}
            value={w.stamp_number ?? ""}
            onChange={(e) => set("stamp_number", (e.target.value || null) as any)}
          >
            <option value="">—</option>
            {stamps.map((s) => (
              <option key={s} value={s}>
                {s} — {welders.find((x) => x.stamp === s)?.name}
              </option>
            ))}
          </select>
        </div>
        {T("Date Welded", "date_welded", "date")}
        {Chk("Count Omission (exclude from counts)", "count_omission")}
      </div>

      <h4 className="muted">NDE Results</h4>
      <div className="form-grid cols-4">
        {T("UT Thickness", "ut_thickness")}
        {Sel("PT / MT Prep", "pt_mt_prep", ["Y"])}
        {Sel("PT / MT Root", "pt_mt_root", ["Y"])}
        {Sel("PT / MT Final", "pt_mt_final", ["Y"])}
        {Sel("Visual Insp.", "visual_insp", ["Y"])}
        {T("RT Date", "rt_date", "date")}
        {Sel("RT Accepted", "rt_accepted", ["Y"])}
        {Sel("RT Rejected", "rt_rejected", ["Y"])}
        {T("Inches of Defect", "inches_of_defect", "number")}
        {Sel("Ferrite", "ferrite", ["Y"])}
      </div>

      <h4 className="muted">Heat Treatment &amp; Pressure Test</h4>
      <div className="form-grid cols-4">
        {Sel("H2 Bake Out", "h2_bake_out", ["Y"])}
        {T("PWHT Date", "pwht_date", "date")}
        {Sel("Brinnel Complete", "brinnel_complete", ["Y"])}
        {T("PMI Date", "pmi_date", "date")}
        {T("Hydro Pressure", "hydro_pressure")}
        {T("Hydro Comp. Date", "hydro_comp_date", "date")}
      </div>

      <h4 className="muted">Notes</h4>
      <div className="field">
        <label>Description</label>
        <input
          disabled={!editable}
          value={w.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="field">
        <label>File Location / Comments</label>
        <input
          disabled={!editable}
          value={w.file_location ?? ""}
          onChange={(e) => set("file_location", e.target.value)}
          placeholder="path or link to work order documents"
        />
      </div>
    </Modal>
  );
}
