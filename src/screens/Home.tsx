import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME, DEFAULT_DAILY_GOAL } from "../config";
import { useDeck } from "../deck/DeckContext";
import { checkFileBasics, PROBLEM_MESSAGES } from "../lib/limits";
import { loadDeck, loadRecent } from "../lib/storage";

export default function Home() {
  const navigate = useNavigate();
  const { openSampleDeck, openDeck, setPendingFile } = useDeck();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const recent = loadRecent();

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

      <p className="muted">
        Your PDF text is read in your browser, then sent to an AI model to build cards. The free Gemini tier may use it to
        improve Google's products. We don't store your PDF.
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
                  <span>
                    {r.file_name}
                    <span className="muted"> · pages {r.from}-{r.to} · {r.sections} sections{r.has_deck ? " · ready" : " · outline only"}</span>
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
