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
  /** raster scale: 2 = crisp on letter-size, 3 for large-format */
  scale?: number;
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not rasterize the markup layer"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

/** Build the flattened PDF; returns base64 bytes. */
export async function buildWeldMapPdf(o: ExportOpts): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const scale = o.scale ?? 2;
  let pdf: InstanceType<typeof jsPDF> | null = null;
  const pages = o.pages.length ? o.pages : [1];
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
    const data = canvas.toDataURL("image/jpeg", 0.92);
    const orientation = W >= H ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: [W, H], orientation });
    else pdf.addPage([W, H], orientation);
    pdf.addImage(data, "JPEG", 0, 0, W, H);
  }
  return bytesToB64(new Uint8Array(pdf!.output("arraybuffer")));
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
