import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { Welder, WelderStatRow } from "../types";
import { ErrorBox, StatCard, num, pct } from "../components/ui";

export function WelderReport() {
  const [welders, setWelders] = useState<Welder[]>([]);
  const [stamp, setStamp] = useState("");
  const [rep, setRep] = useState<WelderStatRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listWelders(true, "name").then((w) => {
      setWelders(w);
      if (w.length && !stamp) setStamp(w[0].stamp);
    });
  }, []);

  useEffect(() => {
    if (!stamp) return;
    setRep(null);
    api
      .reportWelder(stamp)
      .then((r) => {
        setRep(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
  }, [stamp]);

  return (
    <div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0, minWidth: 280 }}>
          <select value={stamp} onChange={(e) => setStamp(e.target.value)}>
            {welders.map((w) => (
              <option key={w.stamp} value={w.stamp}>
                {w.name} — {w.stamp}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox message={error} />
      {rep && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 18 }}>
            <StatCard label="Total Welds" value={num(rep.total.welds)} />
            <StatCard label="RT Coverage" value={pct(rep.total.rt_pct)} sub={`${num(rep.total.rt)} RT'd`} />
            <StatCard label="Reject Rate" value={pct(rep.total.reject_rate)} sub={`${num(rep.total.rejected)} rejected`} />
            <StatCard label="Weld Inches" value={num(rep.total.inches, 1)} />
          </div>
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 8 }}>
              <h3>{rep.name} — Breakdown by Joint Type</h3>
            </div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Joint Type</th>
                    <th className="num">Welds</th>
                    <th className="num">RT'd</th>
                    <th className="num">Accepted</th>
                    <th className="num">Rejected</th>
                    <th className="num">RT %</th>
                    <th className="num">Reject Rate</th>
                    <th className="num">PT/MT</th>
                    <th className="num">Brinell</th>
                    <th className="num">Weld Inches</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.by_joint.map((j) => (
                    <tr key={j.joint_type || "none"}>
                      <td>{j.joint_type || "(none)"}</td>
                      <td className="num">{num(j.welds)}</td>
                      <td className="num">{num(j.rt)}</td>
                      <td className="num">{num(j.accepted)}</td>
                      <td className="num">{num(j.rejected)}</td>
                      <td className="num">{pct(j.rt_pct)}</td>
                      <td className="num">{pct(j.reject_rate)}</td>
                      <td className="num">{num(j.pt_mt)}</td>
                      <td className="num">{num(j.brinnel)}</td>
                      <td className="num">{num(j.inches, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
