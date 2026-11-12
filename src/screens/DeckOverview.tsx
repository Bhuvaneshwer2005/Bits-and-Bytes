import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDeck } from "../deck/DeckContext";

export default function DeckOverview() {
  const { deck } = useDeck();
  const navigate = useNavigate();

  if (!deck) return <Navigate to="/" replace />;

  const flagged = deck.cards.filter((c) => !c.in_source);
  const minutes = Math.max(1, Math.round(deck.cards.length * 0.5));

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
          {deck.cards.length} cards · {deck.sections.length} sections · about {minutes} min
        </p>
      </div>

      {deck.meta.ai_generated && (
        <p className="notice">AI-generated: check cards against your notes. The source page is shown on every card.</p>
      )}

      {flagged.length > 0 && (
        <p className="notice" role="status">
          {flagged.length} {flagged.length === 1 ? "card needs" : "cards need"} checking against your notes
        </p>
      )}

      <ul className="list" aria-label="Sections">
        {deck.sections.map((s, i) => {
          const cards = deck.cards.filter((c) => c.section_id === s.id);
          const flaggedHere = cards.filter((c) => !c.in_source).length;
          return (
            <li key={s.id} className="list-item">
              <span>
                {i + 1} · {s.title} ({cards.length})
              </span>
              {flaggedHere > 0 && <span className="muted">{flaggedHere} to check</span>}
            </li>
          );
        })}
      </ul>

      <div className="stack">
        <button type="button" className="btn btn--primary" onClick={() => navigate("/player")}>
          Start listening
        </button>
        <button type="button" className="btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>
          Cheat sheet (PDF) · coming soon
        </button>
      </div>
    </main>
  );
}
