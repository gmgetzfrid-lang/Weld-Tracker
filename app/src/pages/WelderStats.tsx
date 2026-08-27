import { useEffect, useState } from "react";
import { api, errMsg, rejectThreshold } from "../api";
import type { WelderStatsReport } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, pct } from "../components/ui";

const LEVELS = [
  ["all", "All"],
  ["5", "5%"],
  ["10", "10%"],
  ["20", "20%"],
  ["25", "25%"],
  ["50", "50%"],
  ["100", "100%"],
];

export function WelderStats() {
  const [level, setLevel] = useState("all");
  const [rep, setRep] = useState<WelderStatsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(0.05);

  useEffect(() => {
    rejectThreshold().then(setWarn);
  }, []);

  useEffect(() => {
    setRep(null);
    api
      .reportWelderStats(level)
      .then((r) => {
        setRep(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
  }, [level]);

  const exportCsv = () => {
    if (!rep) return;
    downloadCsv(`welder-stats-${level}.csv`, [
      ["Welder", "Stamp", "Active", "Welds", "RT'd", "Accepted", "Rejected", "RT %", "Reject Rate", "Weld Inches"],
      ...rep.rows.map((r) => [
        r.name, r.stamp, r.active ? "Yes" : "No", r.total.welds, r.total.rt,
        r.total.accepted, r.total.rejected, pct(r.total.rt_pct), pct(r.total.reject_rate),
        r.total.inches.toFixed(1),
      ]),
    ]);
  };

  return (
    <div>
      <div className="toolbar">
        <div className="pill-tabs">
          {LEVELS.map(([k, label]) => (
            <button key={k} className={level === k ? "active" : ""} onClick={() => setLevel(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          NDE examination level {level === "all" ? "— all welds" : `${level}%`}
        </span>
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
      </div>

      <ErrorBox message={error} />
      {!rep ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Welder</th>
                <th>Stamp</th>
                <th className="num">Welds</th>
                <th className="num">RT'd</th>
                <th className="num">Accepted</th>
                <th className="num">Rejected</th>
                <th className="num">RT %</th>
                <th className="num">Reject Rate</th>
                <th className="num">PT/MT</th>
                <th className="num">Weld Inches</th>
              </tr>
            </thead>
            <tbody>
              {rep.rows.length === 0 && (
                <tr><td colSpan={10} className="table-empty">No welds recorded at this level.</td></tr>
              )}
              {rep.rows.map((r) => (
                <tr key={r.stamp}>
                  <td style={{ fontWeight: 600 }}>
                    {r.name || <span className="faint">(unknown)</span>}
                    {!r.active && <span className="badge badge-gray" style={{ marginLeft: 6 }}>inactive</span>}
                  </td>
                  <td>{r.stamp}</td>
                  <td className="num">{num(r.total.welds)}</td>
                  <td className="num">{num(r.total.rt)}</td>
                  <td className="num">{num(r.total.accepted)}</td>
                  <td className="num">{num(r.total.rejected)}</td>
                  <td className="num">{pct(r.total.rt_pct)}</td>
                  <td className="num" style={{ color: r.total.reject_rate > warn ? "var(--danger)" : undefined }}>
                    {pct(r.total.reject_rate)}
                  </td>
                  <td className="num">{num(r.total.pt_mt)}</td>
                  <td className="num">{num(r.total.inches, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{num(rep.total.welds)}</td>
                <td className="num">{num(rep.total.rt)}</td>
                <td className="num">{num(rep.total.accepted)}</td>
                <td className="num">{num(rep.total.rejected)}</td>
                <td className="num">{pct(rep.total.rt_pct)}</td>
                <td className="num">{pct(rep.total.reject_rate)}</td>
                <td className="num">{num(rep.total.pt_mt)}</td>
                <td className="num">{num(rep.total.inches, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
