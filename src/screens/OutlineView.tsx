import { Link, useParams } from "react-router-dom";
import OutlineList from "../components/OutlineList";
import { loadOutline } from "../lib/storage";

/** Shows a saved outline from "Recent decks". that was saved before its cards were built. */
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
          <p className="notice">
            This outline was saved before its cards were built. Choose the same PDF again from Home to build the cards.
          </p>
        </>
      ) : (
        <>
          <h1>Saved outline</h1>
          <p className="notice" role="alert">
            We couldn&rsquo;t find that saved outline. It may have been cleared from this browser.
          </p>
        </>
      )}
    </main>
  );
}
