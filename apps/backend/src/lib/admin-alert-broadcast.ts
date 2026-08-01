/**
 * Admin ops-map alert broadcast guard — zero traffic when no subscribers.
 *
 * Adds deduplication, rate limiting, throttling, and Prometheus metrics.
 */
import { incCounter } from "./metrics";
import { roomManager } from "./websocket";

export const ADMIN_OPS_ROOM = "admin:ops";

/** Minimum interval between identical alert payloads (ms). */
const ALERT_THROTTLE_MS = Number(process.env.ADMIN_ALERT_THROTTLE_MS || 60_000);
/** Max alerts emitted per dispatch tick (batch cap). */
const ALERT_RATE_LIMIT_PER_TICK = Number(process.env.ADMIN_ALERT_RATE_LIMIT || 20);
/** Dedup TTL for alert keys (ms). */
export const ALERT_DEDUP_TTL_MS = 10 * 60 * 1000;

const lastEmittedAt = new Map<string, number>();
const dedupKeys = new Map<string, number>();

export function alertKey(a: { type: string; bookingId?: string; providerId?: string }): string {
  return `${a.type}:${a.bookingId ?? ""}:${a.providerId ?? ""}`;
}

export function getAdminAlertSubscriberCount(): number {
  return roomManager.getRoom(ADMIN_OPS_ROOM).size;
}

function pruneDedup(now: number): void {
  for (const [k, ts] of dedupKeys) {
    if (now - ts > ALERT_DEDUP_TTL_MS) dedupKeys.delete(k);
  }
}

export type AlertBroadcastResult =
  | { action: "sent"; key: string }
  | { action: "skipped"; reason: "no_subscribers" }
  | { action: "deduplicated"; key: string }
  | { action: "rate_limited" }
  | { action: "throttled"; key: string };

/**
 * Attempt to broadcast one ADMIN_ALERT. Returns without emitting when there are
 * no subscribers — prevents "sent to 0/0" websocket noise.
 */
export function tryBroadcastAdminAlert(
  key: string,
  payload: Record<string, unknown>,
  now = Date.now(),
  emittedThisTick: number,
): AlertBroadcastResult {
  const subscribers = getAdminAlertSubscriberCount();
  if (subscribers === 0) {
    incCounter("admin_alerts_skipped_total", { reason: "no_subscribers" });
    return { action: "skipped", reason: "no_subscribers" };
  }

  pruneDedup(now);

  if (dedupKeys.has(key)) {
    dedupKeys.set(key, now);
    incCounter("admin_alerts_deduplicated_total");
    return { action: "deduplicated", key };
  }

  const lastAt = lastEmittedAt.get(key) ?? 0;
  if (now - lastAt < ALERT_THROTTLE_MS) {
    incCounter("admin_alerts_rate_limited_total", { kind: "throttle" });
    return { action: "throttled", key };
  }

  if (emittedThisTick >= ALERT_RATE_LIMIT_PER_TICK) {
    incCounter("admin_alerts_rate_limited_total", { kind: "batch_cap" });
    return { action: "rate_limited" };
  }

  roomManager.broadcast(ADMIN_OPS_ROOM, {
    type: "ADMIN_ALERT",
    data: payload,
    timestamp: new Date(now),
  });
  dedupKeys.set(key, now);
  lastEmittedAt.set(key, now);
  incCounter("admin_alerts_sent_total");
  return { action: "sent", key };
}

/** Reset in-memory state (tests). */
export function resetAdminAlertBroadcastState(): void {
  lastEmittedAt.clear();
  dedupKeys.clear();
}
