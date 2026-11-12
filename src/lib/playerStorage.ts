import type { PlayerState } from "./playerState";

// Saved position and settings. Every read and write is guarded: storage can be blocked or corrupt.

export type CaptionSize = "small" | "medium" | "large";

export interface PlayerSettings {
  rate: number;
  voiceURI: string | null;
  captions: boolean;
  captionSize: CaptionSize;
}

export const DEFAULT_SETTINGS: PlayerSettings = { rate: 1, voiceURI: null, captions: true, captionSize: "medium" };
export const RATES = [0.75, 1, 1.25, 1.5];
const SETTINGS_KEY = "sd.player.settings";
const STATE_PREFIX = "sd.player.state.";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: carry on without saving
  }
}

const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((i) => typeof i === "string");

export function loadSettings(): PlayerSettings {
  const saved = read<Partial<PlayerSettings>>(SETTINGS_KEY);
  if (!saved) return DEFAULT_SETTINGS;
  return {
    rate: typeof saved.rate === "number" && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : DEFAULT_SETTINGS.rate,
    voiceURI: typeof saved.voiceURI === "string" ? saved.voiceURI : null,
    captions: typeof saved.captions === "boolean" ? saved.captions : DEFAULT_SETTINGS.captions,
    captionSize: saved.captionSize === "small" || saved.captionSize === "large" ? saved.captionSize : "medium",
  };
}

export const saveSettings = (settings: PlayerSettings) => write(SETTINGS_KEY, settings);

/** The deck's identity for saving progress: the PDF's hash, or "sample" for the bundled deck. */
export const deckStateKey = (fileHash: string) => STATE_PREFIX + fileHash;

export function loadPlayerState(key: string): PlayerState | null {
  const s = read<Partial<PlayerState>>(key);
  if (!s || !isStringArray(s.queue) || !isStringArray(s.viewed) || !isStringArray(s.again) || !isStringArray(s.known)) return null;
  if (typeof s.index !== "number" || s.index < 0) return null;
  return { queue: s.queue, index: s.index, viewed: s.viewed, again: s.again, known: s.known };
}

export const savePlayerState = (key: string, state: PlayerState) => write(key, state);
