/**
 * Native Sentry for Homeeigo mobile — JS + native crashes, unhandled rejections, render errors.
 * DSN-gated via EXPO_PUBLIC_SENTRY_DSN (no-op when unset, zero overhead in local dev).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import type { StartupMarker } from "@/lib/startup-trace";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? "";

const STARTUP_BREADCRUMB_MARKERS = new Set<StartupMarker>([
  "APP_START",
  "HYDRATION_START",
  "HYDRATION_END",
  "BOOTSTRAP_START",
  "BOOTSTRAP_END",
  "HOME_RENDER",
  "INTERACTIVE",
  "SPLASH_HIDE",
  "AUTH_READY",
]);

let initialized = false;

function buildVersion(): string {
  const cfg = Constants.expoConfig;
  if (Platform.OS === "ios") return cfg?.ios?.buildNumber ?? "0";
  if (Platform.OS === "android") return String(cfg?.android?.versionCode ?? 0);
  return "0";
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? "unknown";
}

/** Wire the legacy global hook used by telemetry.ts and startup-telemetry.ts. */
function wireGlobalHook(): void {
  (
    globalThis as {
      __HOMIGO_SENTRY__?: {
        captureException: (e: unknown, c?: { extra?: Record<string, unknown> }) => void;
        addBreadcrumb?: (crumb: {
          category: string;
          message: string;
          level?: string;
          data?: Record<string, unknown>;
        }) => void;
      };
    }
  ).__HOMIGO_SENTRY__ = {
    captureException: (error, ctx) => {
      Sentry.captureException(error, { extra: ctx?.extra });
    },
    addBreadcrumb: (crumb) => {
      Sentry.addBreadcrumb({
        category: crumb.category,
        message: crumb.message,
        level: (crumb.level as Sentry.SeverityLevel) ?? "info",
        data: crumb.data,
      });
    },
  };
}

/** Initialise Sentry at app startup — call once before expo-router mounts. */
export function initSentry(): boolean {
  if (initialized) return !!DSN;
  initialized = true;

  if (!DSN) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.info("[Homeeigo][sentry] disabled — set EXPO_PUBLIC_SENTRY_DSN to enable");
    }
    return false;
  }

  Sentry.init({
    dsn: DSN,
    enabled: true,
    debug: __DEV__,
    environment: __DEV__ ? "development" : "production",
    release: `homigo-mobile@${appVersion()}`,
    dist: buildVersion(),
    enableAutoSessionTracking: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableCaptureFailedRequests: true,
    attachStacktrace: true,
    tracesSampleRate: __DEV__ ? 1.0 : 0.15,
    integrations: [
      Sentry.reactNativeTracingIntegration(),
    ],
  });

  Sentry.setTag("platform", Platform.OS);
  Sentry.setTag("app_version", appVersion());
  Sentry.setTag("build_version", buildVersion());
  Sentry.setContext("build", {
    version: appVersion(),
    build: buildVersion(),
    platform: Platform.OS,
  });

  wireGlobalHook();
  return true;
}

/** Attach authenticated user id to all subsequent events. */
export function setSentryUser(user: { id?: string | null; role?: string | null } | null): void {
  if (!DSN || !initialized) return;
  if (!user?.id) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id });
  if (user.role) Sentry.setTag("role", user.role);
}

/** Record a startup milestone as a Sentry breadcrumb. */
export function addStartupBreadcrumb(marker: StartupMarker, detail?: string, sinceStartMs?: number): void {
  if (!DSN || !initialized || !STARTUP_BREADCRUMB_MARKERS.has(marker)) return;
  Sentry.addBreadcrumb({
    category: "startup",
    message: marker,
    level: "info",
    data: {
      detail,
      sinceStartMs,
    },
  });
}

/** Dev/QA: emit a synthetic exception to verify DSN delivery. */
export function triggerSentryTestException(): string {
  if (!DSN) return "Sentry disabled — set EXPO_PUBLIC_SENTRY_DSN";
  const err = new Error("HOMIGO_MOBILE_SENTRY_TEST");
  Sentry.captureException(err, {
    tags: { test: "synthetic" },
    extra: { triggeredAt: new Date().toISOString() },
  });
  return `Test exception sent (${err.message})`;
}

/** EAS preview/production device certification — triggers a real native crash (not Expo Go). */
export function triggerSentryNativeCrash(): string {
  if (!DSN) return "Sentry disabled — set EXPO_PUBLIC_SENTRY_DSN";
  Sentry.setTag("certification", "device-native-crash");
  Sentry.setTag("crash_kind", "native_android");
  Sentry.addBreadcrumb({
    category: "certification",
    message: "NATIVE_CRASH_TRIGGERED",
    level: "warning",
    data: { at: new Date().toISOString() },
  });
  Sentry.nativeCrash();
  return "Native crash triggered";
}

export { Sentry };
