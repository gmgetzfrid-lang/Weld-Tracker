import { jsPDF } from "jspdf";
import type { PerformanceReport, PerformanceRow } from "./types";

// Brand palette (matches the app navy).
const NAVY: [number, number, number] = [10, 31, 107];
const GREEN: [number, number, number] = [22, 128, 61];
const AMBER: [number, number, number] = [176, 84, 8];
const RED: [number, number, number] = [176, 28, 28];
const INK: [number, number, number] = [24, 35, 59];
const MUTED: [number, number, number] = [110, 116, 130];
const LINE: [number, number, number] = [222, 227, 236];
const ZEBRA: [number, number, number] = [244, 246, 251];

/** Fraction (0..1) -> "12.3%". */
const pctF = (v: number) => `${(v * 100).toFixed(1)}%`;
/** Already a percentage (0..100) -> "12%". */
const pct100 = (v: number) => `${v.toFixed(0)}%`;
const n1 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

type Cell =
  | string
  | { text: string; color?: [number, number, number]; bold?: boolean };
interface Col {
  header: string;
  width: number;
  align?: "l" | "r";
}

const M = 42; // page margin
const PAGE_W = 612; // letter, pt
const CONTENT_W = PAGE_W - M * 2;

function cellText(c: Cell): string {
  return typeof c === "string" ? c : c.text;
}

/** A paginated table with a repeating header. Returns the y below the table. */
function table(
  doc: jsPDF,
  x: number,
  y0: number,
  cols: Col[],
  rows: Cell[][],
): number {
  const rowH = 17;
  const pageH = doc.internal.pageSize.getHeight();
  const totalW = cols.reduce((a, c) => a + c.width, 0);
  let y = y0;

  const drawHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(x, y, totalW, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    let cx = x;
    cols.forEach((c) => {
      const tx = c.align === "r" ? cx + c.width - 5 : cx + 5;
      doc.text(c.header, tx, y + 11.5, { align: c.align === "r" ? "right" : "left" });
      cx += c.width;
    });
    y += rowH;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
  };

  drawHeader();
  doc.setFontSize(8.5);
  rows.forEach((r, ri) => {
    if (y + rowH > pageH - 46) {
      doc.addPage();
      y = 54;
      drawHeader();
    }
    if (ri % 2 === 1) {
      doc.setFillColor(...ZEBRA);
      doc.rect(x, y, totalW, rowH, "F");
    }
    let cx = x;
    r.forEach((cell, i) => {
      const c = cols[i];
      const txt = cellText(cell);
      const color = typeof cell === "object" && cell.color ? cell.color : INK;
      doc.setTextColor(...color);
      doc.setFont("helvetica", typeof cell === "object" && cell.bold ? "bold" : "normal");
      const tx = c.align === "r" ? cx + c.width - 5 : cx + 5;
      doc.text(txt.slice(0, 46), tx, y + 11.5, { align: c.align === "r" ? "right" : "left" });
      cx += c.width;
    });
    y += rowH;
  });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  // outer border
  doc.setDrawColor(...LINE);
  doc.rect(x, y0, totalW, y - y0);
  return y;
}

function sectionTitle(doc: jsPDF, y: number, text: string): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + 40 > pageH - 46) {
    doc.addPage();
    y = 54;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(text, M, y);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.2);
  doc.line(M, y + 4, M + CONTENT_W, y + 4);
  doc.setLineWidth(1);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  return y + 18;
}

