import { AiFailure, callAI } from "./ai";
import { applyChecks, contextAround, markUnchecked, parseChecks, parseRegeneratedCard, spokenFallback } from "./cards";
import { buildQuiz, QuizError } from "./quiz";
import type { Card, Deck, Question, Section } from "../types/deck";

// Changing one card: a hand edit, a P6 rewrite (re-checked by code and P3), its quiz question, and removing it.

export const FRONT_MAX = 200;
export const BACK_MAX = 400;
export const NOTE_MAX = 300;

type CallAI = typeof callAI;

/** A plain-language problem with the text, or null when it is fine to save. */
export function editProblem(front: string, back: string): string | null {
  const f = front.trim();
  const b = back.trim();
  if (!f) return "The front can't be empty.";
  if (!b) return "The back can't be empty.";
  if (f.length > FRONT_MAX) return `The front is too long (most ${FRONT_MAX} characters).`;
  if (b.length > BACK_MAX) return `The back is too long (most ${BACK_MAX} characters).`;
  return null;
}

/** The card with the learner's wording. Spoken text follows the new wording; the source and its checks stay as they were. */
export function applyManualEdit(card: Card, front: string, back: string): Card {
  return {
    ...card,
    front: front.trim(),
    back: back.trim(),
    say_front: spokenFallback(front),
    say_back: spokenFallback(back),
    edited_by_user: true,
  };
}

/** True when saving would change the visible text. */
export const isChanged = (card: Card, front: string, back: string) => card.front !== front.trim() || card.back !== back.trim();

/**
 * P6 rewrite of one card, then the same checks every card gets: the quote is looked up in the page text in code,
 * and P3 compares the new back with the quote. A checker that can't run leaves the card flagged, never trusted.
 */
export async function regenerateCard(card: Card, section: Section, pageText: string, note: string, call: CallAI = callAI): Promise<Card> {
  const { value } = await call(
    "P6",
    {
      card: { id: card.id, type: card.type, front: card.front, back: card.back },
      section: { id: section.id, title: section.title },
      page: { page: card.source_page, text: pageText },
      note: note.trim().slice(0, NOTE_MAX),
    },
    (json) => parseRegeneratedCard(json, card, pageText),
  );
  if (!value.quote_found) return value;
  try {
    const { value: checks } = await call(
      "P3",
      {
        cards: [
          {
            id: value.id,
            front: value.front,
            back: value.back,
            source_page: value.source_page,
            source_quote: value.source_quote,
            context: contextAround(value.source_quote, pageText),
          },
        ],
      },
      parseChecks,
    );
    return applyChecks([value], checks)[0];
  } catch (e) {
    if (e instanceof AiFailure) return markUnchecked([value])[0];
    throw e;
  }
}

/**
 * P4 for one card. It is shown the card with a few supported neighbours (the quiz prompt wants at least two cards)
 * and only the question about this card is kept. Returns nothing when the card isn't supported or no question is usable.
 */
export async function buildCardQuestion(card: Card, section: Section, sectionCards: Card[], call: CallAI = callAI): Promise<Question[]> {
  if (!card.in_source) return [];
  const usable = [card, ...sectionCards.filter((c) => c.in_source && c.id !== card.id).slice(0, 3)];
  if (usable.length < 2) return [];
  try {
    const { value } = await call(
      "P4",
      {
        section: { id: section.id, title: section.title },
        cards: usable.map((c) => ({ id: c.id, front: c.front, back: c.back, source_page: c.source_page })),
        count: 2,
      },
      (json) => buildQuiz(json, usable, section.id),
    );
    const mine = value.find((q) => q.card_id === card.id);
    return mine ? [{ ...mine, id: `${card.id}q1` }] : [];
  } catch (e) {
    if (e instanceof QuizError) return [];
    throw e;
  }
}

const sectionRank = (deck: Deck) => {
  const order = new Map(deck.sections.map((s, i) => [s.id, i]));
  const cardSection = new Map(deck.cards.map((c) => [c.id, c.section_id]));
  return (q: Question) => order.get(cardSection.get(q.card_id) ?? "") ?? 99;
};

/** Swaps one card into the deck, keeping its place. */
export const replaceCard = (deck: Deck, card: Card): Deck => ({ ...deck, cards: deck.cards.map((c) => (c.id === card.id ? card : c)) });

/** Drops a card and every quiz question about it. */
export const removeCard = (deck: Deck, cardId: string): Deck => ({
  ...deck,
  cards: deck.cards.filter((c) => c.id !== cardId),
  quiz: deck.quiz.filter((q) => q.card_id !== cardId),
});

/** Replaces the questions about one card (none, if `questions` is empty). */
export function replaceCardQuestions(deck: Deck, cardId: string, questions: Question[]): Deck {
  const rank = sectionRank(deck);
  const quiz = [...deck.quiz.filter((q) => q.card_id !== cardId), ...questions].sort((a, b) => rank(a) - rank(b));
  return { ...deck, quiz };
}
