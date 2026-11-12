import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { APP_NAME } from "../config";
import { clipWords, fallbackSummary, verifiedCards, MAX_BULLET_WORDS } from "./summary";
import type { Deck, Summary } from "../types/deck";

// The one-page cheat-sheet PDF. It is built from deck.json only, in the browser, with no AI call, so it works offline
// and always matches the deck as it is now. Only verified cards (in_source) feed it.

export interface CheatSheetModel {
  title: string;
  note: string;
  sections: { title: string; bullets: string[] }[];
  terms: { term: string; meaning: string }[];
  footer: string;
}

/** The words that go on the page, before any shrinking. */
export function cheatSheetModel(deck: Deck, summary: Summary, date: string): CheatSheetModel {
  const hasCards = new Set(verifiedCards(deck).map((c) => c.section_id));
  const fallback = fallbackSummary(deck);
  const bulletsFor = (id: string) =>
    summary.bullets_by_section.find((b) => b.section_id === id)?.bullets ?? fallback.bullets_by_section.find((b) => b.section_id === id)?.bullets ?? [];

  const sections = deck.sections
    .filter((s) => hasCards.has(s.id))
    .map((s) => ({ title: s.title, bullets: bulletsFor(s.id) }))
    .filter((s) => s.bullets.length > 0);
  const terms = summary.key_terms.length > 0 ? summary.key_terms : fallback.key_terms;

  return {
    title: deck.meta.title,
    note: deck.meta.ai_generated
      ? "AI-generated from your notes. Check it against the source before you rely on it."
      : "Sample cheat sheet, written by hand for the demo.",
    sections,
    terms,
    footer: `Source: ${deck.meta.source_file} · made ${date} with ${APP_NAME}`,
  };
}

/** One step of shrinking. Steps run in this order: fewer key terms, then shorter bullets, then smaller type. */
export interface Level {
  terms: number;
  words: number;
  size: number;
}

export const LEVELS: Level[] = [
  { terms: 10, words: MAX_BULLET_WORDS, size: 10 },
  { terms: 6, words: MAX_BULLET_WORDS, size: 10 },
  { terms: 3, words: MAX_BULLET_WORDS, size: 10 },
  { terms: 0, words: MAX_BULLET_WORDS, size: 10 },
  { terms: 0, words: 14, size: 10 },
  { terms: 0, words: 10, size: 10 },
  { terms: 0, words: 10, size: 9 },
  { terms: 0, words: 10, size: 8 },
  { terms: 0, words: 8, size: 7 },
];

export function applyLevel(model: CheatSheetModel, level: Level): CheatSheetModel {
  return {
    ...model,
    sections: model.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => clipWords(b, level.words)) })),
    terms: model.terms.slice(0, level.terms),
  };
}

const INK = "#111827";
const MUTED = "#4b5563";
const ACCENT = "#1d4ed8";
const RULE = "#d1d5db";

export function docDefinition(model: CheatSheetModel, size: number): TDocumentDefinitions {
  const body = size;
  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 46],
    language: "en-US",
    // Not "tagged": pdfmake marks the file as tagged but writes an empty structure tree, which assistive tech can read as "no content".
    displayTitle: true,
    info: { title: `${model.title}: cheat sheet`, subject: "One-page cheat sheet made from study cards", creator: APP_NAME },
    defaultStyle: { font: "Roboto", fontSize: body, color: INK, lineHeight: 1.2 },
    footer: () => ({ text: model.footer, fontSize: 7.5, color: MUTED, margin: [40, 12, 40, 0] }),
    content: [
      { text: model.title, fontSize: body + 9, bold: true, margin: [0, 0, 0, 3] },
      { text: model.note, fontSize: Math.max(7, body - 1.5), color: MUTED, margin: [0, 0, 0, body] },
      ...model.sections.flatMap((s) => [
        { text: s.title, fontSize: body + 2, bold: true, color: ACCENT, margin: [0, 0, 0, 3] as [number, number, number, number] },
        { ul: s.bullets, margin: [4, 0, 0, body * 0.9] as [number, number, number, number] },
      ]),
      ...(model.terms.length === 0
        ? []
        : [
            { text: "Key terms", fontSize: body + 2, bold: true, color: ACCENT, margin: [0, 2, 0, 3] as [number, number, number, number] },
            {
              table: { widths: ["30%", "*"], body: model.terms.map((t) => [{ text: t.term, bold: true }, t.meaning]) },
              layout: {
                hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
                vLineWidth: () => 0,
                hLineColor: () => RULE,
                paddingTop: () => 2,
                paddingBottom: () => 2,
                paddingLeft: () => 0,
                paddingRight: () => 6,
              },
            },
          ]),
    ],
  };
}

type PdfMake = typeof import("pdfmake/build/pdfmake");

let loaded: Promise<PdfMake> | null = null;

/** Loads pdfmake and its fonts the first time they are needed, so the rest of the app doesn't pay for them. */
function loadPdfMake(): Promise<PdfMake> {
  loaded ??= (async () => {
    const [lib, fonts] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
    const pdfMake = ((lib as unknown as { default?: PdfMake }).default ?? lib) as PdfMake;
    pdfMake.addVirtualFileSystem(((fonts as unknown as { default?: object }).default ?? fonts) as Parameters<PdfMake["addVirtualFileSystem"]>[0]);
    return pdfMake;
  })();
  loaded.catch(() => (loaded = null)); // a failed load (offline, say) can be tried again
  return loaded;
}

/** Starts loading the PDF code in the background. Failures are ignored: the download tries again when asked. */
export function preloadCheatSheet(): void {
  void loadPdfMake().catch(() => undefined);
}

export interface CheatSheetFile {
  blob: Blob;
  fileName: string;
  /** Which shrinking step it took to fit on one page (0 means none). */
  level: number;
}

type Render = (def: TDocumentDefinitions) => Promise<{ blob: Blob; pages: number }>;

async function renderWithPdfMake(def: TDocumentDefinitions): Promise<{ blob: Blob; pages: number }> {
  const pdfMake = await loadPdfMake();
  const blob = await pdfMake.createPdf(def).getBlob();
  const { countPdfPages } = await import("./pdf");
  return { blob, pages: await countPdfPages(await blob.arrayBuffer()) };
}

/** Tries each level in turn until the sheet is exactly one page. `render` can be swapped for tests. */
export async function renderOnePage(model: CheatSheetModel, render: Render = renderWithPdfMake): Promise<{ blob: Blob; level: number }> {
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    const { blob, pages } = await render(docDefinition(applyLevel(model, level), level.size));
    if (pages <= 1) return { blob, level: i };
  }
  throw new Error("The cheat sheet would not fit on one page.");
}

export const cheatSheetFileName = (title: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "notes"}-cheat-sheet.pdf`;

export async function buildCheatSheet(deck: Deck, summary: Summary, date: string, render?: Render): Promise<CheatSheetFile> {
  const model = cheatSheetModel(deck, summary, date);
  if (model.sections.length === 0) throw new Error("There are no verified cards to put on a cheat sheet.");
  const { blob, level } = await renderOnePage(model, render);
  return { blob, level, fileName: cheatSheetFileName(deck.meta.title) };
}

/** Hands the PDF to the browser as a download. */
export function saveFile(file: CheatSheetFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