/** The stat tiles across the executive summary. */
function statTiles(
  doc: jsPDF,
  y: number,
  tiles: { label: string; value: string; color?: [number, number, number] }[],
): number {
  const gap = 8;
  const perRow = 4;
  const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
  const h = 46;
  tiles.forEach((t, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = M + col * (w + gap);
    const ty = y + row * (h + gap);
    doc.setDrawColor(...LINE);
    doc.setFillColor(250, 251, 253);
    doc.roundedRect(x, ty, w, h, 4, 4, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t.label.toUpperCase(), x + 8, ty + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(...(t.color ?? INK));
    doc.text(t.value, x + 8, ty + 35);
  });
  const rows = Math.ceil(tiles.length / perRow);
  return y + rows * (h + gap);
}

/** Build the whole report document. */
export function buildPerformancePdf(rep: PerformanceReport, company: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // ---- Title band ---------------------------------------------------------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 76, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Welder Performance & NDE Compliance", M, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(company || "Weld Tracker", M, 52);
  doc.setFontSize(9);
  doc.setTextColor(206, 214, 240);
  doc.text(`Period: ${rep.period_label}`, M, 66);
  doc.text(`Generated ${rep.generated_on}`, PAGE_W - M, 66, { align: "right" });

  let y = 100;

  // ---- Compliance headline ------------------------------------------------
  const allIn = rep.welders_below_spec === 0 && rep.rows.length > 0;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...(allIn ? GREEN : rep.welders_below_spec > 0 ? AMBER : INK));
  const headline = rep.rows.length === 0
    ? "No welds recorded for this period."
    : allIn
      ? `All ${rep.welders_in_spec} welders held at or above their assigned NDE spec.`
      : `${rep.welders_in_spec} of ${rep.rows.length} welders at or above spec — ${rep.welders_below_spec} need attention.`;
  doc.text(headline, M, y);
  y += 22;

  // ---- Executive summary tiles -------------------------------------------
  y = statTiles(doc, y, [
    { label: "Welders", value: n0(rep.rows.length) },
    { label: "Welds", value: n0(rep.total_welds) },
    { label: "Weld inches", value: n1(rep.total_inches) },
    { label: "NDE coverage", value: pctF(rep.fleet_rt_pct) },
    { label: "In spec", value: n0(rep.welders_in_spec), color: GREEN },
    { label: "Below spec", value: n0(rep.welders_below_spec), color: rep.welders_below_spec ? RED : GREEN },
    { label: "Rejects", value: n0(rep.total_rejects) },
    { label: "Reject rate", value: pctF(rep.fleet_reject_rate) },
  ]);
  y += 12;

  // ---- Fleet NDE coverage by spec ----------------------------------------
  if (rep.by_spec.length) {
    y = sectionTitle(doc, y, "NDE Coverage by Spec (fleet)");
    y = table(
      doc, M, y,
      [
        { header: "Spec", width: 90 },
        { header: "Welds", width: 80, align: "r" },
        { header: "Required", width: 90, align: "r" },
        { header: "Examined", width: 90, align: "r" },
        { header: "Actual %", width: 90, align: "r" },
        { header: "Status", width: CONTENT_W - 440 },
      ],
      rep.by_spec.map((s) => [
        s.spec,
        n0(s.population),
        n0(s.required),
        n0(s.examined),
        pct100(s.actual_pct),
        s.compliant
          ? { text: "Met", color: GREEN, bold: true }
          : { text: `Short ${s.shortfall}`, color: RED, bold: true },
      ]),
    );
    y += 20;
  }

  // ---- Per-welder performance --------------------------------------------
  y = sectionTitle(doc, y, "Per-Welder Performance");
  const verdict = (r: PerformanceRow): Cell =>
    r.specs.length === 0
      ? { text: "—", color: MUTED }
      : r.in_spec
        ? { text: "IN SPEC", color: GREEN, bold: true }
        : { text: "BELOW", color: RED, bold: true };
  y = table(
    doc, M, y,
    [
      { header: "Welder", width: 108 },
      { header: "Stamp", width: 42 },
      { header: "Welds", width: 42, align: "r" },
      { header: "Inches", width: 48, align: "r" },
      { header: "RT'd", width: 38, align: "r" },
      { header: "RT %", width: 42, align: "r" },
      { header: "Rej", width: 32, align: "r" },
      { header: "Rej %", width: 42, align: "r" },
      { header: "Spec", width: 66 },
      { header: "Cov %", width: 42, align: "r" },
      { header: "Verdict", width: CONTENT_W - 544 },
    ],
    rep.rows.map((r) => [
      r.name || "(unknown)",
      r.stamp,
      n0(r.weld_count),
      n1(r.weld_inches),
      n0(r.inspected),
      pctF(r.rt_pct),
      n0(r.rejects),
      { text: pctF(r.reject_rate), color: r.reject_rate > 0.05 ? RED : INK },
      r.assigned_specs || "—",
      r.specs.length ? pct100(r.min_actual_pct) : "—",
      verdict(r),
    ]),
  );
  y += 20;

  // ---- Below-spec detail (only if any) -----------------------------------
  const below = rep.rows.filter((r) => !r.in_spec && r.specs.length > 0);
  if (below.length) {
    y = sectionTitle(doc, y, "Below-Spec Detail — Examinations Owed");
    const detail: Cell[][] = [];
    for (const r of below) {
      for (const s of r.specs.filter((x) => !x.compliant)) {
        detail.push([
          r.name || r.stamp,
          r.stamp,
          s.spec,
          n0(s.population),
          n0(s.required),
          n0(s.examined),
          { text: n0(s.shortfall), color: RED, bold: true },
          pct100(s.actual_pct),
        ]);
      }
    }
    y = table(
      doc, M, y,
      [
        { header: "Welder", width: 120 },
        { header: "Stamp", width: 50 },
        { header: "Spec", width: 70 },
        { header: "Welds", width: 60, align: "r" },
        { header: "Required", width: 70, align: "r" },
        { header: "Examined", width: 70, align: "r" },
        { header: "Owed", width: 60, align: "r" },
        { header: "Actual %", width: CONTENT_W - 500, align: "r" },
      ],
      detail,
    );
    y += 20;
  }

  // ---- Per-work-order ----------------------------------------------------
  if (rep.work_orders.length) {
    y = sectionTitle(doc, y, "By Work Order");
    y = table(
      doc, M, y,
      [
        { header: "Work Order", width: 150 },
        { header: "Welds", width: 70, align: "r" },
        { header: "Inches", width: 80, align: "r" },
        { header: "RT'd", width: 60, align: "r" },
        { header: "RT %", width: 70, align: "r" },
        { header: "Rejects", width: 70, align: "r" },
        { header: "Reject %", width: CONTENT_W - 500, align: "r" },
      ],
      rep.work_orders.map((w) => [
        w.work_order,
        n0(w.weld_count),
        n1(w.weld_inches),
        n0(w.inspected),
        pctF(w.rt_pct),
        n0(w.rejects),
        { text: pctF(w.reject_rate), color: w.reject_rate > 0.05 ? RED : INK },
      ]),
    );
  }

  // ---- Footer on every page ----------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE);
    doc.line(M, h - 34, PAGE_W - M, h - 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${company || "Weld Tracker"} — Welder Performance & NDE Compliance`, M, h - 20);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, h - 20, { align: "right" });
  }

  return doc;
}

/** Generate and download the report PDF. */
export function downloadPerformancePdf(rep: PerformanceReport, company: string) {
  const doc = buildPerformancePdf(rep, company);
  const tag = (rep.period_label || "all").replace(/[^0-9A-Za-z]+/g, "-");
  doc.save(`welder-performance-${tag}.pdf`);
}

/** Open the report in a new tab (for print / Save-as-PDF from the viewer). */
export function openPerformancePdf(rep: PerformanceReport, company: string) {
  const doc = buildPerformancePdf(rep, company);
  doc.output("dataurlnewwindow");
}
