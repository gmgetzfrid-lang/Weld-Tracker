// The NDE lot closeout record as a PDF — the sheet that goes in the file when
// a lot is turned over and closed. jspdf loads on demand.
import type { jsPDF } from "jspdf";
import { api } from "./api";
import type { LotCard } from "./types";
import {
  AMBER, CONTENT_W, GREEN, INK, M, MUTED, NAVY, PAGE_W, RED,
  footer, n0, n1, pctF, pdfB64, sectionTitle, statTiles, table, type Cell,
} from "./reportPdf";

function d(s?: string | null): string {
  return s ? s.slice(0, 10) : "—";
}

async function buildLotPdf(card: LotCard, company: string): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const lot = card.lot;
  const rep = card.report;

  // ---- Title band ---------------------------------------------------------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 76, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(`NDE Lot ${lot.lot_no}${lot.label ? ` — ${lot.label}` : ""}`, M, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(company || "SENTRIX", M, 52);
  doc.setFontSize(9);
  doc.setTextColor(206, 214, 240);
  const status = lot.status === "Closed" ? (lot.closed_short ? "CLOSED SHORT" : "CLOSED CLEAN") : lot.status === "Closing" ? "AWAITING CLOSEOUT" : lot.is_default ? "OPEN — RECEIVING" : "OPEN";
  doc.text(`${status} · opened ${d(lot.opened_on)}${lot.closing_on ? ` · stopped taking welds ${d(lot.closing_on)}` : ""}${lot.closed_on ? ` · closed ${d(lot.closed_on)}` : ""}`, M, 66);
  doc.text(`Generated ${card.generated_on}`, PAGE_W - M, 66, { align: "right" });

  let y = 100;

  // ---- Headline -----------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  const headline = lot.status === "Closed"
    ? lot.closed_short
      ? `Closed short by ${lot.closed_by ?? "?"}: ${lot.close_reason ?? ""}`
      : `Closed clean by ${lot.closed_by ?? "?"} — every welder met their required NDE coverage.`
    : card.clean
      ? "Coverage complete — every welder at or above their required NDE coverage."
      : `${n0(card.owed)} examination${card.owed === 1 ? "" : "s"} owed${card.unresolved ? ` · ${n0(card.unresolved)} weld${card.unresolved === 1 ? "" : "s"} with an unresolved requirement` : ""}.`;
  doc.setTextColor(...(lot.status === "Closed" ? (lot.closed_short ? RED : GREEN) : card.clean ? GREEN : AMBER));
  doc.text(headline, M, y, { maxWidth: CONTENT_W });
  y += 22;

  // ---- Tiles --------------------------------------------------------------
  const span = lot.first_weld ? `${d(lot.first_weld)} → ${d(lot.last_weld ?? lot.first_weld)}` : "—";
  y = statTiles(doc, y, [
    { label: "Welds", value: n0(lot.weld_count) },
    { label: "Weld inches", value: n1(lot.weld_inches) },
    { label: "Examined", value: n0(lot.examined) },
    { label: "Rejects", value: `${n0(lot.rejects)} (${pctF(lot.examined ? lot.rejects / lot.examined : 0)})` },
    { label: "NDE owed", value: n0(card.owed), color: card.owed ? AMBER : GREEN },
    { label: "Welders", value: n0(lot.welder_count) },
    { label: "Work orders", value: n0(lot.work_order_count) },
    { label: "Weld dates", value: span },
  ]);
  y += 6;
  if (card.nde_by_type.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`Examinations by method: ${card.nde_by_type.map((t) => `${t.method} ${n0(t.count)}`).join("   ·   ")}`, M, y + 6);
    doc.setTextColor(...INK);
    y += 16;
  }
  y += 8;

  // ---- Welder coverage ----------------------------------------------------
  y = sectionTitle(doc, y, "Welder NDE Coverage in this Lot");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "Required = the spec's percentage of that welder's welds in this lot, plus ASME B31.3 341.3.4 progressive sampling (a reject adds two more; a third reject means all of them).",
    M, y, { maxWidth: CONTENT_W },
  );
  doc.setTextColor(...INK);
  y += 22;
  const rows: Cell[][] = rep.rows.flatMap((r) =>
    (r.specs.length ? r.specs : [null]).map((s, i): Cell[] => [
      i === 0 ? r.name || r.stamp : "",
      i === 0 ? r.stamp : "",
      i === 0 ? n0(r.weld_count) : "",
      i === 0 ? n1(r.weld_inches) : "",
      s?.spec ?? "—",
      s ? n0(s.population) : "",
      s ? (s.progressive_extra ? { text: `${n0(s.required)} (+${n0(s.progressive_extra)})`, color: AMBER, bold: true } : n0(s.required)) : "",
      s ? n0(s.examined) : "",
      s ? `${s.actual_pct.toFixed(0)}%` : "",
      s ? (s.shortfall ? { text: n0(s.shortfall), color: AMBER, bold: true } : "0") : "",
      s ? (s.compliant ? { text: "MET", color: GREEN, bold: true } : { text: "OWED", color: AMBER, bold: true }) : { text: "—", color: MUTED },
    ]),
  );
  y = table(
    doc, M, y,
    [
      { header: "Welder", width: 104 },
      { header: "Stamp", width: 40 },
      { header: "Welds", width: 40, align: "r" },
      { header: "Inches", width: 46, align: "r" },
      { header: "Spec", width: 50 },
      { header: "Pop.", width: 38, align: "r" },
      { header: "Required", width: 62, align: "r" },
      { header: "Exam.", width: 40, align: "r" },
      { header: "Actual", width: 44, align: "r" },
      { header: "Owed", width: 40, align: "r" },
      { header: "Verdict", width: CONTENT_W - 504 },
    ],
    rows.length ? rows : [["No welds with a welder in this lot.", "", "", "", "", "", "", "", "", "", ""]],
  );
  y += 20;

  // ---- Work orders --------------------------------------------------------
  if (card.work_orders.length) {
    y = sectionTitle(doc, y, "Work Orders in this Lot");
    y = table(
      doc, M, y,
      [
        { header: "Work Order", width: 120 },
        { header: "Welds", width: 50, align: "r" },
        { header: "Inches", width: 60, align: "r" },
        { header: "Examined", width: 60, align: "r" },
        { header: "Rejects", width: 55, align: "r" },
        { header: "Weld dates", width: 130 },
        { header: "Welders", width: CONTENT_W - 475 },
      ],
      card.work_orders.map((w) => [
        w.spans_other_lots ? `${w.work_order} *` : w.work_order,
        n0(w.weld_count),
        n1(w.weld_inches),
        n0(w.examined),
        n0(w.rejects),
        w.first_weld ? `${d(w.first_weld)} → ${d(w.last_weld ?? w.first_weld)}` : "—",
        w.welders || "—",
      ]),
    );
    if (card.spanning_work_orders) {
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text("* also has welds in another lot (the job crossed a turnover)", M, y + 10);
      doc.setTextColor(...INK);
      y += 12;
    }
    y += 20;
  }

  // ---- Closeout record ----------------------------------------------------
  y = sectionTitle(doc, y, "Lot Record");
  const rec: Cell[][] = [
    ["Opened", `${d(lot.opened_on)} by ${lot.created_by ?? "system"}`],
    ["Expected length", `${n0(lot.target_days)} days (due ${d(lot.due_on)})`],
    ["Stopped taking welds", d(lot.closing_on)],
    ["Closed", lot.closed_on ? `${d(lot.closed_on)} by ${lot.closed_by ?? "?"}` : "—"],
  ];
  if (lot.close_reason) rec.push(["Reason", lot.close_reason]);
  if (lot.closed_short && lot.shortfall_snapshot) {
    try {
      const snap = JSON.parse(lot.shortfall_snapshot) as { owed: number; unresolved: number; welders: { stamp: string; name: string; spec: string; owed: number }[] };
      rec.push([{ text: "Owed at close", color: RED, bold: true }, { text: `${n0(snap.owed)} examinations${snap.unresolved ? `, ${n0(snap.unresolved)} unresolved` : ""}: ${snap.welders.map((w) => `${w.name || w.stamp} ${w.spec} ×${w.owed}`).join("; ")}`, color: RED }]);
    } catch { /* malformed snapshot — the summary line above still says it closed short */ }
  }
  if (lot.notes) rec.push(["Notes", lot.notes]);
  table(doc, M, y, [{ header: "Field", width: 150 }, { header: "Value", width: CONTENT_W - 150 }], rec);

  footer(doc, `${company || "SENTRIX"} — NDE Lot ${lot.lot_no}`);
  return doc;
}

export async function downloadLotPdf(card: LotCard, company: string): Promise<string> {
  const doc = await buildLotPdf(card, company);
  return api.saveExport(`nde-lot-${card.lot.lot_no}.pdf`, pdfB64(doc), "reveal");
}

export async function openLotPdf(card: LotCard, company: string): Promise<string> {
  const doc = await buildLotPdf(card, company);
  return api.saveExport(`nde-lot-${card.lot.lot_no}.pdf`, pdfB64(doc), "open");
}
