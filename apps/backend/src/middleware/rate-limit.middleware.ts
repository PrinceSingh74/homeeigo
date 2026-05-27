type CounterEntry = { count: number; resetAt: number };

const store = new Map<string, CounterEntry>();

export const consumeRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  entry.count += 1;
  store.set(key, entry);
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
};

/** True if this key already hit its limit within the active window (no increment). */
export const isRateLimitExceeded = (key: string, limit: number) => {
  const entry = store.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= limit;
};
