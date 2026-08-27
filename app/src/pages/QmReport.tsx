import { useEffect, useState } from "react";
import { api, errMsg, rejectThreshold } from "../api";
import type { WelderStatRow } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, pct } from "../components/ui";

export function QmReport() {
  const [rows, setRows] = useState<WelderStatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(0.05);

  useEffect(() => {
    rejectThreshold().then(setWarn);
    api.reportQm().then(setRows).catch((e) => setError(errMsg(e)));
  }, []);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv("qm-summary.csv", [
      ["Welder", "Stamp", "Welds", "RT Accepted", "PT/MT Final", "RT Rejected", "RT %", "Reject Rate"],
      ...rows.map((r) => [
        r.name, r.stamp, r.total.welds, r.total.accepted, r.total.pt_mt,
        r.total.rejected, pct(r.total.rt_pct), pct(r.total.reject_rate),
      ]),
    ]);
  };

  return (
    <div>
      <div className="toolbar">
        <div className="section-title" style={{ margin: 0 }}>
          <h3>Quality Manager Summary</h3>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Welder</th>
                <th>Stamp</th>
                <th className="num">Welds</th>
                <th className="num">RT Accepted</th>
                <th className="num">PT/MT Final</th>
                <th className="num">RT Rejected</th>
                <th className="num">RT %</th>
                <th className="num">Reject Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stamp}>
                  <td style={{ fontWeight: 600 }}>{r.name || <span className="faint">(unknown)</span>}</td>
                  <td>{r.stamp}</td>
                  <td className="num">{num(r.total.welds)}</td>
                  <td className="num">{num(r.total.accepted)}</td>
                  <td className="num">{num(r.total.pt_mt)}</td>
                  <td className="num">{num(r.total.rejected)}</td>
                  <td className="num">{pct(r.total.rt_pct)}</td>
                  <td className="num" style={{ color: r.total.reject_rate > warn ? "var(--danger)" : undefined }}>
                    {pct(r.total.reject_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
