/**
 * Native Sentry for the HOMEEIGO Partner app — JS + native crashes, unhandled rejections,
 * render errors.
 *
 * Follows the customer app's established pattern (`homigo-mobile/src/lib/observability/sentry.ts`)
 * so both apps behave identically: DSN-gated via EXPO_PUBLIC_SENTRY_DSN, a complete no-op with zero
 * overhead when unset (local dev needs no Sentry account), and never a thrown error just because
 * observability isn't configured.
 *
 * The DSN is NEVER hardcoded. The partner app also needs its OWN Sentry project — reusing the
 * customer app's would mix two apps' crash streams into one issue feed.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { scrubEvent, scrubObject } from "@/lib/observability/scrub";

export { scrubEvent, scrubObject };

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? "";

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

/**
 * Build/runtime environment. `EXPO_PUBLIC_APP_ENV` wins when set (EAS profiles set it explicitly),
 * otherwise fall back to the __DEV__ flag — so a preview build is never mislabelled "production".
 */
function environment(): string {
  const explicit = process.env.EXPO_PUBLIC_APP_ENV?.trim();
  if (explicit) return explicit;
  return __DEV__ ? "development" : "production";
}

/** Initialise Sentry at app startup — call once before expo-router mounts. */
export function initSentry(): boolean {
  if (initialized) return !!DSN;
  initialized = true;

  if (!DSN) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.info("[Homeeigo Partner][sentry] disabled — set EXPO_PUBLIC_SENTRY_DSN to enable");
    }
    return false;
  }

  Sentry.init({
    dsn: DSN,
    enabled: true,
    debug: __DEV__,
    environment: environment(),
    release: `homigo-partner-mobile@${appVersion()}`,
    dist: buildVersion(),
    enableAutoSessionTracking: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableCaptureFailedRequests: true,
    attachStacktrace: true,
    tracesSampleRate: __DEV__ ? 1.0 : 0.15,
    integrations: [Sentry.reactNativeTracingIntegration()],

    /**
     * Last-line scrubbing before anything leaves the device.
     *
     * The SDK already redacts nothing application-specific, and this app handles partner PII,
     * auth tokens, job OTPs and payment identifiers. Rather than trusting every future call site
     * to be careful, strip known-sensitive keys centrally.
     */
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrubObject(crumb.data) as Record<string, unknown>;
      return crumb;
    },
  });

  Sentry.setTag("platform", Platform.OS);
  Sentry.setTag("app", "partner");
  Sentry.setTag("app_version", appVersion());
  Sentry.setTag("build_version", buildVersion());
  Sentry.setContext("build", {
    version: appVersion(),
    build: buildVersion(),
    platform: Platform.OS,
    environment: environment(),
  });

  wireGlobalHook();
  return true;
}

/** Wire the global hook used by the error boundary, mirroring the customer app's bridge. */
function wireGlobalHook(): void {
  (
    globalThis as {
      __HOMIGO_PARTNER_SENTRY__?: {
        captureException: (e: unknown, c?: { extra?: Record<string, unknown> }) => void;
        addBreadcrumb?: (crumb: { category: string; message: string; level?: string; data?: Record<string, unknown> }) => void;
      };
    }
  ).__HOMIGO_PARTNER_SENTRY__ = {
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

/** Report an error through Sentry when configured; always safe to call. */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  if (!DSN || !initialized) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error("[Homeeigo Partner] error:", error, extra);
    }
    return;
  }
  Sentry.captureException(error, { extra: extra ? (scrubObject(extra) as Record<string, unknown>) : undefined });
}

/** Attach the authenticated partner id to subsequent events. Never attaches PII beyond the id. */
export function setSentryUser(user: { id?: string | null; role?: string | null } | null): void {
  if (!DSN || !initialized) return;
  if (!user?.id) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id });
  if (user.role) Sentry.setTag("role", user.role);
}

/** Whether Sentry is actually configured and running (used by diagnostics, never fabricated). */
export function sentryStatus(): { configured: boolean; initialized: boolean; environment: string } {
  return { configured: !!DSN, initialized, environment: environment() };
}

export { Sentry };
