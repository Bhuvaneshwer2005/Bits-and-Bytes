import type { Card } from "../types/deck";

// Which card is on screen, which come next, and what the learner has seen. Pure functions, so they are easy to test.

export interface PlayerState {
  /** Card ids in the order they will be shown. "Again" adds a card back at the end. */
  queue: string[];
  /** Position in the queue. Equal to queue.length once the deck is finished. */
  index: number;
  /** Cards that have been shown at least once. The quiz is built from these. */
  viewed: string[];
  /** Cards marked "Again" at least once. They go back for review. */
  again: string[];
  /** Every card id the queue has ever been built from, to spot cards that arrive later. */
  known: string[];
}

export function initialState(cards: Card[]): PlayerState {
  const ids = cards.map((c) => c.id);
  return { queue: ids, index: 0, viewed: [], again: [], known: ids };
}

/** Brings a saved state in line with the current cards: drops deleted cards, appends new ones to the end. */
export function syncWithCards(state: PlayerState, cards: Card[]): PlayerState {
  const ids = new Set(cards.map((c) => c.id));
  const known = new Set(state.known);
  const fresh = cards.filter((c) => !known.has(c.id)).map((c) => c.id);

  // Remove deleted cards from the queue while keeping the learner on the same card.
  const kept: string[] = [];
  let index = 0;
  state.queue.forEach((id, i) => {
    if (i < state.index && ids.has(id)) index++;
    if (ids.has(id)) kept.push(id);
  });

  const queue = [...kept, ...fresh];
  return {
    queue,
    index: Math.min(index, queue.length),
    viewed: state.viewed.filter((id) => ids.has(id)),
    again: state.again.filter((id) => ids.has(id)),
    known: [...new Set([...state.known.filter((id) => ids.has(id)), ...fresh])],
  };
}

export const isFinished = (s: PlayerState) => s.index >= s.queue.length;
export const currentId = (s: PlayerState): string | null => (isFinished(s) ? null : s.queue[s.index]);

export function markViewed(s: PlayerState, id: string): PlayerState {
  return s.viewed.includes(id) ? s : { ...s, viewed: [...s.viewed, id] };
}

export function next(s: PlayerState): PlayerState {
  return { ...s, index: Math.min(s.index + 1, s.queue.length) };
}

export function previous(s: PlayerState): PlayerState {
  return { ...s, index: Math.max(s.index - 1, 0) };
}

/** "Got it": move on. */
export const gotIt = next;

/** "Again": the card comes back at the end of the queue, and is remembered for review. */
export function again(s: PlayerState): PlayerState {
  const id = currentId(s);
  if (id === null) return s;
  return {
    ...s,
    queue: [...s.queue, id],
    index: s.index + 1,
    again: s.again.includes(id) ? s.again : [...s.again, id],
  };
}

/** Start the deck over. What was viewed stays viewed; "Again" marks are cleared. */
export function restart(s: PlayerState, cards: Card[]): PlayerState {
  const ids = cards.map((c) => c.id);
  return { queue: ids, index: 0, viewed: s.viewed, again: [], known: ids };
}

/** Which repeat of the card this is (0 for the first time). */
export function repeatCount(s: PlayerState): number {
  const id = currentId(s);
  return id === null ? 0 : s.queue.slice(0, s.index).filter((x) => x === id).length;
}
