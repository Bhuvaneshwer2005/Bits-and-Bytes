// Best-effort per-IP rate limit. Serverless instances do not share memory, so this is a safety
// net against runaway loops, not a hard guarantee. The providers' own limits are the real ceiling.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 15;
const hits = new Map<string, number[]>();

export function allow(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}
