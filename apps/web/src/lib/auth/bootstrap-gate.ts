/**
 * Auth bootstrap gate — blocks protected API calls until session refresh completes.
 * Prevents startup 401 noise on /api/notifications, /api/bookings/price-quote, etc.
 */
import { useAuthStore } from "@/stores/auth-store";

export type BootstrapTimelineEvent = {
  at: number;
  phase: string;
  detail?: string;
};

let bootstrapStartedAt = 0;
let bootstrapCompletedAt = 0;
let startup401Count = 0;
let refreshCallCount = 0;
let protectedApiBeforeReady = 0;
const timeline: BootstrapTimelineEvent[] = [];

function record(phase: string, detail?: string): void {
  timeline.push({ at: Date.now(), phase, detail });
}

export function resetBootstrapInstrumentation(): void {
  bootstrapStartedAt = 0;
  bootstrapCompletedAt = 0;
  startup401Count = 0;
  refreshCallCount = 0;
  protectedApiBeforeReady = 0;
  timeline.length = 0;
}

export function getBootstrapTimeline(): BootstrapTimelineEvent[] {
  return [...timeline];
}

export function markBootstrapStart(): void {
  if (!bootstrapStartedAt) bootstrapStartedAt = Date.now();
  record("bootstrap_start");
}

export function markBootstrapComplete(): void {
  bootstrapCompletedAt = Date.now();
  record("bootstrap_complete", useAuthStore.getState().status);
}

export function markRefreshCall(): void {
  refreshCallCount += 1;
  record("refresh_call", `#${refreshCallCount}`);
}

export function markProtectedApiAttempt(path: string): void {
  if (!isAuthBootstrapReady()) {
    protectedApiBeforeReady += 1;
    record("protected_api_blocked", path);
  } else {
    record("protected_api_allowed", path);
  }
}

export function recordStartup401(path?: string): void {
  startup401Count += 1;
  record("startup_401", path);
}

export function getAuthBootstrapMetrics() {
  return {
    auth_bootstrap_duration_ms:
      bootstrapStartedAt && bootstrapCompletedAt
        ? bootstrapCompletedAt - bootstrapStartedAt
        : 0,
    auth_startup_401_total: startup401Count,
    auth_refresh_calls: refreshCallCount,
    protected_api_before_ready: protectedApiBeforeReady,
    timeline_events: timeline.length,
  };
}

export function isAuthBootstrapReady(): boolean {
  const status = useAuthStore.getState().status;
  return status !== "idle" && status !== "initializing";
}

/** Wait until bootstrap finishes (authenticated or unauthenticated). */
export function waitForAuthBootstrap(timeoutMs = 15_000): Promise<void> {
  if (isAuthBootstrapReady()) return Promise.resolve();
  return new Promise((resolve) => {
    // Real timer, not just store-event checks: without it the timeout only
    // fires if some store update happens to land after the deadline.
    const timer = setTimeout(() => {
      unsub();
      resolve();
    }, timeoutMs);
    const check = () => {
      if (isAuthBootstrapReady()) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    };
    const unsub = useAuthStore.subscribe(check);
    check();
  });
}
