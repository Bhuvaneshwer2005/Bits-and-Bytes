import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import sampleDeck from "../data/sample-deck.json";
import { AiFailure, type AiFailureKind } from "../lib/ai";
import { assembleDeck, buildSection, pool, SECTION_CONCURRENCY, type BuildInput } from "../lib/deckBuild";
import { outlineKey, saveDeck } from "../lib/storage";
import type { Card, Deck } from "../types/deck";

export type SectionStatus = "waiting" | "writing" | "checking" | "ready" | "failed";

export interface SectionBuild {
  id: string;
  title: string;
  status: SectionStatus;
  error?: string;
  cards: number;
  flagged: number;
  /** The grounding check could not run for this section. */
  unchecked: boolean;
}

export interface BuildState {
  running: boolean;
  sections: SectionBuild[];
}

/** How long a failed section waits before its one automatic retry. */
const AUTO_RETRY_DELAY_MS = 20_000;

const FAILURE_TEXT: Record<AiFailureKind, string> = {
  rate_limited: "The AI hit its free limit. Try this section again in a minute.",
  not_configured: "The AI isn't set up on this server.",
  unavailable: "The AI was busy.",
  invalid: "The AI gave an answer we couldn't use.",
};

interface DeckState {
  deck: Deck | null;
  openSampleDeck: () => void;
  openDeck: (deck: Deck) => void;
  /** The PDF the user just chose. Held in memory only; never stored or uploaded. */
  pendingFile: File | null;
  setPendingFile: (file: File | null) => void;
  /** Progress of the deck being built, or null when none is. */
  build: BuildState | null;
  /** Starts building cards for every section. Safe to leave the screen: it keeps running here. */
  startBuild: (input: BuildInput) => void;
  retrySection: (sectionId: string) => void;
}

const DeckContext = createContext<DeckState | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);

  // The running build, kept in refs so retries and late results always see the latest data.
  const inputRef = useRef<BuildInput | null>(null);
  const cardsRef = useRef<Map<string, Card[]>>(new Map());
  const runId = useRef(0);

  const patchSection = useCallback((id: string, patch: Partial<SectionBuild>) => {
    setBuild((b) => (b ? { ...b, sections: b.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : b));
  }, []);

  const finishIfDone = useCallback((myRun: number) => {
    const input = inputRef.current;
    if (!input || runId.current !== myRun) return;
    const ready = cardsRef.current.size;
    setBuild((b) => {
      if (!b) return b;
      const stillBusy = b.sections.some((s) => s.status === "waiting" || s.status === "writing" || s.status === "checking");
      return { ...b, running: stillBusy };
    });
    // Only a complete deck is cached, so reopening it never shows a half-built one.
    if (ready === input.sections.length) {
      const full = assembleDeck(input, cardsRef.current);
      saveDeck(outlineKey(input.hash, input.from, input.to), full, input.from, input.to);
    }
  }, []);

  const runSection = useCallback(
    async (sectionId: string, myRun: number) => {
      const input = inputRef.current;
      const section = input?.sections.find((s) => s.id === sectionId);
      if (!input || !section) return;
      const live = () => runId.current === myRun;

      // One automatic second try after a pause: free-tier limits usually clear within a minute.
      for (let attempt = 0; attempt < 2; attempt++) {
        patchSection(sectionId, { status: "writing", error: undefined });
        try {
          const result = await buildSection(section, input.pageTexts, (stage) => live() && patchSection(sectionId, { status: stage }));
          if (!live()) return;
          cardsRef.current.set(sectionId, result.cards);
          patchSection(sectionId, {
            status: "ready",
            cards: result.cards.length,
            flagged: result.cards.filter((c) => !c.in_source).length,
            unchecked: result.unchecked,
          });
          setDeck(assembleDeck(input, cardsRef.current));
          break;
        } catch (e) {
          if (!live()) return;
          const kind: AiFailureKind = e instanceof AiFailure ? e.kind : "unavailable";
          if (attempt === 0 && kind !== "not_configured") {
            patchSection(sectionId, { status: "waiting" });
            await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_DELAY_MS));
            if (!live()) return;
            continue;
          }
          patchSection(sectionId, { status: "failed", error: FAILURE_TEXT[kind] });
          break;
        }
      }
      finishIfDone(myRun);
    },
    [patchSection, finishIfDone],
  );

  const startBuild = useCallback(
    (input: BuildInput) => {
      const myRun = ++runId.current;
      inputRef.current = input;
      cardsRef.current = new Map();
      setDeck(null);
      setBuild({
        running: true,
        sections: input.sections.map((s) => ({ id: s.id, title: s.title, status: "waiting", cards: 0, flagged: 0, unchecked: false })),
      });
      void pool(input.sections, SECTION_CONCURRENCY, (s) => runSection(s.id, myRun));
    },
    [runSection],
  );

  const retrySection = useCallback(
    (sectionId: string) => {
      const myRun = runId.current;
      setBuild((b) => (b ? { ...b, running: true } : b));
      void runSection(sectionId, myRun);
    },
    [runSection],
  );

  const value = useMemo<DeckState>(
    () => ({
      deck,
      openSampleDeck: () => {
        runId.current++; // abandon any build in progress
        setBuild(null);
        setDeck(sampleDeck as Deck);
      },
      openDeck: (d) => {
        runId.current++;
        setBuild(null);
        setDeck(d);
      },
      pendingFile,
      setPendingFile,
      build,
      startBuild,
      retrySection,
    }),
    [deck, pendingFile, build, startBuild, retrySection],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckState {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("useDeck must be used inside DeckProvider");
  return ctx;
}
