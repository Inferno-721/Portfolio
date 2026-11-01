const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_TRACKED_KEYS = 5_000;

export type RateLimiter = (key: string, now?: number) => boolean;

/**
 * Per-visitor limit held in memory. Serverless instances don't share it and a cold start
 * resets it, so it stops casual abuse only. The hard ceiling is the provider's own quota,
 * and going over it falls back to search.
 */
export function createRateLimiter(
  perMinute: number,
  perDay: number,
): RateLimiter {
  const hits = new Map<string, number[]>();

  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < DAY_MS);
    const lastMinute = recent.filter((time) => now - time < MINUTE_MS).length;
    if (lastMinute >= perMinute || recent.length >= perDay) {
      hits.set(key, recent);
      return false;
    }
    if (hits.size >= MAX_TRACKED_KEYS && !hits.has(key)) hits.clear();
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

/** Caps model calls per instance per day. Over the cap, answers come from search instead. */
export function createDailyBudget(limit: number): (now?: number) => boolean {
  let day = -1;
  let used = 0;
  return (now = Date.now()) => {
    const today = Math.floor(now / DAY_MS);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= limit) return false;
    used++;
    return true;
  };
}
