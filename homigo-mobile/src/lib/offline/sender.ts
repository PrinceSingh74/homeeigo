import { apiRequest } from "@/services/auth/api-client";
import { AuthApiError } from "@/lib/auth/errors";
import { assertOfflineSafePath } from "@/lib/offline/blocked-paths";
import { reportOfflineEnqueue, reportOfflineReplay, reportRecoverySignal } from "@/lib/observability/telemetry";
import { enqueue, makeQueueId, replayQueue, startOfflineSync, type QueuedRequest, type Sender } from "./queue";
import NetInfo from "@react-native-community/netinfo";

const replayListeners = new Set<(path: string) => void>();

/** Register a listener fired after each successful offline replay (for cache invalidation). */
export function onOfflineReplaySuccess(listener: (path: string) => void): () => void {
  replayListeners.add(listener);
  return () => replayListeners.delete(listener);
}

function notifyReplay(path: string): void {
  for (const listener of replayListeners) listener(path);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replays a queued request through the real API client, tagging it with its id as the idempotency key. */
export const defaultSend: Sender = async (item: QueuedRequest) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await apiRequest(item.path, {
        method: item.method,
        body: item.body,
        auth: item.auth,
        idempotencyKey: item.id,
      });
      notifyReplay(item.path);
      return;
    } catch (err) {
      if (err instanceof AuthApiError && err.code === "IDEMPOTENCY_IN_PROGRESS") {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
};

/** Call once at app start — replays anything queued from a previous offline session and on reconnect. */
let offlineSyncStarted = false;

export function scheduleOfflineSync(): void {
  if (offlineSyncStarted) return;
  offlineSyncStarted = true;
  initOfflineSync();
}

export function initOfflineSync(): void {
  const onReplay = (r: { sent: number; dropped: number; kept: number }) => {
    if (r.sent > 0 || r.dropped > 0) {
      reportOfflineReplay(r.sent, r.dropped, r.kept);
      if (r.sent > 0) reportRecoverySignal("queue_drain", r.sent);
    }
  };
  startOfflineSync(defaultSend, onReplay);
  void replayQueue(defaultSend).then(onReplay);
}

/**
 * Perform a mutation that survives being offline: try now; if the network is down, persist it for replay.
 * Returns `{ queued: true }` when deferred. Use for booking/profile/wallet writes that must not be lost.
 */
export async function mutateWithOfflineFallback<T>(req: {
  path: string;
  method: string;
  body?: unknown;
  auth?: boolean;
}): Promise<{ queued: false; data: T } | { queued: true; id: string }> {
  assertOfflineSafePath(req.path);
  // One stable id is the Idempotency-Key for the live attempt AND the queue id for any
  // replay, so a request that reached the server before its response was lost is deduped
  // (not duplicated) when re-sent. The replay path (defaultSend) re-uses item.id as the key.
  const id = makeQueueId();
  const net = await NetInfo.fetch();
  if (net.isConnected === false) {
    await enqueue({ ...req, id });
    reportOfflineEnqueue(req.path, req.method);
    return { queued: true, id };
  }
  try {
    const data = await apiRequest<T>(req.path, {
      method: req.method,
      body: req.body,
      auth: req.auth ?? true,
      idempotencyKey: id,
    });
    return { queued: false, data };
  } catch (err) {
    // Network-class failure mid-flight → queue it; rethrow real API errors (4xx/5xx) for the UI.
    const status = (err as { status?: number })?.status ?? 0;
    if (status === 0) {
      await enqueue({ ...req, id });
      reportOfflineEnqueue(req.path, req.method);
      return { queued: true, id };
    }
    throw err;
  }
}
