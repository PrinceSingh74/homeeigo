import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/lib/api-config";
import { onConnectivityReconnect } from "@/lib/connectivity/connectivity-service";
import {
  enqueueTelemetry,
  getTelemetryQueueLength,
  readTelemetryQueue,
  replayTelemetryQueue,
  type TelemetryBeacon,
  type TelemetryReplayResult,
  type TelemetryStorage,
} from "./telemetry-queue-core";

const storage: TelemetryStorage = AsyncStorage;

let started = false;
let online = true;

/** Track synthetic offline state for tests; production uses fetch success/failure. */
export function setTelemetryOnlineForTests(value: boolean): void {
  online = value;
}

export const telemetrySender = async (item: TelemetryBeacon): Promise<void> => {
  if (!online) throw new Error("offline");
  const res = await fetch(`${getApiBaseUrl()}${item.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": item.id,
      "X-Telemetry-Id": item.id,
    },
    body: JSON.stringify(item.body),
  });
  if (!res.ok) throw new Error(`telemetry_http_${res.status}`);
};

/** Try immediate delivery; persist to queue on failure. */
export async function deliverTelemetryBeacon(
  path: TelemetryBeacon["path"],
  body: Record<string, unknown>,
  id?: string,
): Promise<boolean> {
  const beaconId = id ?? undefined;
  try {
    if (!online) throw new Error("offline");
    const tempId = beaconId ?? `tel-${Date.now()}`;
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": tempId,
        "X-Telemetry-Id": tempId,
      },
      body: JSON.stringify({ ...body, telemetryId: tempId }),
    });
    if (res.ok) return true;
    throw new Error(`http_${res.status}`);
  } catch {
    await enqueueTelemetry({ path, body, id: beaconId }, storage);
    return false;
  }
}

export async function replayTelemetry(force = false): Promise<TelemetryReplayResult> {
  return replayTelemetryQueue(telemetrySender, storage, Date.now(), force);
}

export async function getTelemetryQueueStats(): Promise<{ pending: number; items: TelemetryBeacon[] }> {
  const items = await readTelemetryQueue(storage);
  return { pending: items.length, items };
}

/** Wire replay on connectivity restore. Call once at app start. */
export function startTelemetryQueueService(): void {
  if (started) return;
  started = true;
  onConnectivityReconnect(() => {
    void replayTelemetry(true);
  });
  void replayTelemetry(true);
}

export { getTelemetryQueueLength };
