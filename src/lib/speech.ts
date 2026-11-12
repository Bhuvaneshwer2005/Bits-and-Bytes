// Text-to-speech for the player. Uses the browser's own voices (Web Speech API), one sentence at a time so
// captions can follow along. When the device has no voice, sentences are shown on a timer instead.

// Abbreviations that are almost never the end of a sentence. Words like "no" or "etc" are left out on purpose.
const ABBREVIATIONS = /\b(?:e\.g|i\.e|fig|eq|vs|approx|dr|mr|mrs|ms|prof|cf)\.$/i;

/** Splits spoken text into sentences, without cutting after common abbreviations like "e.g." or "Fig.". */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous && ABBREVIATIONS.test(previous)) merged[merged.length - 1] = `${previous} ${part}`;
    else merged.push(part);
  }
  return merged.length ? merged : text.trim() ? [text.trim()] : [];
}

/** How long a sentence takes to say, roughly. Used for the timed fallback and as a safety timeout. */
export function estimateMs(text: string, rate: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1200, (words * 380) / Math.max(0.5, rate));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** English voices installed on this device. Chrome fills the list late, so wait for it. */
export function loadEnglishVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const english = () => window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const now = english();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(english());
    };
    const timer = setTimeout(done, timeoutMs);
    window.speechSynthesis.addEventListener("voiceschanged", done);
  });
}

export interface NarrateOptions {
  rate: number;
  voice: SpeechSynthesisVoice | null;
  /** False when there is no usable voice: sentences are held on screen for their estimated time instead. */
  useVoice: boolean;
}

export interface CancelToken {
  cancelled: boolean;
}

function speakOne(text: string, { rate, voice }: NarrateOptions): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      resolve();
    };
    // Some browsers never fire `end`; don't let the player hang on them.
    const safety = setTimeout(finish, estimateMs(text, rate) + 4000);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.onend = finish;
    utterance.onerror = finish; // also fires for cancel()
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Says each sentence in turn, calling `onSentence(i)` as each one starts so captions can highlight it.
 * Stops as soon as `token.cancelled` is set. Resolves when finished or cancelled.
 */
export async function narrate(
  sentences: string[],
  options: NarrateOptions,
  onSentence: (index: number) => void,
  token: CancelToken,
): Promise<void> {
  for (let i = 0; i < sentences.length; i++) {
    if (token.cancelled) return;
    onSentence(i);
    if (options.useVoice && speechSupported()) await speakOne(sentences[i], options);
    else await sleep(estimateMs(sentences[i], options.rate));
  }
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export { sleep };
