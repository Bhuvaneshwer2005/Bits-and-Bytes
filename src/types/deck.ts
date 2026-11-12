// Canonical deck shape. Mirrors Part C of docs/route-and-prompt-sheet.md.

export type CardType = "term" | "qa" | "cloze";
export type QuestionType = "mcq" | "tf" | "cloze";

export interface DeckMeta {
  title: string;
  source_file: string;
  file_hash: string;
  pages: number;
  model: string;
  created: string;
  ai_generated: boolean;
  /** True for the bundled, hand-written demo deck. */
  sample?: boolean;
}

export interface Section {
  id: string;
  title: string;
  page_range: [number, number];
  summary: string;
}

export interface Card {
  id: string;
  section_id: string;
  type: CardType;
  front: string;
  back: string;
  say_front: string;
  say_back: string;
  source_page: number;
  source_quote: string;
  /** Set by code: the quote was found in that page's text. */
  quote_found: boolean;
  /** Set by the grounding check (forced false when quote_found is false). */
  in_source: boolean;
  check_reason?: string;
  edited_by_user: boolean;
}

export interface Question {
  id: string;
  card_id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  answer_index: number;
  explanation: string;
  source_page: number;
}

export interface Summary {
  bullets_by_section: { section_id: string; bullets: string[] }[];
  key_terms: { term: string; meaning: string }[];
  /** Fingerprint of the verified cards this summary was written from. A different one means the cards changed since. */
  basis?: string;
}

export interface Deck {
  meta: DeckMeta;
  sections: Section[];
  cards: Card[];
  quiz: Question[];
  summary: Summary;
}
