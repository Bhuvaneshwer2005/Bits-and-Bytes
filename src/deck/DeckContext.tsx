import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import sampleDeck from "../data/sample-deck.json";
import type { Deck } from "../types/deck";

interface DeckState {
  deck: Deck | null;
  openSampleDeck: () => void;
  setDeck: (deck: Deck | null) => void;
}

const DeckContext = createContext<DeckState | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [deck, setDeck] = useState<Deck | null>(null);

  const value = useMemo<DeckState>(
    () => ({
      deck,
      setDeck,
      openSampleDeck: () => setDeck(sampleDeck as Deck),
    }),
    [deck],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckState {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("useDeck must be used inside DeckProvider");
  return ctx;
}
