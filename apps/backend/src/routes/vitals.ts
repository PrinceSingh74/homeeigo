import { Elysia, t } from "elysia";
import { incCounter, observeHist, setGauge } from "../lib/metrics";

/**
 * Frontend Web Vitals ingestion (browser → backend → Prometheus → Grafana).
 *
 * The browser reporter (Next `useReportWebVitals`) beacons each metric here.
 * LCP/FCP/TTFB/INP arrive in milliseconds; we record them as `*_seconds`
 * histograms (Prometheus convention). CLS is unitless. A `web_vitals_reports_total`
 * counter tracks ingestion volume, and a last-value gauge powers single-stat panels.
 */
const SECONDS_METRICS: Record<string, string> = {
  LCP: "web_vitals_lcp_seconds",
  INP: "web_vitals_inp_seconds",
  FCP: "web_vitals_fcp_seconds",
  TTFB: "web_vitals_ttfb_seconds",
  // Legacy FID — still emitted by some Next.js builds; map to INP histogram bucket.
  FID: "web_vitals_inp_seconds",
  // Custom navigation metrics (soft route change + full page load) — same ms→seconds path.
  ROUTECHANGE: "web_vitals_route_change_seconds",
  PAGELOAD: "web_vitals_page_load_seconds",
};

// Bounded RUM dimensions — server-side whitelist so a spoofed/garbage beacon can never explode
// Prometheus label cardinality (device × network × route stays a fixed, small product).
const DEVICES = new Set(["desktop", "android", "iphone", "ipad", "tablet", "other"]);
const NETWORKS = new Set(["4g", "3g", "2g", "slow-2g", "offline", "unknown"]);
const ROUTES = new Set([
  "/", "/services", "/bookings", "/wallet", "/profile", "/membership", "/book", "/ai",
  "/providers", "/notifications", "/settings", "/support", "/referrals", "/login", "/signup",
  "/verify-otp", "cold-start", "mobile", "other",
]);
const bounded = (v: unknown, set: Set<string>, fallback: string) =>
  typeof v === "string" && set.has(v) ? v : fallback;

export const vitalsRoutes = new Elysia({ name: "vitals-routes" }).post(
  "/api/vitals",
  ({ body, set }) => {
    const name = String(body.name ?? "").toUpperCase();
    const value = Number(body.value);
    if (!Number.isFinite(value)) {
      set.status = 400;
      return { success: false, error: "invalid value" };
    }
    const rating = typeof body.rating === "string" ? body.rating : "unknown";
    const device = bounded(body.device, DEVICES, "other");
    const network = bounded(body.network, NETWORKS, "unknown");
    const route = bounded(body.route, ROUTES, "other");
    // Counter carries the full segmentation (device × network × route × rating) for field RUM.
    incCounter("web_vitals_reports_total", { metric: name, rating, device, network, route });
    const seg = { metric: name, device, network, route };

    if (name === "CLS") {
      // CLS is a unitless layout-shift score (small floats).
      observeHist("web_vitals_cls", value, seg);
      setGauge("web_vitals_cls_last", value);
    } else if (SECONDS_METRICS[name]) {
      const seconds = value / 1000; // browser reports ms
      observeHist(SECONDS_METRICS[name], seconds, seg);
      setGauge(`${SECONDS_METRICS[name]}_last`, seconds);
    } else {
      // Best-effort RUM — unknown metrics must not surface as client-visible 400s.
      incCounter("web_vitals_ignored_total", { metric: name });
      return { success: true, ignored: true };
    }
    return { success: true };
  },
  {
    body: t.Object({
      name: t.String(),
      value: t.Number(),
      id: t.Optional(t.String()),
      rating: t.Optional(t.String()),
      navigationType: t.Optional(t.String()),
      device: t.Optional(t.String()),
      network: t.Optional(t.String()),
      route: t.Optional(t.String()),
    }),
  },
);
