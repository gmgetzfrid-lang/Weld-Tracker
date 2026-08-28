import { jsPDF } from "jspdf";
import type { WelderContinuity } from "./types";

const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Open an uploaded cert document (base64) to view it, or download if blocked. */
export function openBase64File(name: string, b64: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const blob = new Blob([base64ToBytes(b64) as BlobPart], { type: MIME[ext] ?? "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

/** Export a welder's continuity log as a downloadable PDF file. */
export function continuityPdf(c: WelderContinuity) {
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
    ["Cert (alias)", "Process", "Status", "Qualified", "Last X-ray", "Continuous thru"],
    c.certs.map((ct) => [ct.alias, ct.process ?? "", ct.status, ct.qualified_date ?? "", ct.last_activity ?? "", ct.continuous_through ?? ""]),
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

  doc.save(`continuity-${c.stamp}.pdf`);
}

/** Open a print-friendly window of the continuity log (also Save-as-PDF from there). */
export function printContinuity(c: WelderContinuity) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
  const certRows = c.certs
    .map(
      (ct) => `<tr><td>${esc(ct.alias)}</td><td>${esc(ct.process)}</td>
      <td class="${ct.status === "Active" ? "ok" : "off"}">${esc(ct.status)}</td>
      <td>${esc(ct.qualified_date)}</td><td>${esc(ct.last_activity)}</td><td>${esc(ct.continuous_through)}</td></tr>`,
    )
    .join("");
  const eventRows = c.events
    .map(
      (e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.cert_alias)}</td><td>${esc(e.process)}</td>
      <td>${esc(e.weld_number)}</td><td>${esc(e.work_order)}</td><td>${esc(e.drawing_no)}</td><td>${esc(e.result)}</td></tr>`,
    )
    .join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Continuity Log — ${esc(c.stamp)}</title>
    <style>
      body{font-family:Segoe UI,Arial,sans-serif;color:#16233b;margin:32px;}
      h1{color:#0a1f6b;font-size:20px;margin:0 0 4px;}
      .sub{color:#64748b;margin:0 0 18px;font-size:13px;}
      h2{color:#0a1f6b;font-size:14px;margin:22px 0 6px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;}
      th{background:#0a1f6b;color:#fff;}
      tr:nth-child(even) td{background:#f4f6fb;}
      .ok{color:#16a34a;font-weight:700;} .off{color:#b91c1c;font-weight:700;}
      @media print{.noprint{display:none;}}
    </style></head><body>
    <button class="noprint" onclick="window.print()" style="float:right;padding:8px 14px;">Print</button>
    <h1>Welder Continuity Log</h1>
    <p class="sub">${esc(c.name)} · Stamp ${esc(c.stamp)} · generated ${esc(c.generated_on)}</p>
    <h2>Qualifications</h2>
    <table><thead><tr><th>Cert (alias)</th><th>Process</th><th>Status</th><th>Qualified</th><th>Last X-ray</th><th>Continuous thru</th></tr></thead>
    <tbody>${certRows || '<tr><td colspan="6">none</td></tr>'}</tbody></table>
    <h2>X-ray Continuity Events</h2>
    <table><thead><tr><th>Date</th><th>Cert</th><th>Process</th><th>Weld #</th><th>Work Order</th><th>Drawing</th><th>Result</th></tr></thead>
    <tbody>${eventRows || '<tr><td colspan="7">none</td></tr>'}</tbody></table>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
