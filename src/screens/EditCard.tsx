import { useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useDeck } from "../deck/DeckContext";
import { AiFailure } from "../lib/ai";
import { applyManualEdit, BACK_MAX, editProblem, FRONT_MAX, isChanged, NOTE_MAX } from "../lib/cardEdit";
import type { Card } from "../types/deck";

export default function EditCard() {
  const { deck } = useDeck();
  const { cardId } = useParams();
  const card = deck?.cards.find((c) => c.id === cardId);
  if (!deck || !card) return <Navigate to="/deck" replace />;
  return <Editor key={card.id} card={card} />;
}

function Editor({ card }: { card: Card }) {
  const { sourceReady, attachSourcePdf, regenerateCard, commitCard, deleteCard } = useDeck();
  const navigate = useNavigate();
  const pickerRef = useRef<HTMLInputElement>(null);

  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [note, setNote] = useState("");
  /** A rewrite the learner has not saved yet. Its source and checks travel with it. */
  const [candidate, setCandidate] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const shown = candidate ?? card;
  const changed = candidate !== null || isChanged(card, front, back);

  function save() {
    const problem = editProblem(front, back);
    if (problem) return setError(problem);
    if (candidate) commitCard(applyManualEdit(candidate, front, back), "regenerate", note);
    else if (isChanged(card, front, back)) commitCard(applyManualEdit(card, front, back), "edit");
    navigate(-1);
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await regenerateCard(card.id, note);
      setCandidate(next);
      setFront(next.front);
      setBack(next.back);
      setMessage(
        next.in_source
          ? "New version ready. It checks out against your notes. Save to keep it."
          : "New version ready, but it needs checking against your notes. Save to keep it, or Cancel.",
      );
    } catch (e) {
      const kind = e instanceof AiFailure ? e.kind : "unavailable";
      setError(
        kind === "rate_limited"
          ? "The AI hit its free limit. Try again in a minute."
          : kind === "invalid"
            ? "The AI gave an answer we couldn't use. Try again, or edit the card by hand."
            : "The AI isn't available right now. You can still edit the card by hand.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    const result = await attachSourcePdf(file);
    setBusy(false);
    if (result === "ok") setMessage("PDF read. You can regenerate now.");
    else setError(result === "mismatch" ? "That isn't the PDF this deck was made from." : "That PDF couldn't be read.");
  }

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <button type="button" className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        {(card.edited_by_user || candidate) && <span className="pill pill--accent">Edited by you</span>}
      </header>

      <h1>Edit card</h1>

      <label className="field-label">
        Front
        <textarea className="field" rows={2} value={front} maxLength={FRONT_MAX + 50} onChange={(e) => setFront(e.target.value)} />
      </label>
      <label className="field-label">
        Back
        <textarea className="field" rows={4} value={back} maxLength={BACK_MAX + 50} onChange={(e) => setBack(e.target.value)} />
      </label>

      <section className="card-box stack" aria-label="Source">
        <span className="muted">
          Source: page {shown.source_page} · &ldquo;{shown.source_quote}&rdquo;
        </span>
        <span>
          {shown.in_source
            ? "Supported by your notes."
            : `Needs checking: ${shown.check_reason ?? "the page may not fully support this answer."}`}
        </span>
        {!candidate && isChanged(card, front, back) && (
          <span className="muted">You changed the wording. The source check was for the original wording.</span>
        )}
      </section>

      <section className="card-box stack" aria-labelledby="regen-heading">
        <h2 id="regen-heading">Regenerate with AI</h2>
        {sourceReady ? (
          <>
            <label className="field-label">
              What is wrong? (optional)
              <input className="field" type="text" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="button" className="btn" aria-disabled={busy} onClick={() => !busy && void regenerate()}>
              {busy ? "Working…" : "Regenerate"}
            </button>
          </>
        ) : (
          <>
            <p className="muted">To rewrite a card the AI needs the page again. Choose the PDF this deck came from. It stays on your device.</p>
            <input
              ref={pickerRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button type="button" className="btn" aria-disabled={busy} onClick={() => !busy && pickerRef.current?.click()}>
              {busy ? "Reading…" : "Choose the original PDF"}
            </button>
          </>
        )}
      </section>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <div className="stack">
        <button type="button" className="btn btn--primary" aria-disabled={!changed} onClick={() => changed && save()}>
          Save
        </button>
        {confirmDelete ? (
          <section className="card-box stack" role="alert">
            <p>Delete this card? Its quiz question goes too. This can&rsquo;t be undone.</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                deleteCard(card.id);
                navigate(-1);
              }}
            >
              Yes, delete the card
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </section>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
            Delete card
          </button>
        )}
      </div>
    </main>
  );
}
