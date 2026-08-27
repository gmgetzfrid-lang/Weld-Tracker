import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { JobReport as JobRep } from "../types";
import { ErrorBox, StatCard, num, pct } from "../components/ui";

export function JobReport() {
  const [workOrders, setWorkOrders] = useState<string[]>([]);
  const [wo, setWo] = useState("");
  const [rep, setRep] = useState<JobRep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.distinctWeldValues("work_order").then((v) => {
      setWorkOrders(v);
      if (v.length && !wo) setWo(v[0]);
    });
  }, []);

  useEffect(() => {
    if (!wo) return;
    api.reportJob(wo).then(setRep).catch((e) => setError(errMsg(e)));
  }, [wo]);

  return (
    <div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0, minWidth: 240 }}>
          <label style={{ display: "none" }}>Work order</label>
          <input
            list="wo-list"
            placeholder="Select or type a work order #"
            value={wo}
            onChange={(e) => setWo(e.target.value)}
          />
          <datalist id="wo-list">
            {workOrders.map((w) => <option key={w} value={w} />)}
          </datalist>
        </div>
      </div>
      <ErrorBox message={error} />
      {rep && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 18 }}>
            <StatCard label="Work Order" value={rep.work_order || "—"} />
            <StatCard label="Total Welds" value={num(rep.total_welds)} />
            <StatCard label="RT'd" value={num(rep.total_rt)} sub={pct(rep.total_rt_pct)} />
            <StatCard label="Butt Welds" value={num(rep.butt.welds)} />
          </div>
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 8 }}><h3>Weld Summary</h3></div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Welds</th>
                    <th className="num">RT'd</th>
                    <th className="num">Accepted</th>
                    <th className="num">Rejected</th>
                    <th className="num">RT %</th>
                    <th className="num">Reject Rate</th>
                    <th className="num">Weld Inches</th>
                  </tr>
                </thead>
                <tbody>
                  {[["Butt Welds", rep.butt], ["Socket / O-Let / Fillet / Other", rep.other]].map(
                    ([label, s]: any) => (
                      <tr key={label}>
                        <td style={{ fontWeight: 600 }}>{label}</td>
                        <td className="num">{num(s.welds)}</td>
                        <td className="num">{num(s.rt)}</td>
                        <td className="num">{num(s.accepted)}</td>
                        <td className="num">{num(s.rejected)}</td>
                        <td className="num">{pct(s.rt_pct)}</td>
                        <td className="num">{pct(s.reject_rate)}</td>
                        <td className="num">{num(s.inches, 1)}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
