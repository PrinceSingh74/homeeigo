/**
 * Runtime diagnostics collector — FPS, memory, queues, auth, network, websocket.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useConnectivityStore } from "@/lib/connectivity/connectivity-service";
import { getTelemetryQueueStats } from "@/lib/observability/telemetry-queue";
import { readQueue } from "@/lib/offline/queue";
import { getStartupTimeline, getAsyncSteps, checkStartupBudgets, exportStartupDiagnostics } from "@/lib/startup-trace";
import { getWebSocketDiagnostics } from "@/lib/realtime/ws-registry";
import { useAuthStore } from "@/stores/auth-store";

export type RuntimeDiagnosticsBundle = {
  exportedAt: string;
  platform: string;
  version: string;
  build: string;
  deviceType: string;
  fps: { current: number; avg: number; samples: number };
  memory: { jsHeapMb: number | null };
  cpu: { note: string };
  startup: ReturnType<typeof exportStartupDiagnostics>;
  network: {
    isConnected: boolean;
    isInternetReachable: boolean | null;
    type: string;
    networkLabel: string;
  };
  auth: { status: string; userId: string | null };
  offlineMutationQueue: { count: number };
  telemetryQueue: { pending: number };
  websockets: ReturnType<typeof getWebSocketDiagnostics>;
};

let fpsSamples: number[] = [];
let lastFrameAt = 0;
let rafId: number | null = null;

function deviceType(): string {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return (Platform as { isPad?: boolean }).isPad ? "ipad" : "iphone";
  return Platform.OS;
}

function buildVersion(): string {
  if (Platform.OS === "ios") return Constants.expoConfig?.ios?.buildNumber ?? "?";
  return String(Constants.expoConfig?.android?.versionCode ?? "?");
}

/** Start FPS sampling (dev diagnostics only). */
export function startFpsMonitor(): () => void {
  if (rafId != null) return () => undefined;
  lastFrameAt = Date.now();

  const tick = () => {
    const now = Date.now();
    const delta = now - lastFrameAt;
    if (delta > 0) {
      const fps = Math.min(120, 1000 / delta);
      fpsSamples.push(fps);
      if (fpsSamples.length > 120) fpsSamples = fpsSamples.slice(-120);
    }
    lastFrameAt = now;
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
  };
}

export function getFpsSnapshot(): { current: number; avg: number; samples: number } {
  if (!fpsSamples.length) return { current: 0, avg: 0, samples: 0 };
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  return { current: fpsSamples[fpsSamples.length - 1] ?? 0, avg, samples: fpsSamples.length };
}

export async function collectRuntimeDiagnostics(): Promise<RuntimeDiagnosticsBundle> {
  const connectivity = useConnectivityStore.getState();
  const auth = useAuthStore.getState();
  const [offlineQ, telemetryQ] = await Promise.all([readQueue(), getTelemetryQueueStats()]);

  const perf = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance;

  return {
    exportedAt: new Date().toISOString(),
    platform: Platform.OS,
    version: Constants.expoConfig?.version ?? "unknown",
    build: buildVersion(),
    deviceType: deviceType(),
    fps: getFpsSnapshot(),
    memory: {
      jsHeapMb: perf?.memory?.usedJSHeapSize
        ? Math.round((perf.memory.usedJSHeapSize / 1024 / 1024) * 10) / 10
        : null,
    },
    cpu: {
      note: "CPU util requires native profiler; JS heap + FPS proxy used on-device",
    },
    startup: exportStartupDiagnostics(),
    network: {
      isConnected: connectivity.isConnected,
      isInternetReachable: connectivity.isInternetReachable,
      type: connectivity.type,
      networkLabel: connectivity.networkLabel,
    },
    auth: { status: auth.status, userId: auth.user?.id ?? null },
    offlineMutationQueue: { count: offlineQ.length },
    telemetryQueue: { pending: telemetryQ.pending },
    websockets: getWebSocketDiagnostics(),
  };
}

export async function exportDiagnosticsJson(): Promise<string> {
  const bundle = await collectRuntimeDiagnostics();
  return JSON.stringify(bundle, null, 2);
}
