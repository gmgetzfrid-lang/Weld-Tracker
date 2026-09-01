// jspdf is loaded on demand — continuity exports are rare next to app startup.
import type { jsPDF } from "jspdf";
import { api, bytesToB64, errMsg } from "./api";
import { certLabel, notify } from "./components/ui";
import type { WelderContinuity } from "./types";

/**
 * Open an uploaded document (base64) with the OS default app. window.open and
 * download links are inert inside the WebView, so the backend writes the file
 * to the SENTRIX Reports folder and launches it.
 */
export function openBase64File(name: string, b64: string) {
  api.saveExport(name, b64, "open").catch((e) => notify("err", errMsg(e)));
}

/** A tiny table renderer with page breaks; returns the y after the table. */
function drawTable(
  doc: jsPDF,
  x: number,
  y: number,
  headers: string[],
  rows: string[][],
  widths: number[],
): number {
  const rowH = 18;
  const pageH = doc.internal.pageSize.getHeight();
  const header = () => {
    doc.setFillColor(10, 31, 107);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.rect(x, y, widths.reduce((a, b) => a + b, 0), rowH, "F");
    let cx = x;
    headers.forEach((h, i) => {
      doc.text(h, cx + 4, y + 12);
      cx += widths[i];
    });
    y += rowH;
    doc.setTextColor(20, 20, 20);
  };
  header();
  doc.setFontSize(9);
  rows.forEach((r, ri) => {
    if (y + rowH > pageH - 40) {
      doc.addPage();
      y = 50;
      header();
    }
    if (ri % 2 === 1) {
      doc.setFillColor(244, 246, 251);
      doc.rect(x, y, widths.reduce((a, b) => a + b, 0), rowH, "F");
    }
    let cx = x;
    r.forEach((cell, i) => {
      doc.text(String(cell ?? "").slice(0, 40), cx + 4, y + 12);
      cx += widths[i];
    });
    y += rowH;
  });
  if (rows.length === 0) {
    doc.setTextColor(140, 140, 140);
    doc.text("none", x + 4, y + 12);
    y += rowH;
    doc.setTextColor(20, 20, 20);
  }
  return y;
}

/** Build the continuity-log PDF document. */
async function buildContinuityPdf(c: WelderContinuity): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 40;
  let y = 50;
  doc.setFontSize(16);
  doc.setTextColor(10, 31, 107);
  doc.text("Welder Continuity Log", M, y);
  y += 22;
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(`Welder: ${c.name}    Stamp: ${c.stamp}`, M, y);
  y += 15;
  doc.setTextColor(110, 110, 110);
  doc.text(`Generated ${c.generated_on}`, M, y);
  y += 24;

  doc.setFontSize(12);
  doc.setTextColor(10, 31, 107);
  doc.text("Qualifications", M, y);
  y += 6;
  y = drawTable(
    doc, M, y + 6,
    ["Cert (alias)", "Process", "Continuity", "Qualified", "Last X-ray", "Continuous thru"],
    c.certs.map((ct) => [ct.alias, ct.process ?? "", certLabel(ct.status), ct.qualified_date ?? "", ct.last_activity ?? "", ct.continuous_through ?? ""]),
    [120, 70, 60, 75, 75, 95],
  );
  y += 24;

  doc.setFontSize(12);
  doc.setTextColor(10, 31, 107);
  doc.text("X-ray Continuity Events", M, y);
  y += 6;
  drawTable(
    doc, M, y + 6,
    ["Date", "Cert", "Process", "Weld #", "Work Order", "Drawing", "Result"],
    c.events.map((e) => [e.date, e.cert_alias, e.process ?? "", e.weld_number ?? "", e.work_order ?? "", e.drawing_no ?? "", e.result]),
    [70, 95, 60, 60, 85, 80, 60],
  );
  return doc;
}

/** Export a welder's continuity log to the SENTRIX Reports folder. */
export function continuityPdf(c: WelderContinuity) {
  buildContinuityPdf(c)
    .then((doc) =>
      api.saveExport(`continuity-${c.stamp}.pdf`, bytesToB64(new Uint8Array(doc.output("arraybuffer"))), "reveal"),
    )
    .then((p) => notify("ok", `Saved ${p}`))
    .catch((e) => notify("err", errMsg(e)));
}

/** Print the continuity log: generate the PDF and open it in the default
 * viewer, whose Print button does the rest. (The old print-window approach is
 * impossible here — window.open is blocked inside the hardened WebView.) */
export function printContinuity(c: WelderContinuity) {
  buildContinuityPdf(c)
    .then((doc) =>
      api.saveExport(`continuity-${c.stamp}.pdf`, bytesToB64(new Uint8Array(doc.output("arraybuffer"))), "open"),
    )
    .then((p) => notify("ok", `Opened ${p}`))
    .catch((e) => notify("err", errMsg(e)));
}
