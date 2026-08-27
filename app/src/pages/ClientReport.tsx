import { useEffect, useState } from "react";
import { api, errMsg, rejectThreshold } from "../api";
import type { ClientReportRow } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, pct } from "../components/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ClientReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<ClientReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(0.05);

  useEffect(() => {
    rejectThreshold().then(setWarn);
  }, []);

  useEffect(() => {
    setRows(null);
    api
      .reportClient(month, year)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
  }, [month, year]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(`client-report-${year}-${month}.csv`, [
      ["Welder", "Stamp", "Shift", "Process", "Weld Count", "Weld Inches", "RTs", "RT %", "Rejects", "Reject Rate", "Most Recent RT"],
      ...rows.map((r) => [
        r.name, r.stamp, r.shift ?? "", r.process ?? "", r.weld_count,
        r.inches.toFixed(1), r.rt_count, pct(r.rt_pct), r.rejects,
        pct(r.reject_rate), r.last_rt_date ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0 }}>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <button className="btn btn-sm" onClick={() => setYear((y) => y - 1)}>‹</button>
        <strong>{year}</strong>
        <button className="btn btn-sm" onClick={() => setYear((y) => y + 1)}>›</button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>TSA Welder Summary Report</span>
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
                <th>Shift</th>
                <th>Process</th>
                <th className="num">Weld Count</th>
                <th className="num">Weld Inches</th>
                <th className="num">RTs</th>
                <th className="num">RT %</th>
                <th className="num">Rejects</th>
                <th className="num">Reject Rate</th>
                <th>Most Recent RT</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="table-empty">No welds recorded for {MONTHS[month - 1]} {year}.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.stamp}>
                  <td style={{ fontWeight: 600 }}>{r.name || <span className="faint">(unknown)</span>}</td>
                  <td>{r.stamp}</td>
                  <td>{r.shift ?? "—"}</td>
                  <td>{r.process ?? "—"}</td>
                  <td className="num">{num(r.weld_count)}</td>
                  <td className="num">{num(r.inches, 1)}</td>
                  <td className="num">{num(r.rt_count)}</td>
                  <td className="num">{pct(r.rt_pct)}</td>
                  <td className="num">{num(r.rejects)}</td>
                  <td className="num" style={{ color: r.reject_rate > warn ? "var(--danger)" : undefined }}>
                    {pct(r.reject_rate)}
                  </td>
                  <td>{r.last_rt_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
