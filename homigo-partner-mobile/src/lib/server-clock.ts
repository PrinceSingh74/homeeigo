/**
 * Server-time estimate for deadline displays (offer countdowns).
 *
 * The backend sends absolute instants (`offer.expiresAt`) and nothing else. A phone whose clock is
 * off by a minute would otherwise show a five-minute offer as having four or six minutes left. Every
 * API response carries an HTTP `Date` header stamped by the server, so the app measures the offset
 * from real responses instead of trusting the device clock.
 *
 * Precision: `Date` has one-second resolution (truncated), so +500 ms centres the estimate, and the
 * request's own round-trip bounds the remaining error. Samples with a round-trip over 3 s are
 * discarded — they say more about the network than about the clock. With no sample yet the offset
 * is 0 (device clock), which is exactly the behaviour before this existed.
 *
 * This is a DISPLAY aid only. The server re-checks the offer window inside the accept transaction,
 * so no estimate here can make an expired offer acceptable.
 *
 * Import-free on purpose (unit-testable under Node).
 */

const MAX_SAMPLE_RTT_MS = 3_000;

let offsetMs = 0;
let sampled = false;

/** Record one response. `startedAtMs`/`receivedAtMs` are device `Date.now()` around the fetch. */
export function recordServerDate(dateHeader: string | null | undefined, startedAtMs: number, receivedAtMs: number): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return;
  const rtt = receivedAtMs - startedAtMs;
  if (!(rtt >= 0) || rtt > MAX_SAMPLE_RTT_MS) return;
  const midpoint = startedAtMs + rtt / 2;
  offsetMs = serverMs + 500 - midpoint;
  sampled = true;
}

/** Best estimate of the server's current time, in epoch ms. */
export function serverNow(deviceNowMs: number = Date.now()): number {
  return deviceNowMs + offsetMs;
}

export function serverClockOffsetMs(): { offsetMs: number; sampled: boolean } {
  return { offsetMs, sampled };
}

/** Test-only. */
export function resetServerClock(): void {
  offsetMs = 0;
  sampled = false;
}
