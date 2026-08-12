import { resolveApiBase } from "@/lib/api-base";
import { rumContext } from "@/lib/telemetry/context";

export type RecoverySignal =
  | "jwt_refresh"
  | "realtime_reconnect"
  | "heartbeat_timeout"
  | "offline_enqueue"
  | "offline_replay"
  | "queue_drain"
  | "cache_invalidation";

/** Fire-and-forget recovery telemetry → /api/ux-signals → Prometheus. */
export function emitRecoverySignal(signal: RecoverySignal, value?: number, route?: string): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    signal,
    value,
    ...rumContext(route ?? window.location.pathname),
  });
  const url = `${resolveApiBase()}/api/ux-signals`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    /* best-effort */
  }
}
