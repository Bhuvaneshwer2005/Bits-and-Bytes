import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDeck } from "../deck/DeckContext";
import { localDate } from "../lib/dates";
import { deckStateKey, loadPlayerState } from "../lib/playerStorage";
import { scoreQuiz, selectQuestions, type QuizItem } from "../lib/quiz";
import { saveQuizResult } from "../lib/quizStorage";
import type { Deck } from "../types/deck";

export default function Quiz() {
  const { deck } = useDeck();
  if (!deck) return <Navigate to="/" replace />;
  return <QuizScreen deck={deck} />;
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/deck" className="btn">
          Back
        </Link>
      </header>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function QuizScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const { build, quizStatus, prepareQuiz } = useDeck();
  const stateKey = deckStateKey(deck.meta.file_hash);
  const viewed = useMemo(() => loadPlayerState(stateKey)?.viewed ?? [], [stateKey]);
  const seed = useMemo(() => `${deck.meta.file_hash}|${Date.now()}`, [deck.meta.file_hash]);

  // The questions are chosen once, so a late-arriving section can't change the quiz in the middle of it.
  const [items, setItems] = useState<QuizItem[] | null>(null);
  useEffect(() => {
    if (items) return;
    const chosen = selectQuestions(deck, viewed, seed);
    if (chosen.length > 0) setItems(chosen);
  }, [deck, viewed, seed, items]);

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const nextRef = useRef<HTMLButtonElement>(null);

  const item = items?.[index];
  const answered = chosen !== null;

  function choose(i: number) {
    if (!item || answered) return;
    setChosen(i);
    setAnswers((a) => ({ ...a, [item.question.id]: i }));
  }

  // Number keys pick an option, so the quiz works from a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (item && !answered && n >= 1 && n <= item.options.length) choose(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // After answering, move focus to Next so keyboard and screen-reader users land on the feedback.
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  function next() {
    if (!items) return;
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setChosen(null);
      return;
    }
    const result = scoreQuiz(items, answers, deck.cards, deck.sections, localDate());
    saveQuizResult(stateKey, result);
    navigate("/results", { replace: true });
  }

  if (!items || !item) {
    const preparing = Object.values(quizStatus).includes("pending") || build?.running;
    if (viewed.length === 0) {
      return (
        <Message title="Quiz">
          <p className="card-box">The quiz covers the cards you've seen. Go through some cards first.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate("/player")}>
            Start listening
          </button>
        </Message>
      );
    }
    if (preparing) {
      return (
        <Message title="Quiz">
          <p className="card-box" role="status">
            Your questions are still being prepared. They'll appear here in a moment.
          </p>
        </Message>
      );
    }
    if (deck.quiz.length === 0) {
      return (
        <Message title="Quiz">
          <p className="card-box">This deck has no quiz questions yet.</p>
          {deck.meta.sample ? null : (
            <button type="button" className="btn btn--primary" onClick={() => prepareQuiz()}>
              Prepare quiz
            </button>
          )}
        </Message>
      );
    }
    return (
      <Message title="Quiz">
        <p className="card-box">None of the cards you've seen have questions yet. Go through more cards first.</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate("/player")}>
          Keep studying
        </button>
      </Message>
    );
  }

  const right = chosen === item.answerIndex;
  const total = items.length;

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/deck" className="btn">
          Back
        </Link>
        <span className="muted" role="status">
          Question {index + 1} of {total}
        </span>
      </header>

      <div
        className="meter"
        role="progressbar"
        aria-label="Quiz progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index + (answered ? 1 : 0)}
      >
        <span style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} />
      </div>

      <h1 className="quiz-prompt">{item.question.prompt}</h1>

      <ul className="list" aria-label="Answer options">
        {item.options.map((option, i) => {
          const isRight = answered && i === item.answerIndex;
          const isWrongPick = answered && i === chosen && i !== item.answerIndex;
          return (
            <li key={i}>
              <button
                type="button"
                className={`opt${isRight ? " opt--right" : ""}${isWrongPick ? " opt--wrong" : ""}`}
                aria-disabled={answered}
                onClick={() => choose(i)}
              >
                <span className="opt-key" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="opt-text">{option}</span>
                {isRight && <span className="opt-badge">&#10003; Correct answer</span>}
                {isWrongPick && <span className="opt-badge">&#10007; Your answer</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {answered && (
        <section className="card-box stack feedback" role="status" aria-live="polite">
          <strong>{right ? "✓ Correct" : "✗ Not quite"}</strong>
          <span>{item.question.explanation}</span>
          <span className="muted">Source: page {item.question.source_page}</span>
        </section>
      )}

      {answered && (
        <button ref={nextRef} type="button" className="btn btn--primary" onClick={next}>
          {index + 1 < total ? "Next" : "See results"}
        </button>
      )}
    </main>
  );
}
