import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDeck } from "../deck/DeckContext";

export default function DeckOverview() {
  const { deck, build, retrySection } = useDeck();
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
