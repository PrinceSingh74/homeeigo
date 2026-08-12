/**
 * Pure offline-queue engine — NO react-native imports, so it is unit-testable off-device.
 * Storage and the network sender are injected. `queue.ts` binds the AsyncStorage/NetInfo defaults.
 */
export const QUEUE_KEY = "homigo_offline_queue";
export const MAX_ATTEMPTS = 8;

export type QueuedRequest = {
  id: string;
  path: string;
  method: string;
  body?: unknown;
  auth: boolean;
  createdAt: number;
  attempts: number;
};
export type ReplayResult = { sent: number; dropped: number; kept: number };

export interface QueueStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}
export type Sender = (item: QueuedRequest) => Promise<void>; // rejects with { status } on failure

export async function readQueue(storage: QueueStorage): Promise<QueuedRequest[]> {
  try {
    const raw = await storage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

export async function writeQueue(items: QueuedRequest[], storage: QueueStorage): Promise<void> {
  await storage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** Stable queue/idempotency id. The same value is used as the Idempotency-Key for the
 *  initial online attempt AND the persisted replay, so a request that actually reached the
 *  server before the response was lost is deduped server-side instead of duplicated. */
export function makeQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueTo(
  req: { path: string; method: string; body?: unknown; auth?: boolean; id?: string },
  storage: QueueStorage,
): Promise<string> {
  const item: QueuedRequest = {
    id: req.id ?? makeQueueId(),
    path: req.path,
    method: req.method,
    body: req.body,
    auth: req.auth ?? true,
    createdAt: Date.now(),
    attempts: 0,
  };
  const queue = await readQueue(storage);
  queue.push(item);
  await writeQueue(queue, storage);
  return item.id;
}

/** A permanent client error (4xx except 408/429/409-in-progress) should be dropped, not retried forever. */
export function isPermanentFailure(status: number, code?: string): boolean {
  if (status === 409 && code === "IDEMPOTENCY_IN_PROGRESS") return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

let replaying = false;

export async function replayQueueWith(
  send: Sender,
  storage: QueueStorage,
): Promise<ReplayResult> {
  if (replaying) return { sent: 0, dropped: 0, kept: (await readQueue(storage)).length };
  replaying = true;
  try {
    const queue = await readQueue(storage);
    const remaining: QueuedRequest[] = [];
    let sent = 0;
    let dropped = 0;
    for (const item of queue) {
      try {
        await send(item);
        sent++;
      } catch (err) {
        const status = (err as { status?: number })?.status ?? 0;
        const code = (err as { code?: string })?.code;
        if (isPermanentFailure(status, code)) dropped++;
        else if (item.attempts + 1 >= MAX_ATTEMPTS) dropped++;
        else remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    await writeQueue(remaining, storage);
    return { sent, dropped, kept: remaining.length };
  } finally {
    replaying = false;
  }
}
