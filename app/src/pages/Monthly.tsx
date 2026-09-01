import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { MonthlyReport } from "../types";
import { ErrorBox, Spinner, downloadCsv, num, pct } from "../components/ui";
import { Columns } from "../components/charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Monthly() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [rep, setRep] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRep(null);
    api.reportMonthly(year).then(setRep).catch((e) => setError(errMsg(e)));
  }, [year]);

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  const exportCsv = () => {
    if (!rep) return;
    const rows: (string | number)[][] = [["Metric", ...MONTHS, "Total"]];
    for (const j of rep.joints) {
      rows.push([`${j.joint_type} welds`, ...j.welds, sum(j.welds)]);
    }
    rows.push(["Total welds", ...rep.total_welds, sum(rep.total_welds)]);
    rows.push(["Total RT'd", ...rep.total_rt, sum(rep.total_rt)]);
    rows.push(["Total rejected", ...rep.total_rejected, sum(rep.total_rejected)]);
    rows.push(["Total weld inches", ...rep.total_inches.map((x) => +x.toFixed(1)), +sum(rep.total_inches).toFixed(1)]);
    downloadCsv(`monthly-${year}.csv`, rows);
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-sm" onClick={() => setYear((y) => y - 1)}>‹</button>
        <strong style={{ fontSize: 16 }}>{year}</strong>
        <button className="btn btn-sm" onClick={() => setYear((y) => y + 1)}>›</button>
        <div className="spacer" />
        <button className="btn" onClick={exportCsv}>⭳ Export CSV</button>
      </div>
      <ErrorBox message={error} />
      {!rep ? (
        <Spinner />
      ) : (
        <>
        <div className="card card-pad chart-card" style={{ marginBottom: 16 }}>
          <h4>Welds per month — {year}</h4>
          <p className="chart-sub">Hover a month for examinations, rejects and weld inches</p>
          <Columns
            points={MONTHS.map((m, i) => ({
              key: m,
              label: m,
              value: rep.total_welds[i] ?? 0,
              detail: [
                ["RT'd", num(rep.total_rt[i] ?? 0)],
                ["Rejected", num(rep.total_rejected[i] ?? 0)],
                ["Weld inches", num(rep.total_inches[i] ?? 0, 1)],
              ],
            }))}
          />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                {MONTHS.map((m) => <th key={m} className="num">{m}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rep.joints.map((j) => (
                <tr key={j.joint_type}>
                  <td style={{ fontWeight: 600 }}>{j.joint_type || "(none)"} welds</td>
                  {j.welds.map((v, i) => <td key={i} className="num">{v || ""}</td>)}
                  <td className="num">{num(sum(j.welds))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total welds</td>
                {rep.total_welds.map((v, i) => <td key={i} className="num">{v || ""}</td>)}
                <td className="num">{num(sum(rep.total_welds))}</td>
              </tr>
              <tr>
                <td>Total RT'd</td>
                {rep.total_rt.map((v, i) => <td key={i} className="num">{v || ""}</td>)}
                <td className="num">{num(sum(rep.total_rt))}</td>
              </tr>
              <tr>
                <td>Total rejected</td>
                {rep.total_rejected.map((v, i) => <td key={i} className="num">{v || ""}</td>)}
                <td className="num">{num(sum(rep.total_rejected))}</td>
              </tr>
              <tr>
                <td>Reject rate</td>
                {rep.total_rt.map((rt, i) => (
                  <td key={i} className="num">{rt ? pct(rep.total_rejected[i] / rt) : ""}</td>
                ))}
                <td className="num">
                  {sum(rep.total_rt) ? pct(sum(rep.total_rejected) / sum(rep.total_rt)) : "—"}
                </td>
              </tr>
              <tr>
                <td>Weld inches</td>
                {rep.total_inches.map((v, i) => <td key={i} className="num">{v ? v.toFixed(1) : ""}</td>)}
                <td className="num">{num(sum(rep.total_inches), 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
