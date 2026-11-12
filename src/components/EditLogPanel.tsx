import { useState, useSyncExternalStore } from "react";
import { clearEdits, formatEdits, loadEdits, subscribeEdits, type EditEntry } from "../lib/editLog";

// useSyncExternalStore needs a stable snapshot, so the parsed list is cached until the log changes.
let cached: EditEntry[] | null = null;
subscribeEdits(() => (cached = null));
const snapshot = () => (cached ??= loadEdits());

/** The learner's own changes to cards, exportable as text for docs/ai-log.md. */
export default function EditLogPanel() {
  const edits = useSyncExternalStore(subscribeEdits, snapshot);
  const [status, setStatus] = useState<string | null>(null);
  if (edits.length === 0) return null;

  const text = formatEdits(edits);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Paste it into docs/ai-log.md and fill in the reasons.");
    } catch {
      setStatus("Couldn't copy automatically. Select the text below and copy it.");
    }
  }

  return (
    <section className="panel stack" aria-labelledby="edits-heading">
      <h2 id="edits-heading">Your edits ({edits.length})</h2>
      <p className="muted">Changes you made to cards, kept on this device. Copy them as text for the hand-edit log.</p>
      <div className="stack">
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy edit log
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            clearEdits();
            setStatus(null);
          }}
        >
          Clear edit log
        </button>
      </div>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      <details className="heat-details">
        <summary>Show the text</summary>
        <label className="field-label">
          Edit log text
          <textarea className="field" rows={6} readOnly value={text} />
        </label>
      </details>
    </section>
  );
}
