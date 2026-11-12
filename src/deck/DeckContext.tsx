import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import sampleDeck from "../data/sample-deck.json";
import { AiFailure, type AiFailureKind } from "../lib/ai";
import {
  assembleDeck,
  buildSection,
  buildSectionQuiz,
  pool,
  SECTION_CONCURRENCY,
  withSectionQuiz,
  type BuildInput,
} from "../lib/deckBuild";
import { loadRecent, outlineKey, saveDeck } from "../lib/storage";
import type { Card, Deck, Question } from "../types/deck";

export type SectionStatus = "waiting" | "writing" | "checking" | "ready" | "failed";
export type QuizStatus = "pending" | "ready" | "failed";

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
  /** Quiz progress per section: pending while P4 runs, failed when it could not be built. */
  quizStatus: Record<string, QuizStatus>;
  /** Builds quiz questions for the given sections, or for every section that has none. */
  prepareQuiz: (sectionIds?: string[]) => void;
}

const DeckContext = createContext<DeckState | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [quizStatus, setQuizStatus] = useState<Record<string, QuizStatus>>({});

  // The running build, kept in refs so retries and late results always see the latest data.
  const deckRef = useRef<Deck | null>(null);
  const inputRef = useRef<BuildInput | null>(null);
  const cardsRef = useRef<Map<string, Card[]>>(new Map());
  const quizRef = useRef<Map<string, Question[]>>(new Map());
  const pendingQuiz = useRef(0);
  const runId = useRef(0);

  const applyDeck = useCallback((next: Deck | null | ((d: Deck | null) => Deck | null)) => {
    const value = typeof next === "function" ? next(deckRef.current) : next;
    deckRef.current = value;
    setDeck(value);
  }, []);

  const patchSection = useCallback((id: string, patch: Partial<SectionBuild>) => {
    setBuild((b) => (b ? { ...b, sections: b.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : b));
  }, []);

  /** Where a deck is saved: the running build's key, or the Recent entry for the same file. */
  const storageKey = useCallback((d: Deck): { key: string; from: number; to: number } | null => {
    const input = inputRef.current;
    if (input && input.hash === d.meta.file_hash) return { key: outlineKey(input.hash, input.from, input.to), from: input.from, to: input.to };
    const entry = loadRecent().find((r) => r.key.startsWith(`${d.meta.file_hash}_`));
    return entry ? { key: entry.key, from: entry.from, to: entry.to } : null;
  }, []);

  /** Saves the deck once it is complete: every section built and no quiz still being written. */
  const persistIfComplete = useCallback(() => {
    const d = deckRef.current;
    const input = inputRef.current;
    if (!d || pendingQuiz.current > 0) return;
    // Only a complete deck is cached, so reopening it never shows a half-built one.
    if (input && cardsRef.current.size !== input.sections.length) return;
    const where = storageKey(d);
    if (where) saveDeck(where.key, d, where.from, where.to);
  }, [storageKey]);

  const finishIfDone = useCallback(
    (myRun: number) => {
      if (!inputRef.current || runId.current !== myRun) return;
      setBuild((b) => {
        if (!b) return b;
        const stillBusy = b.sections.some((s) => s.status === "waiting" || s.status === "writing" || s.status === "checking");
        return { ...b, running: stillBusy };
      });
      persistIfComplete();
    },
    [persistIfComplete],
  );

  /** P4 for one section. A failure only marks the quiz for that section as failed; the deck still works. */
  const runQuiz = useCallback(
    async (sectionId: string, sectionCards: Card[], myRun: number) => {
      const section = deckRef.current?.sections.find((s) => s.id === sectionId) ?? inputRef.current?.sections.find((s) => s.id === sectionId);
      if (!section) return;
      const live = () => runId.current === myRun;
      pendingQuiz.current++;
      setQuizStatus((s) => ({ ...s, [sectionId]: "pending" }));
      try {
        const questions = await buildSectionQuiz(section, sectionCards);
        if (!live()) return;
        quizRef.current.set(sectionId, questions);
        applyDeck((d) => (d ? withSectionQuiz(d, sectionId, questions) : d));
        setQuizStatus((s) => ({ ...s, [sectionId]: "ready" }));
      } catch {
        if (!live()) return;
        setQuizStatus((s) => ({ ...s, [sectionId]: "failed" }));
      } finally {
        pendingQuiz.current--;
      }
      if (live()) persistIfComplete();
    },
    [applyDeck, persistIfComplete],
  );

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
          applyDeck(assembleDeck(input, cardsRef.current, quizRef.current));
          await runQuiz(sectionId, result.cards, myRun); // quiz questions are prepared while the learner studies
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
    [patchSection, finishIfDone, applyDeck, runQuiz],
  );

  const startBuild = useCallback(
    (input: BuildInput) => {
      const myRun = ++runId.current;
      inputRef.current = input;
      cardsRef.current = new Map();
      quizRef.current = new Map();
      pendingQuiz.current = 0;
      setQuizStatus({});
      applyDeck(null);
      setBuild({
        running: true,
        sections: input.sections.map((s) => ({ id: s.id, title: s.title, status: "waiting", cards: 0, flagged: 0, unchecked: false })),
      });
      void pool(input.sections, SECTION_CONCURRENCY, (s) => runSection(s.id, myRun));
    },
    [runSection, applyDeck],
  );

  const retrySection = useCallback(
    (sectionId: string) => {
      const myRun = runId.current;
      setBuild((b) => (b ? { ...b, running: true } : b));
      void runSection(sectionId, myRun);
    },
    [runSection],
  );

  const prepareQuiz = useCallback(
    (sectionIds?: string[]) => {
      const d = deckRef.current;
      if (!d) return;
      const withQuestions = new Set(d.quiz.map((q) => d.cards.find((c) => c.id === q.card_id)?.section_id));
      const targets = d.sections.filter((s) => (sectionIds ? sectionIds.includes(s.id) : !withQuestions.has(s.id)));
      const myRun = runId.current;
      void pool(targets, SECTION_CONCURRENCY, (s) =>
        runQuiz(s.id, d.cards.filter((c) => c.section_id === s.id), myRun),
      );
    },
    [runQuiz],
  );

  const openAndReset = useCallback(
    (d: Deck) => {
      runId.current++; // abandon any build in progress
      inputRef.current = null;
      cardsRef.current = new Map();
      quizRef.current = new Map();
      pendingQuiz.current = 0;
      setQuizStatus({});
      setBuild(null);
      applyDeck(d);
    },
    [applyDeck],
  );

  const value = useMemo<DeckState>(
    () => ({
      deck,
      openSampleDeck: () => openAndReset(sampleDeck as Deck),
      openDeck: openAndReset,
      pendingFile,
      setPendingFile,
      build,
      startBuild,
      retrySection,
      quizStatus,
      prepareQuiz,
    }),
    [deck, pendingFile, build, startBuild, retrySection, quizStatus, prepareQuiz, openAndReset],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckState {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("useDeck must be used inside DeckProvider");
  return ctx;
}
