import { Platform } from "react-native";
import { getApiBaseUrl } from "@/lib/api-config";
import { deliverTelemetryBeacon } from "@/lib/observability/telemetry-queue";

/**
 * Mobile RUM → durable queue → backend (/api/vitals, /api/ux-signals) → Prometheus.
 * Failed beacons persist locally and replay when connectivity returns.
 */
export type VitalName = "LCP" | "INP" | "FCP" | "TTFB" | "ROUTECHANGE" | "PAGELOAD" | "CLS";
export type UxSignal =
  | "nav_success"
  | "nav_abandoned"
  | "rapid_reclick"
  | "back_button"
  | "exit_during_loading"
  | "offline_enqueue"
  | "offline_replay"
  | "jwt_refresh"
  | "realtime_reconnect"
  | "heartbeat_timeout"
  | "queue_drain"
  | "cache_invalidation";

let networkLabel: "4g" | "3g" | "2g" | "slow-2g" | "offline" | "unknown" = "unknown";
export function setNetworkLabel(label: typeof networkLabel): void {
  networkLabel = label;
}

function deviceLabel(): "android" | "iphone" | "ipad" | "other" {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return Platform.isPad ? "ipad" : "iphone";
  return "other";
}

async function beacon(path: "/api/vitals" | "/api/ux-signals", body: Record<string, unknown>): Promise<boolean> {
  try {
    return await deliverTelemetryBeacon(path, body);
  } catch {
    return false;
  }
}

export function reportVital(name: VitalName, valueMs: number, route = "mobile"): void {
  if (!Number.isFinite(valueMs)) return;
  void beacon("/api/vitals", {
    name,
    value: valueMs,
    rating: "unknown",
    device: deviceLabel(),
    network: networkLabel,
    route,
  });
}

export function reportUxSignal(signal: UxSignal, route = "mobile"): void {
  void beacon("/api/ux-signals", { signal, device: deviceLabel(), network: networkLabel, route });
}

export function reportRecoverySignal(signal: UxSignal, value?: number, route = "mobile"): void {
  void beacon("/api/ux-signals", {
    signal,
    value,
    device: deviceLabel(),
    network: networkLabel,
    route,
  });
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error("[Homeeigo][error]", message, context);
  const sentry = (globalThis as { __HOMIGO_SENTRY__?: { captureException: (e: unknown, c?: unknown) => void } }).__HOMIGO_SENTRY__;
  sentry?.captureException(error, { extra: context });
}

let appStartAt = Date.now();
export function markAppStart(): void {
  appStartAt = Date.now();
}

export function reportColdStart(): void {
  const ms = Date.now() - appStartAt;
  if (ms > 0 && ms < 60_000) reportVital("PAGELOAD", ms, "cold-start");
}

export function reportOfflineEnqueue(path: string, method: string): void {
  reportUxSignal("offline_enqueue", path.includes("/bookings") ? "/book" : "mobile");
}

export function reportOfflineReplay(sent: number, dropped: number, kept: number): void {
  void beacon("/api/ux-signals", {
    signal: "offline_replay",
    value: sent,
    device: deviceLabel(),
    network: networkLabel,
    route: "mobile",
  });
}

/** Re-export for startup-telemetry durable delivery. */
export { deliverTelemetryBeacon };
