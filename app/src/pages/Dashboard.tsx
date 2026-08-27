import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { SummaryReport } from "../types";
import { BarChart, ErrorBox, Spinner, StatCard, num, pct } from "../components/ui";

export function Dashboard({ onNavigate }: { onNavigate: (p: any) => void }) {
  const [rep, setRep] = useState<SummaryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reportSummary().then(setRep).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rep) return <Spinner />;

  const t = rep.total;
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="grid cols-4">
        <StatCard label="Total Welds" value={num(t.welds)} sub="excludes count-omitted" />
        <StatCard
          label="RT Coverage"
          value={pct(t.rt_pct)}
          sub={`${num(t.rt)} of ${num(t.welds)} RT'd`}
        />
        <StatCard
          label="Reject Rate"
          value={pct(t.reject_rate)}
          sub={`${num(t.rejected)} rejected of ${num(t.rt)} RT'd`}
        />
        <StatCard
          label="Welders"
          value={num(rep.active_welder_count)}
          sub={`${num(rep.welder_count)} on roster`}
        />
      </div>

      <div className="grid cols-2">
        <div className="card card-pad">
          <h3>Welds by Joint Type</h3>
          <BarChart
            data={rep.by_joint.map((j) => ({
              label: j.joint_type || "(none)",
              value: j.welds,
            }))}
            format={(n) => num(n)}
          />
        </div>
        <div className="card card-pad">
          <h3>Total Weld Inches</h3>
          <div className="stat" style={{ border: 0, boxShadow: "none", padding: 0 }}>
            <div className="value" style={{ fontSize: 40 }}>
              {num(t.inches, 1)}
            </div>
            <div className="sub">cumulative diameter-inches welded</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => onNavigate("weldlog")}>
              Open Weld Log →
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 8 }}>
          <h3>Breakdown by Joint Type</h3>
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
                <th className="num">PT/MT</th>
                <th className="num">RT %</th>
                <th className="num">Reject Rate</th>
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
                  <td className="num">{num(j.pt_mt)}</td>
                  <td className="num">{pct(j.rt_pct)}</td>
                  <td className="num">{pct(j.reject_rate)}</td>
                  <td className="num">{num(j.inches, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{num(t.welds)}</td>
                <td className="num">{num(t.rt)}</td>
                <td className="num">{num(t.accepted)}</td>
                <td className="num">{num(t.rejected)}</td>
                <td className="num">{num(t.pt_mt)}</td>
                <td className="num">{pct(t.rt_pct)}</td>
                <td className="num">{pct(t.reject_rate)}</td>
                <td className="num">{num(t.inches, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
