import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDeck } from "../deck/DeckContext";
import * as P from "../lib/playerState";
import {
  DEFAULT_SETTINGS,
  RATES,
  deckStateKey,
  loadPlayerState,
  loadSettings,
  savePlayerState,
  saveSettings,
  type CaptionSize,
  type PlayerSettings,
} from "../lib/playerStorage";
import { recordCardCompleted } from "../lib/activityStorage";
import { loadEnglishVoices, narrate, sleep, speechSupported, splitSentences, stopSpeaking } from "../lib/speech";
import type { Card, Deck } from "../types/deck";

const TYPE_LABEL: Record<Card["type"], string> = { term: "Term", qa: "Question", cloze: "Fill in the blank" };

export default function Player() {
  const { deck } = useDeck();
  if (!deck) return <Navigate to="/" replace />;
  if (deck.cards.length === 0) {
    return (
      <main id="main" className="screen">
        <header className="topbar">
          <Link to="/deck" className="btn">
            Back
          </Link>
        </header>
        <p className="card-box">This deck has no cards yet.</p>
      </main>
    );
  }
  return <PlayerScreen deck={deck} />;
}

/** One auto-play run. `advance` means keep going to the next card when this one is done. */
interface Run {
  key: number;
  advance: boolean;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function PlayerScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const stateKey = deckStateKey(deck.meta.file_hash);
  const cardsById = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);
  const sectionTitle = useMemo(() => new Map(deck.sections.map((s) => [s.id, s.title])), [deck.sections]);

  const [state, setState] = useState<P.PlayerState>(() => {
    const saved = loadPlayerState(stateKey);
    return saved ? P.syncWithCards(saved, deck.cards) : P.initialState(deck.cards);
  });
  const [settings, setSettings] = useState<PlayerSettings>(() => loadSettings());
  const [flipped, setFlipped] = useState(false);
  const [active, setActive] = useState(-1); // sentence being spoken, -1 for none
  const [run, setRun] = useState<Run | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesChecked, setVoicesChecked] = useState(false);

  // Cards can arrive while the deck is still being built.
  const cardIds = deck.cards.map((c) => c.id).join("|");
  useEffect(() => {
    setState((s) => P.syncWithCards(s, deck.cards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIds]);

  useEffect(() => savePlayerState(stateKey, state), [stateKey, state]);
  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    let alive = true;
    void loadEnglishVoices().then((list) => {
      if (!alive) return;
      setVoices(list);
      setVoicesChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const voice = useMemo(() => {
    if (voices.length === 0) return null;
    return (
      voices.find((v) => v.voiceURI === settings.voiceURI) ??
      voices.find((v) => v.lang === "en-US" && v.localService) ??
      voices.find((v) => v.lang === "en-US") ??
      voices[0]
    );
  }, [voices, settings.voiceURI]);
  const useVoice = voice !== null && speechSupported();

  const finished = P.isFinished(state);
  const id = P.currentId(state);
  const card = id ? cardsById.get(id) : undefined;
  const repeats = P.repeatCount(state);

  // A new card always starts on its question side, and counts as viewed.
  useEffect(() => {
    setFlipped(false);
    setActive(-1);
    if (id) setState((s) => P.markViewed(s, id));
  }, [state.index, id]);

  useEffect(() => {
    if (finished) setRun(null);
  }, [finished]);

  // The auto-play sequence for the current card: question, pause, flip, answer, pause, next.
  useEffect(() => {
    if (!run || !card) return;
    const token = { cancelled: false };
    const options = { rate: settings.rate, voice, useVoice };
    void (async () => {
      await sleep(80); // let any speech that was just cancelled settle
      if (token.cancelled) return;
      setFlipped(false);
      await narrate(splitSentences(card.say_front), options, setActive, token);
      if (token.cancelled) return;
      await sleep(600);
      if (token.cancelled) return;
      setFlipped(true);
      setActive(-1);
      await narrate(splitSentences(card.say_back), options, setActive, token);
      if (token.cancelled) return;
      await sleep(900);
      if (token.cancelled) return;
      recordCardCompleted(); // listened all the way through: counts as a card studied
      if (run.advance) setState((s) => P.gotIt(s));
      else setRun(null);
    })();
    return () => {
      token.cancelled = true;
      stopSpeaking();
    };
    // `card` is read from this render on purpose: depending on the card object would restart the narration
    // whenever a new section finishes building and the deck object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, state.index, id, settings.rate, voice, useVoice]);

  const stopSingle = useCallback(() => setRun((r) => (r && !r.advance ? null : r)), []);

  const flip = useCallback(() => {
    setRun(null); // flipping by hand pauses the narration
    setActive(-1);
    setFlipped((f) => !f);
  }, []);

  const goNext = useCallback(() => {
    stopSingle();
    setState((s) => P.next(s));
  }, [stopSingle]);

  const goPrevious = useCallback(() => {
    stopSingle();
    setState((s) => P.previous(s));
  }, [stopSingle]);

  // "Again" and "Got it" are the two ways to finish a card by hand, and both count as a card studied.
  const markAgain = useCallback(() => {
    stopSingle();
    recordCardCompleted();
    setState((s) => P.again(s));
  }, [stopSingle]);

  const markGotIt = useCallback(() => {
    stopSingle();
    recordCardCompleted();
    setState((s) => P.gotIt(s));
  }, [stopSingle]);

  const togglePlay = () => setRun((r) => (r?.advance ? null : { key: (r?.key ?? 0) + 1, advance: true }));
  const repeat = () => setRun((r) => ({ key: (r?.key ?? 0) + 1, advance: r?.advance ?? false }));

  // Keyboard: arrows move, space flips (unless a control has focus, which uses space itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
      const onControl = inField || (!!target && /^(BUTTON|A)$/.test(target.tagName));
      if (inField) return; // arrows and space belong to the field
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrevious();
      else if (e.key === " " && !onControl && !finished) {
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrevious, flip, finished]);

  const update = (patch: Partial<PlayerSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const playing = run?.advance ?? false;
  const noVoice = voicesChecked && !useVoice;

  if (finished) {
    return (
      <main id="main" className="screen">
        <header className="topbar">
          <Link to="/deck" className="btn">
            Back
          </Link>
        </header>
        <h1>Deck finished</h1>
        <p className="card-box">
          You went through {state.viewed.length} {state.viewed.length === 1 ? "card" : "cards"}
          {state.again.length > 0 ? `, and marked ${state.again.length} for another look.` : "."}
        </p>
        <div className="stack">
          <button type="button" className="btn btn--primary" onClick={() => navigate("/quiz")}>
            Take the quiz
          </button>
          <button type="button" className="btn" onClick={() => setState((s) => P.restart(s, deck.cards))}>
            Study again
          </button>
          <button type="button" className="btn" onClick={() => navigate("/deck")}>
            Back to deck
          </button>
        </div>
      </main>
    );
  }

  if (!card) return null;

  const faceText = flipped ? card.back : card.front;
  const spoken = splitSentences(flipped ? card.say_back : card.say_front);
  const sectionName = sectionTitle.get(card.section_id);

  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/deck" className="btn">
          Back
        </Link>
        <span className="pill">{deck.meta.ai_generated ? "AI-generated" : "Sample deck"}</span>
      </header>

      <h1 className="sr-only">Flashcards</h1>

      <div className="stack">
        <p className="muted" role="status">
          Card {state.index + 1} of {state.queue.length}
          {repeats > 0 ? " · again" : ""}
          {sectionName ? ` · ${sectionName}` : ""}
        </p>
        <div
          className="meter"
          role="progressbar"
          aria-label="Deck progress"
          aria-valuemin={0}
          aria-valuemax={state.queue.length}
          aria-valuenow={state.index}
        >
          <span style={{ width: `${(state.index / state.queue.length) * 100}%` }} />
        </div>
      </div>

      <button type="button" className="flashcard" onClick={flip}>
        <span className="card-type">
          {flipped ? "Answer" : TYPE_LABEL[card.type]} · page {card.source_page}
        </span>
        <span key={flipped ? "back" : "front"} className="face">
          {faceText}
        </span>
        {flipped && <span className="source">Source: “{card.source_quote}”</span>}
        <span className="muted">{flipped ? "Tap to see the question" : "Tap to see the answer"}</span>
      </button>

      <div className="row">
        {card.edited_by_user && <span className="pill pill--accent">Edited by you</span>}
        <Link to={`/edit/${card.id}`} className="btn">
          Edit card
        </Link>
      </div>

      {!card.in_source && (
        <p className="notice" role="status">
          Check this card: {card.check_reason ?? "it could not be confirmed from the page."}
        </p>
      )}

      {settings.captions && (
        <div className={`captions captions--${settings.captionSize}`} role="group" aria-label="Captions">
          {spoken.map((sentence, i) => (
            <span key={i} className={i === active ? "caption-now" : undefined}>
              {sentence}{" "}
            </span>
          ))}
        </div>
      )}

      {noVoice && (
        <p className="notice" role="status">
          No voice found on this device, so captions are timed instead.
        </p>
      )}

      <div className="controls" role="group" aria-label="Playback">
        <button type="button" className="btn control" onClick={goPrevious} aria-label="Previous card" disabled={state.index === 0}>
          <Icon>
            <path d="M6 6h2v12H6zM20 6v12L9.5 12z" />
          </Icon>
        </button>
        <button type="button" className="btn btn--primary control control--main" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          <Icon>{playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</Icon>
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
        <button type="button" className="btn control" onClick={goNext} aria-label="Next card">
          <Icon>
            <path d="M16 6h2v12h-2zM4 18V6l10.5 6z" />
          </Icon>
        </button>
        <button type="button" className="btn control" onClick={repeat} aria-label="Repeat this card">
          <Icon>
            <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
          </Icon>
        </button>
      </div>

      <div className="row">
        <button type="button" className="btn grow" onClick={markAgain}>
          Again
        </button>
        <button type="button" className="btn grow" onClick={markGotIt}>
          Got it
        </button>
      </div>

      <section className="card-box stack" aria-label="Settings">
        <label className="field-label">
          Speed
          <select className="field" value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>
        {voices.length > 0 && (
          <label className="field-label">
            Voice
            <select
              className="field"
              value={voice?.voiceURI ?? ""}
              onChange={(e) => update({ voiceURI: e.target.value || DEFAULT_SETTINGS.voiceURI })}
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check-row">
          <input type="checkbox" checked={settings.captions} onChange={(e) => update({ captions: e.target.checked })} />
          Show captions
        </label>
        <label className="field-label">
          Caption size
          <select
            className="field"
            value={settings.captionSize}
            onChange={(e) => update({ captionSize: e.target.value as CaptionSize })}
            disabled={!settings.captions}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
      </section>
    </main>
  );
}
