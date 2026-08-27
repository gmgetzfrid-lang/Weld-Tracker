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
    api
      .reportJob(wo)
      .then((r) => {
        setRep(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
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
            <StatCard
              label="Examined"
              value={num(rep.total_examined)}
              sub={`${pct(rep.total_examined_pct)} · butt RT + others PT/MT`}
            />
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
                    <th className="num">Examined</th>
                    <th className="num">Method</th>
                    <th className="num">Rejected</th>
                    <th className="num">% Examined</th>
                    <th className="num">Weld Inches</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Butt welds are examined by RT; others by PT/MT Final. */}
                  <tr>
                    <td style={{ fontWeight: 600 }}>Butt Welds</td>
                    <td className="num">{num(rep.butt.welds)}</td>
                    <td className="num">{num(rep.butt.rt)}</td>
                    <td className="num">RT</td>
                    <td className="num">{num(rep.butt.rejected)}</td>
                    <td className="num">{pct(rep.butt.rt_pct)}</td>
                    <td className="num">{num(rep.butt.inches, 1)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Socket / O-Let / Fillet / Other</td>
                    <td className="num">{num(rep.other.welds)}</td>
                    <td className="num">{num(rep.other.pt_mt)}</td>
                    <td className="num">PT/MT</td>
                    <td className="num">{num(rep.other.rejected)}</td>
                    <td className="num">
                      {pct(rep.other.welds ? rep.other.pt_mt / rep.other.welds : 0)}
                    </td>
                    <td className="num">{num(rep.other.inches, 1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
