import { Link, useParams } from "react-router-dom";
import OutlineList from "../components/OutlineList";
import { loadOutline } from "../lib/storage";

/** Shows a saved outline from "Recent decks". Cards are added in a later step. */
export default function OutlineView() {
  const { key = "" } = useParams();
  const outline = loadOutline(key);

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/" className="btn">
          Home
        </Link>
      </header>
      {outline ? (
        <>
          <div className="stack">
            <h1>{outline.file_name}</h1>
            <p className="muted">
              Pages {outline.from}-{outline.to} · {outline.sections.length} sections
            </p>
          </div>
          <OutlineList sections={outline.sections} />
          <p className="notice">Cards, source checks and the quiz arrive in the next updates. Your outline is saved.</p>
        </>
      ) : (
        <p className="notice" role="alert">
          We couldn't find that saved outline. It may have been cleared from this browser.
        </p>
      )}
    </main>
  );
}
