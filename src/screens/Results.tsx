import { Link, Navigate, useNavigate } from "react-router-dom";
import Heatmap from "../components/Heatmap";
import { StreakPill, StreakStatus } from "../components/StreakPill";
import { useDeck } from "../deck/DeckContext";
import { reviewState } from "../lib/playerState";
import { deckStateKey, loadPlayerState, savePlayerState } from "../lib/playerStorage";
import { loadQuizResult } from "../lib/quizStorage";

export default function Results() {
  const { deck } = useDeck();
  const navigate = useNavigate();
  if (!deck) return <Navigate to="/" replace />;

  const stateKey = deckStateKey(deck.meta.file_hash);
  const result = loadQuizResult(stateKey);

  if (!result) {
    return (
      <main id="main" className="screen">
        <header className="topbar">
          <Link to="/deck" className="btn">
            Back
          </Link>
        </header>
        <h1>Results</h1>
        <p className="card-box">You haven't taken a quiz on this deck yet.</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate("/quiz")}>
          Take the quiz
        </button>
      </main>
    );
  }

  const percent = result.total === 0 ? 0 : Math.round((result.score / result.total) * 100);
  const weakest = result.by_section.find((s) => s.section_id === result.weakest_section_id);
  const missed = result.missed_card_ids.length;

  function reviewMissed() {
    if (!deck) return;
    savePlayerState(stateKey, reviewState(loadPlayerState(stateKey), deck.cards, result!.missed_card_ids));
    navigate("/player");
  }

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/deck" className="btn">
          Back
        </Link>
        <StreakPill />
      </header>

      <div className="stack">
        <h1>Results</h1>
        <p className="score" aria-label={`You scored ${result.score} out of ${result.total}, ${percent} percent`}>
          {result.score} / {result.total}
        </p>
        <p className="muted">{percent}% correct</p>
      </div>

      {weakest ? (
        <p className="card-box">
          Weakest section: <strong>{weakest.title}</strong> ({weakest.correct} of {weakest.total} right)
        </p>
      ) : (
        <p className="card-box">Every answer was right. Nice work.</p>
      )}

      <section className="stack" aria-labelledby="by-section">
        <h2 id="by-section">By section</h2>
        <ul className="list">
          {result.by_section.map((s) => (
            <li key={s.section_id} className="list-item">
              <span>{s.title}</span>
              <span className="muted">
                {s.correct} of {s.total}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-box stack" aria-label="Your streak">
        <StreakStatus />
      </section>

      <Heatmap />

      <div className="stack">
        {missed > 0 && (
          <button type="button" className="btn btn--primary" onClick={reviewMissed}>
            Review {missed} missed {missed === 1 ? "card" : "cards"}
          </button>
        )}
        <button type="button" className={`btn${missed === 0 ? " btn--primary" : ""}`} onClick={() => navigate("/quiz")}>
          Retake the quiz
        </button>
        <button type="button" className="btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>
          Download cheat sheet · coming soon
        </button>
        <button type="button" className="btn" onClick={() => navigate("/deck")}>
          Back to deck
        </button>
      </div>
    </main>
  );
}
