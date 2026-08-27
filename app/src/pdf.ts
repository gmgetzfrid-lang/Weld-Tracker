import * as pdfjsLib from "pdfjs-dist";
// Bundle the worker with Vite so it runs fully offline inside the app.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjsLib.PDFDocumentProxy;

/** Decode a base64 string (as delivered from the Rust side) to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Read a File/Blob to a base64 string for sending to the Rust side. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function loadPdf(bytes: Uint8Array): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}
