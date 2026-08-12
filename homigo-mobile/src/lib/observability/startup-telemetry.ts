import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  checkStartupBudgets,
  exportStartupDiagnostics,
  getFlameTimeline,
  getStartupTimeline,
  type BudgetViolation,
} from "@/lib/startup-trace";
import { deliverTelemetryBeacon, reportError, reportVital } from "@/lib/observability/telemetry";

type SentryBreadcrumb = {
  addBreadcrumb?: (crumb: {
    category: string;
    message: string;
    level?: string;
    data?: Record<string, unknown>;
  }) => void;
};

export type StartupMetricPhase =
  | "startup_duration"
  | "hydration_duration"
  | "bootstrap_duration"
  | "splash_duration"
  | "interactive_duration"
  | "auth_duration";

function deviceType(): "android" | "iphone" | "ipad" | "other" {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return Platform.isPad ? "ipad" : "iphone";
  return "other";
}

function startupLabels(): { platform: string; version: string; device_type: string } {
  return {
    platform: Platform.OS,
    version: Constants.expoConfig?.version ?? "unknown",
    device_type: deviceType(),
  };
}

function reportStartupMetric(phase: StartupMetricPhase, valueMs: number): void {
  if (!Number.isFinite(valueMs) || valueMs < 0) return;
  void deliverTelemetryBeacon("/api/ux-signals", {
    signal: phase,
    value: valueMs,
    ...startupLabels(),
    device: deviceType(),
    network: "unknown",
    route: "mobile",
  });
}

function reportStartupCounter(
  signal: "startup_failure" | "auth_bootstrap_failure" | "hydration_timeout",
): void {
  void deliverTelemetryBeacon("/api/ux-signals", {
    signal,
    value: 1,
    ...startupLabels(),
    device: deviceType(),
    network: "unknown",
    route: "mobile",
  });
}

/** Publish startup milestones → durable queue → backend RUM. */
export function publishStartupObservability(): void {
  const timeline = getStartupTimeline();
  const violations = checkStartupBudgets();

  const since = (marker: string): number | undefined =>
    timeline.find((e) => e.marker === marker)?.sinceStartMs;

  const span = (start: string, end: string): number | undefined => {
    const a = since(start);
    const b = since(end);
    if (a == null || b == null) return undefined;
    return b - a;
  };

  const hydrationMs = span("HYDRATION_START", "HYDRATION_END") ?? since("HYDRATION_END");
  const bootstrapMs = span("BOOTSTRAP_START", "BOOTSTRAP_END") ?? since("BOOTSTRAP_END");
  const authMs = span("BOOTSTRAP_START", "AUTH_READY");
  const splashMs = since("SPLASH_HIDE");
  const interactiveMs = since("INTERACTIVE");
  const startupMs = interactiveMs;

  if (hydrationMs != null && hydrationMs >= 0) reportStartupMetric("hydration_duration", hydrationMs);
  if (bootstrapMs != null && bootstrapMs >= 0) reportStartupMetric("bootstrap_duration", bootstrapMs);
  if (authMs != null && authMs >= 0) reportStartupMetric("auth_duration", authMs);
  if (splashMs != null) reportStartupMetric("splash_duration", splashMs);
  if (interactiveMs != null) {
    reportStartupMetric("interactive_duration", interactiveMs);
    reportStartupMetric("startup_duration", startupMs ?? interactiveMs);
    reportVital("PAGELOAD", interactiveMs, "cold-start");
  }

  if (hydrationMs != null && hydrationMs >= 0) reportLegacyStartup("startup_hydration", hydrationMs);
  if (bootstrapMs != null && bootstrapMs >= 0) reportLegacyStartup("startup_bootstrap", bootstrapMs);
  if (splashMs != null) reportLegacyStartup("startup_splash_hide", splashMs);
  if (interactiveMs != null) reportLegacyStartup("startup_interactive", interactiveMs);
  for (const v of violations) {
    reportLegacyStartup("startup_budget_exceeded", v.actualMs, v.budget);
    reportStartupCounter("startup_failure");
  }

  const authReady = timeline.find((e) => e.marker === "AUTH_READY");
  if (authReady?.detail?.includes("error") || authReady?.detail === "deadline-unauthenticated") {
    reportStartupCounter("auth_bootstrap_failure");
  }

  const sentry = (globalThis as { __HOMIGO_SENTRY__?: SentryBreadcrumb }).__HOMIGO_SENTRY__;
  sentry?.addBreadcrumb?.({
    category: "startup",
    level: violations.length ? "warning" : "info",
    message: "Homeeigo mobile cold start",
    data: {
      timeline: timeline.map((e) => ({ m: e.marker, ms: e.sinceStartMs, d: e.detail })),
      violations: violations.map((v) => `${v.name}:${v.actualMs}/${v.budgetMs}`),
      labels: startupLabels(),
    },
  });

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.info("[Homeeigo STARTUP] diagnostics\n" + getFlameTimeline());
  }

  exportStartupDiagnostics();
}

function reportLegacyStartup(
  signal:
    | "startup_hydration"
    | "startup_bootstrap"
    | "startup_splash_hide"
    | "startup_interactive"
    | "startup_budget_exceeded",
  valueMs: number,
  budget?: string,
): void {
  void deliverTelemetryBeacon("/api/ux-signals", {
    signal,
    value: valueMs,
    device: deviceType(),
    network: "unknown",
    route: "mobile",
    ...(budget ? { budget } : {}),
  });
}

export function reportHydrationTimeout(): void {
  reportStartupCounter("hydration_timeout");
}

export function reportInteractiveColdStart(): void {
  try {
    publishStartupObservability();
  } catch (error) {
    reportError(error, { phase: "startup-telemetry" });
  }
}

export type { BudgetViolation };
