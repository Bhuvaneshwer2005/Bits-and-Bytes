import type { Section } from "../types/deck";

// Every read and write is guarded: storage can be blocked or corrupt, and the app must still work.

const OUTLINE_PREFIX = "sd.outline.";
const RECENT_KEY = "sd.recent";
const MAX_RECENT = 10;

export interface CachedOutline {
  hash: string;
  file_name: string;
  from: number;
  to: number;
  total_pages: number;
  sections: Section[];
  model: string;
  created: string;
}

export interface RecentEntry {
  key: string;
  file_name: string;
  from: number;
  to: number;
  sections: number;
  created: string;
}

export const outlineKey = (hash: string, from: number, to: number) => `${hash}_${from}-${to}`;

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
    // storage full or blocked: carry on without caching
  }
}

export function loadOutline(key: string): CachedOutline | null {
  const value = read<CachedOutline>(OUTLINE_PREFIX + key);
  return value && Array.isArray(value.sections) ? value : null;
}

export function saveOutline(outline: CachedOutline): void {
  const key = outlineKey(outline.hash, outline.from, outline.to);
  write(OUTLINE_PREFIX + key, outline);

  const recent = loadRecent().filter((r) => r.key !== key);
  recent.unshift({
    key,
    file_name: outline.file_name,
    from: outline.from,
    to: outline.to,
    sections: outline.sections.length,
    created: outline.created,
  });
  write(RECENT_KEY, recent.slice(0, MAX_RECENT));
}

export function loadRecent(): RecentEntry[] {
  const list = read<RecentEntry[]>(RECENT_KEY);
  return Array.isArray(list) ? list : [];
}
