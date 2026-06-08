import { Elysia } from "elysia";
import { recordHttpRequest } from "../lib/metrics";

/**
 * Records HTTP request count + latency into the Prometheus registry (lib/metrics).
 * Mirrors request-logger's timing approach: start captured in `onRequest`
 * (pre-routing, per-Request WeakMap), recorded in a global `onAfterHandle`.
 *
 * Skips infra/observability paths so scrapers and probes don't inflate the
 * application's own request metrics.
 */
const startTimes = new WeakMap<Request, number>();
const SKIP = new Set(["/metrics", "/ready", "/health"]);

export const metricsPlugin = new Elysia({ name: "metrics" })
  .onRequest(({ request }) => {
    startTimes.set(request, Date.now());
  })
  .onAfterHandle({ as: "global" }, ({ request, set }) => {
    const path = new URL(request.url).pathname;
    if (SKIP.has(path) || path.startsWith("/ws") || path.startsWith("/swagger")) return;
    const start = startTimes.get(request);
    const durationSec = start !== undefined ? (Date.now() - start) / 1000 : 0;
    const status = typeof set.status === "number" ? set.status : 200;
    recordHttpRequest(request.method, path, status, durationSec);
  });
