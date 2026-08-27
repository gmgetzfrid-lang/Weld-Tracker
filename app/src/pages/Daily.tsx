import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { DailyReport } from "../types";
import { ErrorBox, Spinner, StatCard, num, pct } from "../components/ui";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function Daily() {
  const [date, setDate] = useState(today());
  const [rep, setRep] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRep(null);
    api.reportDaily(date).then(setRep).catch((e) => setError(errMsg(e)));
  }, [date]);

  return (
    <div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="spacer" />
      </div>
      <ErrorBox message={error} />
      {!rep ? (
        <Spinner />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 18 }}>
            <StatCard label="Welds This Day" value={num(rep.total.welds)} />
            <StatCard label="RT'd" value={num(rep.total.rt)} sub={pct(rep.total.rt_pct)} />
            <StatCard label="Rejected" value={num(rep.total.rejected)} />
            <StatCard label="Weld Inches" value={num(rep.total.inches, 1)} />
          </div>

          <div className="grid cols-2">
            <div className="card">
              <div className="card-pad" style={{ paddingBottom: 8 }}><h3>By Joint Type</h3></div>
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="data">
                  <thead>
                    <tr><th>Joint</th><th className="num">Welds</th><th className="num">RT'd</th><th className="num">Rejected</th><th className="num">Inches</th></tr>
                  </thead>
                  <tbody>
                    {rep.by_joint.length === 0 && (
                      <tr><td colSpan={5} className="table-empty">No welds on {rep.date}.</td></tr>
                    )}
                    {rep.by_joint.map((j) => (
                      <tr key={j.joint_type || "none"}>
                        <td>{j.joint_type || "(none)"}</td>
                        <td className="num">{num(j.welds)}</td>
                        <td className="num">{num(j.rt)}</td>
                        <td className="num">{num(j.rejected)}</td>
                        <td className="num">{num(j.inches, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-pad" style={{ paddingBottom: 8 }}><h3>Recent Active Days</h3></div>
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="data">
                  <thead>
                    <tr><th>Date</th><th className="num">Welds</th><th className="num">RT'd</th><th className="num">Rejected</th><th className="num">Inches</th></tr>
                  </thead>
                  <tbody>
                    {rep.recent.map((d) => (
                      <tr key={d.date} className="clickable" onClick={() => setDate(d.date)}>
                        <td>{d.date}</td>
                        <td className="num">{num(d.welds)}</td>
                        <td className="num">{num(d.rt)}</td>
                        <td className="num">{num(d.rejected)}</td>
                        <td className="num">{num(d.inches, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
