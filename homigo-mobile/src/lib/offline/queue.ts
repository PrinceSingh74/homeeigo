import AsyncStorage from "@react-native-async-storage/async-storage";
import { onConnectivityReconnect } from "@/lib/connectivity/connectivity-service";
import {
  enqueueTo,
  makeQueueId,
  readQueue as readQueueCore,
  replayQueueWith,
  type QueueStorage,
  type QueuedRequest,
  type ReplayResult,
  type Sender,
} from "./queue-core";

export type { QueuedRequest, ReplayResult, Sender } from "./queue-core";
export { makeQueueId } from "./queue-core";

/**
 * Device-bound offline queue: the pure engine in queue-core.ts bound to AsyncStorage (persistence)
 * and the shared connectivity service (replay on reconnect). Mutations issued offline are persisted
 * and re-sent in order.
 */
const storage: QueueStorage = AsyncStorage;

export const enqueue = (req: {
  path: string;
  method: string;
  body?: unknown;
  auth?: boolean;
  id?: string;
}): Promise<string> => enqueueTo(req, storage);

export const readQueue = (): Promise<QueuedRequest[]> => readQueueCore(storage);

export const replayQueue = (send: Sender): Promise<ReplayResult> => replayQueueWith(send, storage);

let started = false;
/** Wire replay to network recovery via the single connectivity service. Call once at app start. */
export function startOfflineSync(
  defaultSend: Sender,
  onReplay?: (result: ReplayResult) => void,
): void {
  if (started) return;
  started = true;
  onConnectivityReconnect(() => {
    void replayQueue(defaultSend).then((r) => {
      if (r.sent > 0 || r.dropped > 0) onReplay?.(r);
    });
  });
}
