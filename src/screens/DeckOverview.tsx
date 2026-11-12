import { Link, Navigate, useNavigate } from "react-router-dom";
import CheatSheetButton from "../components/CheatSheetButton";
import { useDeck } from "../deck/DeckContext";

export default function DeckOverview() {
  const { deck, build, retrySection, quizStatus, prepareQuiz } = useDeck();
  const navigate = useNavigate();

  if (!deck) {
    // Opened while the first section is still being written.
    if (build?.running) {
      return (
        <main id="main" className="screen">
          <header className="topbar">
            <Link to="/" className="btn">
              Home
            </Link>
          </header>
          <h1>Building your deck</h1>
          <p role="status" className="muted">
            Your first section will appear here in a moment.
          </p>
        </main>
      );
    }
    return <Navigate to="/" replace />;
  }

  const flagged = deck.cards.filter((c) => !c.in_source);
  const minutes = Math.max(1, Math.round(deck.cards.length * 0.5));
  const total = build?.sections.length ?? deck.sections.length;
  const readyCount = build ? build.sections.filter((s) => s.status === "ready").length : total;
  const stillBuilding = build?.running ?? false;
  const failed = build?.sections.filter((s) => s.status === "failed") ?? [];
  const quizPending = Object.values(quizStatus).includes("pending");
  const quizFailed = Object.entries(quizStatus)
    .filter(([, status]) => status === "failed")
    .map(([id]) => id);

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/" className="btn">
          Home
        </Link>
        <span className="pill">{deck.meta.ai_generated ? "AI-generated" : "Sample deck"}</span>
      </header>

      <div className="stack">
        <h1>{deck.meta.title}</h1>
        <p className="muted">
          {deck.cards.length} cards · {deck.sections.length} {deck.sections.length === 1 ? "section" : "sections"} · about {minutes} min
        </p>
      </div>

      {deck.meta.ai_generated && (
        <p className="notice">AI-generated: check cards against your notes. The source page is shown on every card.</p>
      )}

      {stillBuilding && (
        <p className="notice" role="status">
          Still building: {readyCount} of {total} sections ready. New cards appear here as they finish.
        </p>
      )}

      {flagged.length > 0 && (
        <p className="notice" role="status">
          {flagged.length} {flagged.length === 1 ? "card needs" : "cards need"} checking against your notes
        </p>
      )}

      <ul className="list" aria-label="Sections">
        {deck.sections.map((s) => {
          const cards = deck.cards.filter((c) => c.section_id === s.id);
          const flaggedHere = cards.filter((c) => !c.in_source).length;
          return (
            <li key={s.id} className="list-item">
              <span>
                {s.id.replace("s", "")} · {s.title} ({cards.length})
              </span>
              {flaggedHere > 0 && <span className="muted">{flaggedHere} to check</span>}
            </li>
          );
        })}
        {failed.map((s) => (
          <li key={s.id} className="list-item">
            <span>
              {s.title}
              <span className="muted"> · {s.error}</span>
            </span>
            <button type="button" className="btn" onClick={() => retrySection(s.id)}>
              Try again
            </button>
          </li>
        ))}
      </ul>

      {flagged.length > 0 && (
        <section className="stack" aria-labelledby="check-heading">
          <h2 id="check-heading">Cards to check</h2>
          <ul className="list">
            {flagged.map((c) => (
              <li key={c.id} className="card-box stack">
                <strong>{c.front}</strong>
                <span>{c.back}</span>
                <span className="muted">
                  Page {c.source_page} · {c.check_reason ?? "Could not be confirmed from the page."}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quizPending && (
        <p className="muted" role="status">
          Preparing quiz questions…
        </p>
      )}
      {!quizPending && quizFailed.length > 0 && (
        <div className="stack">
          <p className="notice" role="status">
            Quiz questions couldn't be built for {quizFailed.length} {quizFailed.length === 1 ? "section" : "sections"}.
          </p>
          <button type="button" className="btn" onClick={() => prepareQuiz(quizFailed)}>
            Try the quiz questions again
          </button>
        </div>
      )}
      {!quizPending && quizFailed.length === 0 && deck.quiz.length === 0 && !deck.meta.sample && !stillBuilding && (
        <div className="stack">
          <p className="muted">This deck has no quiz questions yet.</p>
          <button type="button" className="btn" onClick={() => prepareQuiz()}>
            Prepare quiz
          </button>
        </div>
      )}

      <div className="stack">
        <button type="button" className="btn btn--primary" onClick={() => navigate("/player")}>
          Start listening
        </button>
        <button type="button" className="btn" onClick={() => navigate("/quiz")}>
          Take the quiz{deck.quiz.length > 0 ? ` (${deck.quiz.length} questions)` : ""}
        </button>
        <CheatSheetButton />
      </div>
    </main>
  );
}
