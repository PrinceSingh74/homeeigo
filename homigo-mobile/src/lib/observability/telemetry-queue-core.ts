/**
 * Pure telemetry queue engine — unit-testable without React Native.
 * Persists failed RUM beacons for replay with idempotent delivery keys.
 */
export const TELEMETRY_QUEUE_KEY = "homigo_telemetry_queue";
export const DELIVERED_IDS_KEY = "homigo_telemetry_delivered";
export const MAX_QUEUE_SIZE = 256;
export const MAX_DELIVERED_IDS = 512;
export const MAX_ATTEMPTS = 10;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 300_000;

export type TelemetryBeacon = {
  id: string;
  path: "/api/vitals" | "/api/ux-signals";
  body: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextRetryAt: number;
};

export type TelemetryReplayResult = { sent: number; dropped: number; kept: number; skipped: number };

export interface TelemetryStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

export type TelemetrySender = (item: TelemetryBeacon) => Promise<void>;

export function makeTelemetryId(): string {
  return `tel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts));
}

async function readDeliveredIds(storage: TelemetryStorage): Promise<Set<string>> {
  try {
    const raw = await storage.getItem(DELIVERED_IDS_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(list.slice(-MAX_DELIVERED_IDS));
  } catch {
    return new Set();
  }
}

async function markDelivered(id: string, storage: TelemetryStorage): Promise<void> {
  const set = await readDeliveredIds(storage);
  set.add(id);
  const list = [...set].slice(-MAX_DELIVERED_IDS);
  await storage.setItem(DELIVERED_IDS_KEY, JSON.stringify(list));
}

export async function readTelemetryQueue(storage: TelemetryStorage): Promise<TelemetryBeacon[]> {
  try {
    const raw = await storage.getItem(TELEMETRY_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as TelemetryBeacon[]) : [];
  } catch {
    return [];
  }
}

async function writeTelemetryQueue(items: TelemetryBeacon[], storage: TelemetryStorage): Promise<void> {
  await storage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE_SIZE)));
}

/** Enqueue a beacon for durable delivery. Drops oldest when at capacity. */
export async function enqueueTelemetry(
  req: { path: TelemetryBeacon["path"]; body: Record<string, unknown>; id?: string },
  storage: TelemetryStorage,
): Promise<string> {
  const delivered = await readDeliveredIds(storage);
  const id = req.id ?? makeTelemetryId();
  if (delivered.has(id)) return id;

  const item: TelemetryBeacon = {
    id,
    path: req.path,
    body: { ...req.body, telemetryId: id },
    createdAt: Date.now(),
    attempts: 0,
    nextRetryAt: Date.now(),
  };

  const queue = await readTelemetryQueue(storage);
  if (queue.some((q) => q.id === id)) return id;

  queue.push(item);
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  await writeTelemetryQueue(queue, storage);
  return id;
}

let replaying = false;

/** Replay due beacons with exponential backoff. Idempotent: skips already-delivered ids. */
export async function replayTelemetryQueue(
  send: TelemetrySender,
  storage: TelemetryStorage,
  now = Date.now(),
  ignoreBackoff = false,
): Promise<TelemetryReplayResult> {
  if (replaying) {
    const kept = (await readTelemetryQueue(storage)).length;
    return { sent: 0, dropped: 0, kept, skipped: 0 };
  }
  replaying = true;
  try {
    const delivered = await readDeliveredIds(storage);
    const queue = await readTelemetryQueue(storage);
    const remaining: TelemetryBeacon[] = [];
    let sent = 0;
    let dropped = 0;
    let skipped = 0;

    for (const item of queue) {
      if (delivered.has(item.id)) {
        skipped++;
        continue;
      }
      if (!ignoreBackoff && item.nextRetryAt > now) {
        remaining.push(item);
        continue;
      }
      try {
        await send(item);
        await markDelivered(item.id, storage);
        sent++;
      } catch {
        const attempts = item.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          dropped++;
        } else {
          remaining.push({
            ...item,
            attempts,
            nextRetryAt: now + backoffMs(attempts),
          });
        }
      }
    }

    await writeTelemetryQueue(remaining, storage);
    return { sent, dropped, kept: remaining.length, skipped };
  } finally {
    replaying = false;
  }
}

export async function getTelemetryQueueLength(storage: TelemetryStorage): Promise<number> {
  return (await readTelemetryQueue(storage)).length;
}
