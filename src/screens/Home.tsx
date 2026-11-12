import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import Heatmap from "../components/Heatmap";
import { StreakPill, StreakStatus, useStreak } from "../components/StreakPill";
import { APP_NAME } from "../config";
import { useDeck } from "../deck/DeckContext";
import { GOALS, type Goal } from "../lib/activity";
import { setDailyGoal } from "../lib/activityStorage";
import { checkFileBasics, PROBLEM_MESSAGES } from "../lib/limits";
import { loadDeck, loadRecent } from "../lib/storage";

export default function Home() {
  const navigate = useNavigate();
  const { openSampleDeck, openDeck, setPendingFile } = useDeck();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const recent = loadRecent();
  const { activity, progress } = useStreak();
  const goal = activity.goal;
  const cardsToday = progress.cards;

  function tryTheSampleDeck() {
    openSampleDeck();
    navigate("/deck");
  }

  function openRecent(key: string, hasDeck: boolean | undefined) {
    const saved = hasDeck ? loadDeck(key) : null;
    if (saved) {
      openDeck(saved);
      navigate("/deck");
    } else {
      navigate(`/outline/${key}`);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = checkFileBasics(file);
    if (problem) {
      setError(PROBLEM_MESSAGES[problem]);
      return;
    }
    setError(null);
    setPendingFile(file);
    navigate("/build");
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <span className="brand">{APP_NAME}</span>
        <StreakPill />
      </header>

      <section className="card-box stack" aria-labelledby="goal-heading">
        <p id="goal-heading">
          Today: <strong>{cardsToday} / {goal}</strong> cards
        </p>
        <div
          className="meter"
          role="progressbar"
          aria-label="Daily goal progress"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(cardsToday, goal)}
        >
          <span style={{ width: `${Math.min(100, (cardsToday / goal) * 100)}%` }} />
        </div>
        <StreakStatus />
        <label className="field-label">
          Daily goal
          <select className="field" value={goal} onChange={(e) => setDailyGoal(Number(e.target.value) as Goal)}>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {g} cards a day
              </option>
            ))}
          </select>
        </label>
        <details className="heat-details">
          <summary>Your last 5 weeks</summary>
          <Heatmap heading={false} />
        </details>
      </section>

      <section
        className={`dropzone${dragging ? " dropzone--active" : ""}`}
        aria-labelledby="drop-heading"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h1 id="drop-heading">Turn your notes into spoken flashcards</h1>
        <p>Drop your notes PDF here</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          Choose a PDF
        </button>
        <p className="muted">PDF up to 20 MB and 60 pages, with selectable text.</p>
      </section>

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="btn btn--primary" onClick={tryTheSampleDeck}>
        Try the sample deck
      </button>
      <a className="btn" href="/sample-thermodynamics-notes.pdf" download>
        Download a sample PDF
      </a>

      <p className="muted">
        Your PDF stays on your device. Only its text is sent to a free AI service to write the cards, and that service may keep or
        use it under its own terms, so don&rsquo;t upload anything private. We don&rsquo;t store your PDF or its text.
      </p>

      <section className="stack" aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent decks</h2>
        {recent.length === 0 ? (
          <div className="card-box">
            <p>No decks yet.</p>
            <p className="muted">Build your first one from a PDF, or open the sample deck.</p>
          </div>
        ) : (
          <ul className="list">
            {recent.map((r) => (
              <li key={r.key}>
                <button type="button" className="list-item list-button" onClick={() => openRecent(r.key, r.has_deck)}>
                  <span className="recent-text">
                    <span className="recent-name">{r.file_name}</span>
                    <span className="muted">
                      pages {r.from}-{r.to} · {r.sections} sections{r.has_deck ? " · ready" : " · outline only"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
