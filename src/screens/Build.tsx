import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import OutlineList from "../components/OutlineList";
import { useDeck } from "../deck/DeckContext";
import { AiFailure, callAI, type AiFailureKind } from "../lib/ai";
import { sha256Hex } from "../lib/hash";
import { looksScanned, MAX_USED_PAGES, PROBLEM_MESSAGES } from "../lib/limits";
import { normalizeOutline } from "../lib/outline";
import { extractPdfText, PdfError } from "../lib/pdf";
import { loadOutline, outlineKey, saveOutline } from "../lib/storage";
import type { Section } from "../types/deck";

type Phase = "reading" | "range" | "outline" | "done" | "error";

const AI_MESSAGES: Record<AiFailureKind, string> = {
  rate_limited: "The AI has hit its free limit for the moment. Try again in a minute, or open the sample deck.",
  not_configured: "The AI isn't set up on this server yet. You can still open the sample deck.",
  unavailable: "The AI is busy right now. Try again, or open the sample deck.",
  invalid: "The AI gave an answer we couldn't use. Try again, or open the sample deck.",
};

interface Problem {
  message: string;
  /** True when retrying the AI step could help. */
  retryable: boolean;
}

export default function Build() {
  const { pendingFile, openSampleDeck } = useDeck();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("reading");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pages, setPages] = useState<string[]>([]);
  const [hash, setHash] = useState("");
  const [fromText, setFromText] = useState("1");
  const [toText, setToText] = useState("1");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [outline, setOutline] = useState<Section[] | null>(null);
  const [reused, setReused] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failedAt, setFailedAt] = useState<"reading" | "outline">("reading");
  const started = useRef(false);

  useEffect(() => {
    if (!pendingFile || started.current) return;
    started.current = true;
    void readPdf(pendingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pendingFile) return <Navigate to="/" replace />;

  async function readPdf(file: File) {
    try {
      const data = await file.arrayBuffer();
      setHash(await sha256Hex(data));
      const { pages: texts } = await extractPdfText(data, (done, total) => setProgress({ done, total }));
      if (looksScanned(texts)) throw new PdfError("scanned");
      setPages(texts);
      setFromText("1");
      setToText(String(Math.min(texts.length, MAX_USED_PAGES)));
      setPhase("range");
    } catch (e) {
      const key = e instanceof PdfError ? e.problem : "unreadable";
      setProblem({ message: PROBLEM_MESSAGES[key], retryable: false });
      setFailedAt("reading");
      setPhase("error");
    }
  }

  function confirmRange() {
    const from = Number(fromText);
    const to = Number(toText);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > pages.length || from > to) {
      setRangeError(`Enter page numbers from 1 to ${pages.length}, with the first no larger than the last.`);
      return;
    }
    if (to - from + 1 > MAX_USED_PAGES) {
      setRangeError(`We use up to ${MAX_USED_PAGES} pages at a time. Pick a shorter range.`);
      return;
    }
    if (looksScanned(pages.slice(from - 1, to))) {
      setRangeError("Those pages have almost no readable text. Try a different range.");
      return;
    }
    setRangeError(null);

    const cached = loadOutline(outlineKey(hash, from, to));
    if (cached) {
      setOutline(cached.sections);
      setReused(true);
      setPhase("done");
      return;
    }
    void buildOutline(from, to);
  }

  async function buildOutline(from: number, to: number) {
    setPhase("outline");
    try {
      const inputs = {
        pages: Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: pages[from - 1 + i] })),
      };
      const { value, model } = await callAI("P1", inputs, (json) => normalizeOutline(json, from, to));
      saveOutline({
        hash,
        file_name: pendingFile!.name,
        from,
        to,
        total_pages: pages.length,
        sections: value,
        model,
        created: new Date().toISOString(),
      });
      setOutline(value);
      setReused(false);
      setPhase("done");
    } catch (e) {
      const kind: AiFailureKind = e instanceof AiFailure ? e.kind : "unavailable";
      setProblem({ message: AI_MESSAGES[kind], retryable: kind !== "not_configured" });
      setFailedAt("outline");
      setPhase("error");
    }
  }

  function tryAgain() {
    setProblem(null);
    setPhase("range");
  }

  function openSample() {
    openSampleDeck();
    navigate("/deck");
  }

  const readingState = phase === "reading" ? "now" : failedAt === "reading" && phase === "error" ? "failed" : "done";
  const outlineState =
    phase === "outline" ? "now" : phase === "done" ? "done" : phase === "error" && failedAt === "outline" ? "failed" : "pending";
  const statusText =
    phase === "reading"
      ? `Reading your PDF, page ${progress.done} of ${progress.total || "?"}`
      : phase === "outline"
        ? "Finding the sections"
        : phase === "done"
          ? "Outline ready"
          : "";

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/" className="btn">
          Home
        </Link>
        <span className="muted file-name">{pendingFile.name}</span>
      </header>

      <h1>{phase === "done" ? "Your outline" : "Building your deck"}</h1>

      <ol className="steps" aria-label="Progress">
        <li className={`step step--${readingState}`}>Reading your PDF</li>
        <li className={`step step--${outlineState}`}>Finding the sections</li>
        <li className="step step--later">Writing cards, checking sources and building the quiz (next updates)</li>
      </ol>

      <p role="status" className="muted">
        {statusText}
      </p>

      {phase === "reading" && (
        <div
          className="meter"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={progress.total || 1}
          aria-valuenow={progress.done}
        >
          <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      )}

      {phase === "range" && (
        <section className="card-box stack" aria-labelledby="range-heading">
          <h2 id="range-heading">Pages to use</h2>
          <p className="muted">
            This PDF has {pages.length} pages. Choose the chapter you want (up to {MAX_USED_PAGES} pages).
          </p>
          <div className="row">
            <label className="field-label">
              From page
              <input
                className="field"
                type="number"
                inputMode="numeric"
                min={1}
                max={pages.length}
                value={fromText}
                onChange={(e) => setFromText(e.target.value)}
              />
            </label>
            <label className="field-label">
              To page
              <input
                className="field"
                type="number"
                inputMode="numeric"
                min={1}
                max={pages.length}
                value={toText}
                onChange={(e) => setToText(e.target.value)}
              />
            </label>
          </div>
          {rangeError && (
            <p className="notice" role="alert">
              {rangeError}
            </p>
          )}
          <button type="button" className="btn btn--primary" onClick={confirmRange}>
            Build outline
          </button>
        </section>
      )}

      {phase === "error" && problem && (
        <div className="stack">
          <p className="notice" role="alert">
            {problem.message}
          </p>
          {problem.retryable && (
            <button type="button" className="btn btn--primary" onClick={tryAgain}>
              Try again
            </button>
          )}
          {failedAt === "outline" && (
            <button type="button" className="btn btn--primary" onClick={openSample}>
              Open the sample deck
            </button>
          )}
          <Link to="/" className="btn">
            Choose another file
          </Link>
        </div>
      )}

      {phase === "done" && outline && (
        <>
          {reused && <p className="muted">Reused your saved outline, so no AI was used.</p>}
          <OutlineList sections={outline} />
          <p className="notice">Cards, source checks and the quiz arrive in the next updates. Your outline is saved.</p>
          <Link to="/" className="btn btn--primary">
            Back to home
          </Link>
        </>
      )}
    </main>
  );
}
