/**
 * Partner Navigation telemetry (Phase-4 final track).
 * Client-side nav events (session/reroute/arrival/pickup/drop) → Prometheus, so the
 * Partner Navigation dashboard reflects real on-road behaviour. VENDOR only.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { incCounter, observeHist } from "../lib/metrics";

const COUNTER: Record<string, string> = {
  session: "partner_nav_sessions_total",
  reroute: "partner_nav_reroutes_total",
  arrival: "partner_nav_arrivals_total",
  pickup: "partner_nav_pickups_total",
  drop: "partner_nav_drops_total",
};

export const partnerNavRoutes = new Elysia({ prefix: "/api/partner/nav" })
  .use(authPlugin)
  .post("/telemetry", async ({ requireProvider, body }) => {
    requireProvider();
    const b = body as { type: string; latencyMs?: number; gpsAccuracy?: number; etaErrorMin?: number };
    if (COUNTER[b.type]) incCounter(COUNTER[b.type]);
    if (typeof b.latencyMs === "number") observeHist("partner_nav_latency_seconds", b.latencyMs / 1000);
    if (typeof b.gpsAccuracy === "number") observeHist("partner_nav_gps_accuracy_meters", b.gpsAccuracy);
    if (typeof b.etaErrorMin === "number") observeHist("partner_nav_eta_error_min", Math.abs(b.etaErrorMin));
    return { success: true };
  }, {
    body: t.Object({
      type: t.String(),
      latencyMs: t.Optional(t.Number()),
      gpsAccuracy: t.Optional(t.Number()),
      etaErrorMin: t.Optional(t.Number()),
    }),
  });
