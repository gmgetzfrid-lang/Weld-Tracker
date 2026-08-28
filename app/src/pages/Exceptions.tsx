import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { ExceptionsSummary, Severity, WeldException } from "../types";
import { ErrorBox, Spinner } from "../components/ui";

const SEV_ORDER: Severity[] = ["error", "warning", "advisory"];
const SEV_LABEL: Record<Severity, string> = {
  error: "Errors",
  warning: "Warnings",
  advisory: "Advisories",
};

/**
 * The exceptions dashboard: the validation engine, run across every live weld,
 * rolled up so nothing that's out of spec hides in the log. Headline tiles are
 * clickable filters; each weld drills down to its findings and opens its work
 * order. This is the "17 NDE owed, 3 rejects awaiting repair" board.
 */
export function Exceptions({ onOpenWorkOrder }: { onOpenWorkOrder: (wo: string) => void }) {
  const [data, setData] = useState<ExceptionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Severity | null>(null);
  const [codeFilter, setCodeFilter] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.weldExceptions(null)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    if (!data) return [];
    return data.welds.filter((w: WeldException) => {
      if (sevFilter && w.severity !== sevFilter) return false;
      if (codeFilter && !w.findings.some((f) => f.code === codeFilter)) return false;
      return true;
    });
  }, [data, sevFilter, codeFilter]);

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0 }}>Exceptions</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Every weld the validation engine flags — worst first. Fix the errors before closeout.
          </div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={load}>↻ Refresh</button>
      </div>

      <ErrorBox message={error} />

      {data && (
        <>
          <div className="exc-tiles">
            <button className={`exc-tile ${sevFilter === null ? "active" : ""}`} onClick={() => { setSevFilter(null); setCodeFilter(null); }}>
              <span className="exc-num">{data.flagged}</span>
              <span className="exc-cap">Flagged</span>
              <span className="exc-sub">of {data.population} welds</span>
            </button>
            {SEV_ORDER.map((s) => (
              <button key={s} className={`exc-tile sev-${s} ${sevFilter === s ? "active" : ""}`}
                onClick={() => { setSevFilter(sevFilter === s ? null : s); setCodeFilter(null); }}>
                <span className="exc-num">{s === "error" ? data.errors : s === "warning" ? data.warnings : data.advisories}</span>
                <span className="exc-cap">{SEV_LABEL[s]}</span>
              </button>
            ))}
          </div>

          {Object.keys(data.by_code).length > 0 && (
            <div className="exc-codes">
              {Object.entries(data.by_code)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => (
                  <button key={code} className={`exc-chip ${codeFilter === code ? "active" : ""}`}
                    onClick={() => setCodeFilter(codeFilter === code ? null : code)}>
                    {codeLabel(code)} <b>{n}</b>
                  </button>
                ))}
            </div>
          )}

          {data.flagged === 0 ? (
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 34 }}>✓</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>No exceptions</div>
              <div className="muted">Every live weld passes validation.</div>
            </div>
          ) : (
            <div className="exc-list">
              {shown.map((w) => (
                <div key={w.weld_id} className={`exc-row sev-${w.severity}`}>
                  <div className="exc-row-head">
                    <span className={`exc-dot sev-${w.severity}`} />
                    <span className="exc-weld">{w.weld_number ?? `#${w.weld_id}`}</span>
                    {w.work_order && (
                      <button className="exc-wo" onClick={() => onOpenWorkOrder(w.work_order!)} title="Open this work order">
                        WO {w.work_order}
                      </button>
                    )}
                    {w.drawing_no && <span className="muted">· {w.drawing_no}</span>}
                    {w.stamp_number && <span className="muted">· {w.stamp_number}</span>}
                  </div>
                  <ul className="exc-findings">
                    {w.findings.map((f, i) => (
                      <li key={i} className={`sev-${f.severity}`}>{f.message}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {shown.length === 0 && <div className="muted" style={{ padding: 12 }}>No welds match this filter.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function codeLabel(code: string): string {
  const map: Record<string, string> = {
    "nde.unresolved": "NDE unresolved",
    "nde.below_spec": "Below NDE spec",
    "nde.percent_missing": "NDE % missing",
    "nde.supplemental": "Supplemental exam",
    "result.rejected_unrepaired": "Rejected, no repair",
    "result.rejected_repaired": "Rejected, repaired",
    "result.contradiction": "Accept/Reject conflict",
    "field.welder": "No welder",
    "field.date": "No date",
    "field.size": "No size",
    "field.joint": "No joint type",
    "pwht.missing": "PWHT owed",
    "pmi.missing": "PMI owed",
    "hydro.pending": "Hydro pending",
  };
  return map[code] ?? code;
}
