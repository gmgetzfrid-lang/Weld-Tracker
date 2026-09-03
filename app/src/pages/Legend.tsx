import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { CriteriaRow } from "../types";
import { ErrorBox, Spinner } from "../components/ui";

export function Legend() {
  const [rows, setRows] = useState<CriteriaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCriteria().then(setRows).catch((e) => setError(errMsg(e)));
  }, []);

  return (
    <div>
      <div className="section-title">
        <h3>Criteria Category Legend</h3>
        <span className="muted" style={{ fontSize: 13 }}>per REP 5-5-1</span>
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : (
        <div className="table-wrap" style={{ maxWidth: 900 }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Category</th>
                <th>Criteria</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700, fontSize: 15, color: "var(--navy)" }}>{r.category}</td>
                  <td style={{ whiteSpace: "normal" }}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
