import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_PAGES, type FileProblem } from "./limits";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfError extends Error {
  constructor(public problem: FileProblem) {
    super(problem);
  }
}

export interface ExtractedPdf {
  /** Text of each page; index 0 is page 1. */
  pages: string[];
}

/** Reads the text of every page in the browser. Nothing is uploaded. */
export async function extractPdfText(
  data: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedPdf> {
  // pdf.js transfers the buffer to its worker, so give it a copy.
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    throw new PdfError("unreadable");
  }

  if (doc.numPages > MAX_PAGES) {
    void task.destroy();
    throw new PdfError("too_many_pages");
  }

  const pages: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push(text.replace(/\s+/g, " ").trim());
      onProgress?.(n, doc.numPages);
    }
  } catch {
    throw new PdfError("unreadable");
  } finally {
    void task.destroy();
  }
  return { pages };
}
