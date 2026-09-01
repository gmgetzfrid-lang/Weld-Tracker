import type * as pdfjsTypes from "pdfjs-dist";

export type PdfDoc = pdfjsTypes.PDFDocumentProxy;

// pdf.js is ~a third of the app bundle but only the annotator/wizard need it.
// Loading it on demand (once, then cached) keeps app startup fast; the worker
// is still bundled by Vite so everything runs fully offline.
let pdfjsOnce: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs(): Promise<typeof import("pdfjs-dist")> {
  pdfjsOnce ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsOnce;
}

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
  const lib = await pdfjs();
  return lib.getDocument({ data: bytes }).promise;
}
