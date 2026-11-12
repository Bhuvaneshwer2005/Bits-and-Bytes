import { useEffect } from "react";
import { useDeck } from "../deck/DeckContext";
import { preloadCheatSheet } from "../lib/cheatSheet";
import { verifiedCards } from "../lib/summary";

/** Downloads the one-page cheat sheet. Shows what is happening, and why it can't when there is nothing to put on it. */
export default function CheatSheetButton({ primary = false }: { primary?: boolean }) {
  const { deck, build, cheatSheet, downloadCheatSheet } = useDeck();
  const usable = deck ? verifiedCards(deck).length : 0;
  const ready = usable > 0;
  const building = build?.running ?? false;

  // Fetch the PDF code once the deck is complete, so the download also works if the connection drops afterwards.
  useEffect(() => {
    if (ready && !building) preloadCheatSheet();
  }, [ready, building]);

  return (
    <div className="stack">
      <button
        type="button"
        className={`btn${primary ? " btn--primary" : ""}`}
        aria-disabled={!ready || cheatSheet.busy}
        aria-describedby="cheat-note"
        onClick={() => {
          if (ready && !cheatSheet.busy) void downloadCheatSheet();
        }}
      >
        {cheatSheet.busy ? "Making your cheat sheet…" : "Download cheat sheet (PDF)"}
      </button>
      <p id="cheat-note" className={cheatSheet.error ? "notice" : "muted"} role="status">
        {cheatSheet.error ??
          cheatSheet.message ??
          (ready
            ? "One page, made from the cards your notes support."
            : "A cheat sheet needs at least one card that your notes support.")}
      </p>
    </div>
  );
}
