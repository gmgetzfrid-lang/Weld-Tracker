import { useEffect, useState } from "react";
import { Performance } from "./Performance";
import { Statistics } from "./Statistics";
import { WelderStats } from "./WelderStats";
import { WelderReport } from "./WelderReport";
import { Monthly } from "./Monthly";
import { Daily } from "./Daily";
import { JobReport } from "./JobReport";
import { ClientReport } from "./ClientReport";
import { QmReport } from "./QmReport";

export type ReportTab =
  | "performance"
  | "statistics"
  | "welderstats"
  | "welderreport"
  | "monthly"
  | "daily"
  | "job"
  | "client"
  | "qm";

const TABS: { key: ReportTab; label: string; desc: string }[] = [
  { key: "performance", label: "Performance", desc: "Each welder's performance and proof they stayed at or above their assigned NDE spec — the distribution report." },
  { key: "statistics", label: "NDE Compliance", desc: "Per-welder NDE compliance (5/10/20/100% + API 570) and reject-rate analysis." },
  { key: "welderstats", label: "Welder Statistics", desc: "Per-welder counts and reject rates by NDE examination level." },
  { key: "welderreport", label: "Welder", desc: "A single welder's full breakdown by joint type." },
  { key: "monthly", label: "Monthly", desc: "Weld counts, RT and rejects across the twelve months of a year." },
  { key: "daily", label: "Daily", desc: "How many welds were made and RT'd on a given day." },
  { key: "job", label: "Job", desc: "Totals and examination completion for one work order." },
  { key: "client", label: "Client / TSA", desc: "The monthly per-welder summary for the client." },
  { key: "qm", label: "QM Summary", desc: "Quality-manager roll-up of acceptance and rejection by welder." },
];

/**
 * One Reports workspace instead of nine navigation destinations: pick the
 * report, keep the sidebar small. Every report component is unchanged — this
 * is a shell.
 */
export function Reports({ initialTab }: { initialTab?: ReportTab }) {
  const [tab, setTab] = useState<ReportTab>(initialTab ?? "performance");
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const current = TABS.find((t) => t.key === tab);

  return (
    <div>
      <div className="report-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`report-tab ${tab === t.key ? "active" : ""}`}
            title={t.desc}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current && <p className="muted report-tab-desc">{current.desc}</p>}
      {tab === "performance" && <Performance />}
      {tab === "statistics" && <Statistics />}
      {tab === "welderstats" && <WelderStats />}
      {tab === "welderreport" && <WelderReport />}
      {tab === "monthly" && <Monthly />}
      {tab === "daily" && <Daily />}
      {tab === "job" && <JobReport />}
      {tab === "client" && <ClientReport />}
      {tab === "qm" && <QmReport />}
    </div>
  );
}
