export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 60;
/** Most pages sent to the AI in one go. */
export const MAX_USED_PAGES = 40;
/** Below this many characters per page on average, the PDF is treated as scanned. */
const MIN_AVG_CHARS_PER_PAGE = 25;

export type FileProblem = "not_pdf" | "too_big" | "too_many_pages" | "unreadable" | "scanned";

export const PROBLEM_MESSAGES: Record<FileProblem, string> = {
  not_pdf: "That file isn't a PDF. Please choose a PDF of your notes.",
  too_big: "That PDF is over 20 MB. Try a smaller file or split it.",
  too_many_pages: "That PDF has more than 60 pages. Split it into chapters and try one.",
  unreadable: "We couldn't open that PDF. It may be damaged or password protected.",
  scanned: "We couldn't read text in this PDF. It looks scanned. Try a PDF with selectable text.",
};

/** Quick check before reading the file. */
export function checkFileBasics(file: { name: string; type: string; size: number }): FileProblem | null {
  const looksPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksPdf) return "not_pdf";
  if (file.size > MAX_BYTES) return "too_big";
  return null;
}

export function looksScanned(pageTexts: string[]): boolean {
  if (pageTexts.length === 0) return true;
  const total = pageTexts.reduce((n, t) => n + t.trim().length, 0);
  return total / pageTexts.length < MIN_AVG_CHARS_PER_PAGE;
}
