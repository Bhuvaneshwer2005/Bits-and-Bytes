// The hand-edit list. It lives in this browser only, and can be exported as text to paste into docs/ai-log.md.

const KEY = "sd.edits.v1";
const MAX_ENTRIES = 200;

export type EditAction = "edit" | "regenerate" | "delete";

export interface EditEntry {
  at: string;
  deck: string;
  card_id: string;
  action: EditAction;
  before: { front: string; back: string };
  after?: { front: string; back: string };
  /** What the learner told the AI, for a regenerate. */
  note?: string;
}

export function loadEdits(): EditEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as EditEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: EditEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // storage blocked or full: the list just isn't kept
  }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();

export function subscribeEdits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addEdit(entry: EditEntry): void {
  save([...loadEdits(), entry]);
}

export function clearEdits(): void {
  save([]);
}

const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const VERB: Record<EditAction, string> = { edit: "Edited by hand", regenerate: "Regenerated with AI, then saved", delete: "Deleted" };

/** Rows in the same shape as docs/ai-log.md: date, step, prompt, what the AI produced, what we changed by hand. */
export function formatEdits(entries: EditEntry[]): string {
  return entries
    .map((e) => {
      const date = e.at.slice(0, 10);
      const produced = e.action === "regenerate" && e.after ? `New card: "${cell(e.after.front)}" / "${cell(e.after.back)}"` : "n/a";
      const changed =
        e.action === "delete"
          ? `Deleted card ${e.card_id} ("${cell(e.before.front)}")`
          : `${VERB[e.action]} ${e.card_id}: "${cell(e.before.front)}" / "${cell(e.before.back)}" became "${cell(e.after?.front ?? "")}" / "${cell(e.after?.back ?? "")}"` +
            (e.note ? `. Note to the AI: "${cell(e.note)}"` : "");
      return `| ${date} | Card edit (${cell(e.deck)}) | ${e.action === "regenerate" ? "P6" : "n/a"} | ${produced} | ${changed}. Why: (fill in) |`;
    })
    .join("\n");
}
