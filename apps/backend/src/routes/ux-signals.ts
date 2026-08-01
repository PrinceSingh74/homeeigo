import { Elysia, t } from "elysia";
import { incCounter, observeHist } from "../lib/metrics";

/**
 * Customer-experience / satisfaction signals (browser → Prometheus). Complements Web Vitals with
 * BEHAVIOURAL signals that reveal perceived friction the timing metrics miss:
 *   • nav_success / nav_abandoned — did a started navigation reach visible content?
 *   • rapid_reclick               — user tapped the same nav ≥2× quickly (impatience)
 *   • back_button                 — popstate (often a "that wasn't what I wanted")
 *   • exit_during_loading         — left the page while a navigation was still pending
 * Plus `scroll_fps` (frame-rate during scroll). All dimensions are server-whitelisted (bounded).
 */
const SIGNALS = new Set([
  "nav_success", "nav_abandoned", "rapid_reclick", "back_button", "exit_during_loading",
  "offline_enqueue", "offline_replay",
  "jwt_refresh", "realtime_reconnect", "heartbeat_timeout", "queue_drain", "cache_invalidation",
  "startup_hydration", "startup_bootstrap", "startup_splash_hide", "startup_interactive",
  "startup_budget_exceeded",
  "startup_failure", "auth_bootstrap_failure", "hydration_timeout",
]);
const STARTUP_HIST_SIGNALS = new Set([
  "startup_hydration", "startup_bootstrap", "startup_splash_hide", "startup_interactive",
  "startup_budget_exceeded",
]);
const STARTUP_PHASE_SIGNALS = new Set([
  "startup_duration", "hydration_duration", "bootstrap_duration",
  "splash_duration", "interactive_duration", "auth_duration",
]);
const STARTUP_FAILURE_SIGNALS = new Set([
  "startup_failure", "auth_bootstrap_failure", "hydration_timeout",
]);
const PLATFORMS = new Set(["ios", "android", "web", "other"]);
const DEVICES = new Set(["desktop", "android", "iphone", "ipad", "tablet", "other"]);
const NETWORKS = new Set(["4g", "3g", "2g", "slow-2g", "offline", "unknown"]);
const ROUTES = new Set([
  "/", "/services", "/bookings", "/wallet", "/profile", "/membership", "/book", "/ai",
  "/providers", "/notifications", "/settings", "/support", "/referrals", "/login", "/signup", "mobile", "other",
]);
const bounded = (v: unknown, set: Set<string>, fb: string) =>
  typeof v === "string" && set.has(v) ? v : fb;

export const uxSignalsRoutes = new Elysia({ name: "ux-signals-routes" }).post(
  "/api/ux-signals",
  ({ body, set }) => {
    const platform = bounded(body.platform, PLATFORMS, "other");
    const version = typeof body.version === "string" && body.version.length <= 32 ? body.version : "unknown";
    const deviceType = bounded(body.device_type, DEVICES, "other");
    const seg = {
      device: bounded(body.device, DEVICES, deviceType),
      network: bounded(body.network, NETWORKS, "unknown"),
      route: bounded(body.route, ROUTES, "other"),
    };
    const startupSeg = { platform, version, device_type: deviceType };
    const signal = String(body.signal ?? "");

    if (signal === "scroll_fps") {
      const fps = Number(body.value);
      if (!Number.isFinite(fps) || fps <= 0 || fps > 240) {
        set.status = 400;
        return { success: false, error: "invalid fps" };
      }
      observeHist("ux_scroll_fps", fps, seg);
      return { success: true };
    }

    if (STARTUP_PHASE_SIGNALS.has(signal)) {
      const ms = Number(body.value);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) {
        set.status = 400;
        return { success: false, error: "invalid startup duration" };
      }
      observeHist("homigo_mobile_startup_duration_seconds", ms / 1000, {
        phase: signal.replace(/_duration$/, ""),
        ...startupSeg,
      });
      incCounter("homigo_mobile_startup_observed_total", { phase: signal, ...startupSeg });
      return { success: true };
    }

    if (STARTUP_FAILURE_SIGNALS.has(signal)) {
      const counterName =
        signal === "startup_failure"
          ? "homigo_mobile_startup_failure_total"
          : signal === "auth_bootstrap_failure"
            ? "homigo_mobile_auth_bootstrap_failure_total"
            : "homigo_mobile_hydration_timeout_total";
      incCounter(counterName, startupSeg, Number(body.value) || 1);
      return { success: true };
    }

    if (STARTUP_HIST_SIGNALS.has(signal)) {
      const ms = Number(body.value);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) {
        set.status = 400;
        return { success: false, error: "invalid startup duration" };
      }
      observeHist("mobile_startup_duration_seconds", ms / 1000, { signal, ...seg });
      incCounter("mobile_startup_signal_total", { signal, ...seg });
      return { success: true };
    }

    if (!SIGNALS.has(signal)) {
      set.status = 400;
      return { success: false, error: "unknown signal" };
    }
    incCounter("ux_signal_total", { signal, ...seg });
    return { success: true };
  },
  {
    body: t.Object({
      signal: t.String(),
      value: t.Optional(t.Number()),
      device: t.Optional(t.String()),
      network: t.Optional(t.String()),
      route: t.Optional(t.String()),
      platform: t.Optional(t.String()),
      version: t.Optional(t.String()),
      device_type: t.Optional(t.String()),
      budget: t.Optional(t.String()),
    }),
  },
);
