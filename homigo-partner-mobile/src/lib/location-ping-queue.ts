/**
 * Ordered offline queue for presence location pings (import-free — unit-tested under Node).
 *
 * Backend rules this queue is shaped around (apps/backend/src/lib/partner-presence-location.ts,
 * lib/partner-presence.config.ts):
 *  - `sequence` must strictly increase (SEQUENCE_REGRESSION otherwise) → flush strictly in order;
 *  - `capturedAt` older than 300 s is rejected (TIMESTAMP_TOO_OLD) → fixes older than `maxAgeMs`
 *    are discarded locally instead of being sent to be refused. Replaying an hour of pings after a
 *    tunnel would be both rejected and meaningless for "where is the partner now";
 *  - 6 presence writes / 10 s per partner (heartbeat + ping share it) → `maxPerFlush` bounds a burst.
 *
 * The sender classifies each attempt:
 *  - "sent"  → remove, continue;
 *  - "drop"  → the server refused THIS fix permanently (regression, too old, impossible jump,
 *              invalid coords) → remove, continue;
 *  - "retry" → network / 5xx / 429 / session needs repair → stop, keep this and everything after.
 */

export type QueuedFix = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** ISO time the OS captured the fix (NOT the send time). */
  capturedAt: string;
  sequence: number;
};

export type SendVerdict = "sent" | "drop" | "retry";

export type PingQueueOptions = {
  maxSize?: number;
  maxAgeMs?: number;
  maxPerFlush?: number;
};

export function createPingQueue(opts: PingQueueOptions = {}) {
  const maxSize = opts.maxSize ?? 50;
  // 20 s of headroom under the server's 300 s bound for transit time and clock skew.
  const maxAgeMs = opts.maxAgeMs ?? 280_000;
  const maxPerFlush = opts.maxPerFlush ?? 3;
  let items: QueuedFix[] = [];
  let flushing: Promise<{ sent: number; dropped: number; remaining: number }> | null = null;

  function prune(nowMs: number) {
    items = items.filter((f) => {
      const t = Date.parse(f.capturedAt);
      return Number.isFinite(t) && nowMs - t <= maxAgeMs;
    });
  }

  return {
    enqueue(fix: QueuedFix, nowMs: number = Date.now()) {
      // Keep the queue sorted by sequence even if the OS delivered a batch out of order.
      items.push(fix);
      items.sort((a, b) => a.sequence - b.sequence);
      if (items.length > maxSize) items = items.slice(items.length - maxSize);
      prune(nowMs);
    },

    size: () => items.length,
    peekAll: (): readonly QueuedFix[] => items.slice(),
    clear: () => {
      items = [];
    },

    /**
     * Send queued fixes oldest-first. Concurrent calls join the same flush, so two OS callbacks
     * arriving together cannot send the same fix twice or interleave out of order.
     */
    flush(send: (fix: QueuedFix) => Promise<SendVerdict>, nowMs: number = Date.now()) {
      if (flushing) return flushing;
      const run = (async () => {
        prune(nowMs);
        let sent = 0;
        let dropped = 0;
        let attempts = 0;
        while (items.length > 0 && attempts < maxPerFlush) {
          const head = items[0];
          attempts += 1;
          let verdict: SendVerdict;
          try {
            verdict = await send(head);
          } catch {
            verdict = "retry";
          }
          if (verdict === "retry") break;
          // Remove by identity: enqueue() may have re-sorted while we awaited.
          items = items.filter((f) => f !== head);
          if (verdict === "sent") sent += 1;
          else dropped += 1;
        }
        return { sent, dropped, remaining: items.length };
      })();
      flushing = run;
      void run.finally(() => {
        if (flushing === run) flushing = null;
      });
      return run;
    },
  };
}

/** Server error codes that mean "this fix can never be accepted" — drop it, don't retry. */
const PERMANENT_FIX_ERRORS = new Set([
  "SEQUENCE_REGRESSION",
  "TIMESTAMP_TOO_OLD",
  "TIMESTAMP_FUTURE",
  "IMPOSSIBLE_JUMP",
  "INVALID_LATITUDE",
  "INVALID_LONGITUDE",
  "INVALID_ACCURACY",
]);

/** Map an API failure to a queue verdict. */
export function classifyPingError(status: number, code: string | null): SendVerdict {
  if (code && PERMANENT_FIX_ERRORS.has(code)) return "drop";
  if (status === 400 || status === 422) return "drop";
  // 401/403 (session / device), 429, 5xx, network (status 0): keep the fix, repair, try later.
  return "retry";
}
