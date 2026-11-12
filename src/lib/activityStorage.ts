import { useSyncExternalStore } from "react";
import {
  emptyActivity,
  parseActivity,
  recordCard,
  recordQuiz,
  sampleHistory,
  type Activity,
  type Goal,
} from "./activity";
import { localDate } from "./dates";

// Saved activity plus a tiny store, so every screen shows the same numbers and updates at once.
// Reading and writing are guarded: storage can be blocked or corrupt, and the app must still work.

const KEY = "sd.activity.v1";

let current: Activity | null = null;
const listeners = new Set<() => void>();

function load(): Activity {
  try {
    const raw = localStorage.getItem(KEY);
    return parseActivity(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyActivity();
  }
}

export function getActivity(): Activity {
  if (current === null) current = load();
  return current;
}

function commit(next: Activity): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: the numbers still work for this visit
  }
  listeners.forEach((listener) => listener());
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the data: pick it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const useActivity = (): Activity => useSyncExternalStore(subscribeActivity, getActivity);

export const recordCardCompleted = (now: Date = new Date()) => commit(recordCard(getActivity(), localDate(now)));
export const recordQuizFinished = (now: Date = new Date()) => commit(recordQuiz(getActivity(), localDate(now)));
export const setDailyGoal = (goal: Goal) => commit({ ...getActivity(), goal });
export const loadSampleHistory = (now: Date = new Date()) => commit({ ...getActivity(), sample: sampleHistory(localDate(now)) });
export const removeSampleHistory = () => commit({ ...getActivity(), sample: null });

/** For tests: forget the cached copy so the next read comes from storage. */
export function resetActivityCache(): void {
  current = null;
}
