import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import type { PipeRow } from "../types";
import { ErrorBox, SkeletonRows } from "../components/ui";

const SCHED_ORDER = ["5s", "5", "10s", "10", "20", "30", "40", "STD/40s", "60", "80", "XH", "100", "120", "140", "160", "XXH"];

export function PipeTable() {
  const [rows, setRows] = useState<PipeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.listPipe().then(setRows).catch((e) => setError(errMsg(e)));
  }, []);

  const { sizes, od, matrix, scheds } = useMemo(() => {
    const sizes: number[] = [];
    const od: Record<number, number | null> = {};
    const matrix: Record<number, Record<string, number>> = {};
    const schedSet = new Set<string>();
    for (const r of rows ?? []) {
      if (!(r.nps in matrix)) {
        matrix[r.nps] = {};
        sizes.push(r.nps);
        od[r.nps] = r.od ?? null;
      }
      matrix[r.nps][r.schedule] = r.wall;
      schedSet.add(r.schedule);
    }
    sizes.sort((a, b) => a - b);
    // Known schedules in wall-thickness order, then anything else the table
    // carries (a renamed or imported schedule must never silently vanish).
    const extra = [...schedSet].filter((s) => !SCHED_ORDER.includes(s)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const scheds = [...SCHED_ORDER.filter((s) => schedSet.has(s)), ...extra];
    return { sizes, od, matrix, scheds };
  }, [rows]);

  const shown = sizes.filter((s) => !q || String(s).includes(q.trim()));

  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <input placeholder="Filter by nominal size…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }} title="Source: converted from the Weld_Log_Statistics workbook's Pipe Table (ASME B36.10M / B36.19M dimensions). Auto-fills weld wall thickness.">
          Wall thickness (in) by nominal size &amp; schedule · per ASME B36.10M/B36.19M
        </span>
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <SkeletonRows />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>NPS</th>
                <th className="num">O.D.</th>
                {scheds.map((s) => <th key={s} className="num">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((sz) => (
                <tr key={sz}>
                  <td style={{ fontWeight: 600 }}>{sz}</td>
                  <td className="num">{od[sz] != null ? od[sz]!.toFixed(3) : "—"}</td>
                  {scheds.map((s) => (
                    <td key={s} className="num">
                      {matrix[sz][s] != null ? matrix[sz][s].toFixed(3) : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
