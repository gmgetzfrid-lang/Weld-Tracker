// Flatten a controlled sheet into a PDF: the rasterized drawing pages with
// weld bubbles, the legend stamp and every markup drawn on top — the "final
// weld map" that goes in the quality package.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, bytesToB64 } from "../api";
import type { Weld } from "../types";
import type { PdfDoc } from "../pdf";
import type { PM } from "./model";
import { ExportOverlay, type LegendPlace } from "./render";

export interface ExportOpts {
  doc: PdfDoc | null;
  /** absolute page numbers to include */
  pages: number[];
  /** blank-grid size when there is no PDF */
  blank: { w: number; h: number };
  welds: Weld[];
  markups: PM[];
  /** the legend stamp — printed on every page at the same place and size */
  legend: { place: LegendPlace; totals: [string, number][]; on: boolean };
  fileName: string;
  mode: "reveal" | "open";
  /** raster scale: 2 = crisp on letter-size, 3 for large-format and print */
  scale?: number;
}

/** One flattened page: a JPEG data URL plus the page size in points. */
export interface FlatPage { data: string; W: number; H: number }

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not rasterize the markup layer"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

/** Rasterise every requested page with its bubbles, legend and markups. */
export async function renderWeldMapPages(o: ExportOpts): Promise<FlatPage[]> {
  const scale = o.scale ?? 2;
  const pages = o.pages.length ? o.pages : [1];
  const out: FlatPage[] = [];
  for (const n of pages) {
    let W: number, H: number;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    if (o.doc) {
      const page = await o.doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      W = vp1.width; H = vp1.height;
      const vp = page.getViewport({ scale });
      canvas.width = vp.width; canvas.height = vp.height;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } else {
      W = o.blank.w; H = o.blank.h;
      canvas.width = W * scale; canvas.height = H * scale;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const pageWelds = o.welds.filter((w) => (w.bubble_page ?? 1) === n && w.bubble_x != null);
    const pageMarkups = o.markups.filter((m) => m.page === n);
    const svg = renderToStaticMarkup(
      createElement(ExportOverlay, {
        welds: pageWelds, markups: pageMarkups, W, H,
        legend: o.legend.on ? { place: o.legend.place, totals: o.legend.totals, title: "WELD MAP LEGEND" } : null,
      }),
    ).replace("<svg ", `<svg width="${W * scale}" height="${H * scale}" `);
    // The overlay's own width/height are W×H; the injected attributes come
    // first so they win when the browser parses the element.
    const img = await svgToImage(svg);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out.push({ data: canvas.toDataURL("image/jpeg", 0.92), W, H });
  }
  return out;
}

/** Build the flattened PDF; returns base64 bytes. */
export async function buildWeldMapPdf(o: ExportOpts): Promise<string> {
  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const { data, W, H } of await renderWeldMapPages(o)) {
    const orientation = W >= H ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: [W, H], orientation });
    else pdf.addPage([W, H], orientation);
    pdf.addImage(data, "JPEG", 0, 0, W, H);
  }
  return bytesToB64(new Uint8Array(pdf!.output("arraybuffer")));
}

/**
 * The print document: one sheet per page, each flattened image scaled to fit
 * the paper the user picks (letter, 11×17, …) with its aspect kept, so the
 * legend lands at the same relative place and size as on screen.
 */
export function printDocumentHtml(pages: FlatPage[], title: string): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const body = pages.map((pg) => `<div class="pg ${pg.W >= pg.H ? "land" : "port"}"><img src="${pg.data}" alt=""></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { margin: 6mm; }
@page land { size: landscape; }
@page port { size: portrait; }
html, body { margin: 0; padding: 0; background: #fff; }
.pg { width: 100vw; height: 100vh; box-sizing: border-box; overflow: hidden; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; }
.pg.land { page: land; }
.pg.port { page: port; }
.pg:last-child { break-after: auto; page-break-after: auto; }
.pg img { width: 100%; height: 100%; object-fit: contain; }
</style></head><body>${body}</body></html>`;
}

/**
 * Flatten and print: opens the system print dialog with one sheet per page.
 * The pages are rendered into a hidden frame so only the weld map prints,
 * never the app around it. Resolves once the dialog has been shown.
 */
export async function printWeldMap(o: ExportOpts): Promise<void> {
  const pages = await renderWeldMapPages({ ...o, scale: o.scale ?? 3 });
  const html = printDocumentHtml(pages, o.fileName.replace(/\.pdf$/i, ""));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame); };
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("could not prepare the print sheet"));
      frame.srcdoc = html;
    });
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error("could not prepare the print sheet");
    await Promise.all(Array.from(doc.images).map((img) => img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })));
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    // Browsers that never fire afterprint still get tidied up.
    setTimeout(cleanup, 120_000);
  } catch (e) {
    cleanup();
    throw e;
  }
}

export async function exportWeldMap(o: ExportOpts): Promise<string> {
  const b64 = await buildWeldMapPdf(o);
  return api.saveExport(o.fileName, b64, o.mode);
}

/** Flatten and file the map under the work order's quality package. */
export async function attachWeldMap(o: ExportOpts, workOrder: string, note: string): Promise<number> {
  const b64 = await buildWeldMapPdf(o);
  return api.addWoFile(workOrder, "Weld Map", o.fileName, "application/pdf", b64, note);
}
