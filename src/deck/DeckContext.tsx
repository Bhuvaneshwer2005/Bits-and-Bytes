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
import { addEdit, type EditAction } from "../lib/editLog";
import { buildCardQuestion, regenerateCard as regenerateOne, removeCard, replaceCard, replaceCardQuestions } from "../lib/cardEdit";
import { sha256Hex } from "../lib/hash";
import { extractPdfText } from "../lib/pdf";
import { buildCheatSheet, saveFile } from "../lib/cheatSheet";
import { localDate } from "../lib/dates";
import { loadRecent, outlineKey, saveDeck } from "../lib/storage";
import { buildDeckSummary, currentSummary, summaryIsCurrent, withSummary } from "../lib/summary";
import type { Card, Deck, Question } from "../types/deck";

export type SectionStatus = "waiting" | "writing" | "checking" | "ready" | "failed";
export type QuizStatus = "pending" | "ready" | "failed";

export interface CheatSheetState {
  busy: boolean;
  /** What happened last time, for the screen reader and the eye. */
  message?: string;
  error?: string;
}

/** The most a download waits for the AI summary before it prints one written from the cards instead. */
const SUMMARY_WAIT_MS = 15_000;

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
  /** Progress of the cheat-sheet download. */
  cheatSheet: CheatSheetState;
  /** Makes the one-page PDF from the deck as it is now and hands it to the browser. */
  downloadCheatSheet: () => Promise<void>;
  /** True when the PDF's page text is in memory, which regenerating a card needs. */
  sourceReady: boolean;
  /** Reads the original PDF again (nothing is uploaded or stored) so cards can be regenerated. */
  attachSourcePdf: (file: File) => Promise<"ok" | "mismatch" | "unreadable">;
  /** Asks the AI for a better version of a card. Returns it for review; nothing changes until commitCard. */
  regenerateCard: (cardId: string, note: string) => Promise<Card>;
  /** Saves a changed card, logs it, and rebuilds its quiz question in the background. */
  commitCard: (card: Card, action: Exclude<EditAction, "delete">, note?: string) => void;
  deleteCard: (cardId: string) => void;
}

