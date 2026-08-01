/** Bounded exponential backoff with jitter for outbox republication. */
export function computeRetryDelayMs(attempt: number, baseMs = 2000, maxMs = 300_000): Date {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.1));
  return new Date(Date.now() + exp + jitter);
}

export function isTransientConsumerError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  if (msg.includes("validation") || msg.includes("prohibited") || msg.includes("invalid event")) {
    return false;
  }
  return true;
}
