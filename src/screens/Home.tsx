import { useNavigate } from "react-router-dom";
import { APP_NAME, DEFAULT_DAILY_GOAL } from "../config";
import { useDeck } from "../deck/DeckContext";

export default function Home() {
  const navigate = useNavigate();
  const { openSampleDeck } = useDeck();

  function tryTheSampleDeck() {
    openSampleDeck();
    navigate("/deck");
  }

  // Static placeholders until the daily log exists (B5).
  const cardsToday = 0;

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <span className="brand">{APP_NAME}</span>
        <span className="pill" aria-label="Current streak: 0 days">
          0-day streak
        </span>
      </header>

      <section className="card-box stack" aria-labelledby="goal-heading">
        <p id="goal-heading">
          Today: <strong>{cardsToday} / {DEFAULT_DAILY_GOAL}</strong> cards
        </p>
        <div
          className="meter"
          role="progressbar"
          aria-label="Daily goal progress"
          aria-valuemin={0}
          aria-valuemax={DEFAULT_DAILY_GOAL}
          aria-valuenow={cardsToday}
        >
          <span style={{ width: `${(cardsToday / DEFAULT_DAILY_GOAL) * 100}%` }} />
        </div>
      </section>

      <section className="dropzone" aria-labelledby="drop-heading">
        <h1 id="drop-heading">Turn your notes into spoken flashcards</h1>
        <p>Drop your notes PDF here</p>
        <button type="button" className="btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>
          Choose a PDF
        </button>
        <p className="muted">PDF upload arrives in the next update. Try the sample deck for now.</p>
      </section>

      <button type="button" className="btn btn--primary" onClick={tryTheSampleDeck}>
        Try the sample deck
      </button>

      <p className="muted">
        When upload is on, your PDF text is sent to an AI model to build cards. The free Gemini tier may use it to improve
        Google's products. Nothing is stored on our servers.
      </p>

      <section className="stack" aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent decks</h2>
        <div className="card-box">
          <p>No decks yet.</p>
          <p className="muted">Build your first one from a PDF, or open the sample deck.</p>
        </div>
      </section>
    </main>
  );
}