const DeckContext = createContext<DeckState | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [quizStatus, setQuizStatus] = useState<Record<string, QuizStatus>>({});
  const [cheatSheet, setCheatSheet] = useState<CheatSheetState>({ busy: false });
  const [sourceHash, setSourceHash] = useState<string | null>(null);

  // The running build, kept in refs so retries and late results always see the latest data.
  const deckRef = useRef<Deck | null>(null);
  const inputRef = useRef<BuildInput | null>(null);
  const cardsRef = useRef<Map<string, Card[]>>(new Map());
  const quizRef = useRef<Map<string, Question[]>>(new Map());
  const pendingQuiz = useRef(0);
  const runId = useRef(0);
  const sourceTexts = useRef<Map<number, string> | null>(null);
  /** P5 in flight, so a build that finishes and a download that starts share one call. */
  const summaryJob = useRef<Promise<void> | null>(null);
  const prepareSummaryRef = useRef<() => Promise<void>>(() => Promise.resolve());

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

  const saveCurrent = useCallback(() => {
    const d = deckRef.current;
    const where = d && storageKey(d);
    if (d && where) saveDeck(where.key, d, where.from, where.to);
  }, [storageKey]);

  /** Saves the deck once it is complete: every section built and no quiz still being written. Then writes its cheat-sheet summary. */
  const persistIfComplete = useCallback(() => {
    const d = deckRef.current;
    const input = inputRef.current;
    if (!d || pendingQuiz.current > 0) return;
    // Only a complete deck is cached, so reopening it never shows a half-built one.
    if (input && cardsRef.current.size !== input.sections.length) return;
    saveCurrent();
    void prepareSummaryRef.current();
  }, [saveCurrent]);

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
      sourceTexts.current = input.pageTexts;
      setSourceHash(input.hash);
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

  /** P5 for the deck as it is now, unless its summary already matches the cards. A failure leaves the deck as it was. */
  const prepareSummary = useCallback((): Promise<void> => {
    const d = deckRef.current;
    if (!d || d.meta.sample || summaryIsCurrent(d)) return Promise.resolve();
    if (summaryJob.current) return summaryJob.current;
    const myRun = runId.current;
    const job = (async () => {
      try {
        const summary = await buildDeckSummary(d);
        if (!summary || runId.current !== myRun) return;
        applyDeck((cur) => (cur && cur.meta.file_hash === d.meta.file_hash ? withSummary(cur, summary) : cur));
        saveCurrent();
      } catch {
        // Not fatal: the cheat sheet is then written from the cards directly.
      } finally {
        summaryJob.current = null;
      }
    })();
    summaryJob.current = job;
    return job;
  }, [applyDeck, saveCurrent]);
  prepareSummaryRef.current = prepareSummary;

  const downloadCheatSheet = useCallback(async () => {
    if (!deckRef.current) return;
    setCheatSheet({ busy: true });
    try {
      // Give the AI summary a moment, but never make the learner wait long for their PDF.
      await Promise.race([prepareSummary(), new Promise<void>((resolve) => setTimeout(resolve, SUMMARY_WAIT_MS))]);
      const latest = deckRef.current;
      if (!latest) return;
      const { summary, from } = currentSummary(latest);
      const file = await buildCheatSheet(latest, summary, localDate());
      saveFile(file);
      const notes = [
        "Cheat sheet saved as a PDF.",
        from === "cards" && !latest.meta.sample ? "It was written from your cards directly, because the AI summary wasn't available." : "",
        file.level > 0 ? "Some text was shortened to fit one page." : "",
      ];
      setCheatSheet({ busy: false, message: notes.filter(Boolean).join(" ") });
    } catch {
      setCheatSheet({ busy: false, error: "The cheat sheet couldn't be made. Check your connection and try again." });
    }
  }, [prepareSummary]);

  /** Keeps a running build's own copies in step with edits, so a late section cannot bring a deleted card back. */
  const syncBuildRefs = useCallback(() => {
    const d = deckRef.current;
    if (!d) return;
    for (const id of cardsRef.current.keys()) {
      const cards = d.cards.filter((c) => c.section_id === id);
      cardsRef.current.set(id, cards);
      if (quizRef.current.has(id)) {
        const ids = new Set(cards.map((c) => c.id));
        quizRef.current.set(id, d.quiz.filter((q) => ids.has(q.card_id)));
      }
    }
  }, []);

  const attachSourcePdf = useCallback(async (file: File): Promise<"ok" | "mismatch" | "unreadable"> => {
    const d = deckRef.current;
    if (!d) return "unreadable";
    try {
      const data = await file.arrayBuffer();
      if ((await sha256Hex(data)) !== d.meta.file_hash) return "mismatch";
      const { pages } = await extractPdfText(data);
      sourceTexts.current = new Map(pages.map((text, i) => [i + 1, text]));
      setSourceHash(d.meta.file_hash);
      return "ok";
    } catch {
      return "unreadable";
    }
  }, []);

  const regenerateCard = useCallback(async (cardId: string, note: string): Promise<Card> => {
    const d = deckRef.current;
    const card = d?.cards.find((c) => c.id === cardId);
    const section = d?.sections.find((s) => s.id === card?.section_id);
    const pageText = card ? sourceTexts.current?.get(card.source_page) : undefined;
    if (!d || !card || !section || !pageText) throw new AiFailure("unavailable");
    return regenerateOne(card, section, pageText, note);
  }, []);

  const commitCard = useCallback(
    (card: Card, action: Exclude<EditAction, "delete">, note?: string) => {
      const d = deckRef.current;
      const old = d?.cards.find((c) => c.id === card.id);
      if (!d || !old) return;
      addEdit({
        at: new Date().toISOString(),
        deck: d.meta.title,
        card_id: card.id,
        action,
        before: { front: old.front, back: old.back },
        after: { front: card.front, back: card.back },
        note: note?.trim() || undefined,
      });
      const myRun = runId.current;
      // The old question was about the old wording, so it goes now and a new one is written in the background.
      applyDeck((cur) => (cur ? replaceCardQuestions(replaceCard(cur, card), card.id, []) : cur));
      syncBuildRefs();
      saveCurrent();
      const section = deckRef.current?.sections.find((s) => s.id === card.section_id);
      const siblings = deckRef.current?.cards.filter((c) => c.section_id === card.section_id) ?? [];
      if (!section) return;
      void buildCardQuestion(card, section, siblings)
        .then((questions) => {
          if (runId.current !== myRun || questions.length === 0) return;
          applyDeck((cur) => (cur?.cards.some((c) => c.id === card.id) ? replaceCardQuestions(cur, card.id, questions) : cur));
          syncBuildRefs();
          saveCurrent();
        })
        .catch(() => undefined);
    },
    [applyDeck, saveCurrent, syncBuildRefs],
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      const d = deckRef.current;
      const old = d?.cards.find((c) => c.id === cardId);
      if (!d || !old) return;
      addEdit({
        at: new Date().toISOString(),
        deck: d.meta.title,
        card_id: cardId,
        action: "delete",
        before: { front: old.front, back: old.back },
      });
      applyDeck((cur) => (cur ? removeCard(cur, cardId) : cur));
      syncBuildRefs();
      saveCurrent();
    },
    [applyDeck, saveCurrent, syncBuildRefs],
  );

  const openAndReset = useCallback(
    (d: Deck) => {
      runId.current++; // abandon any build in progress
      summaryJob.current = null;
      sourceTexts.current = null;
      setSourceHash(null);
      setCheatSheet({ busy: false });
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
      cheatSheet,
      downloadCheatSheet,
      sourceReady: sourceHash !== null && sourceHash === deck?.meta.file_hash,
      attachSourcePdf,
      regenerateCard,
      commitCard,
      deleteCard,
    }),
    [deck, pendingFile, build, startBuild, retrySection, quizStatus, prepareQuiz, cheatSheet, downloadCheatSheet, sourceHash, attachSourcePdf, regenerateCard, commitCard, deleteCard, openAndReset],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckState {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("useDeck must be used inside DeckProvider");
  return ctx;
}
