/**
 * Enterprise FinOps metrics — REAL cost computed from live usage counters ×
 * configured per-call pricing (published Google/OpenWeather rates, env-overridable).
 * Registered at boot. No mock data: call counts are real; only the unit prices are
 * constants (clearly the pricing inputs, not fabricated usage).
 *
 *   maps_cost_usd_total{endpoint}      ← google_api_calls_total × rate
 *   weather_cost_usd_total             ← weather_api_calls_total × rate
 *   external_api_cost_usd_total        ← maps + weather
 *   cost_per_booking_usd               ← external cost ÷ bookings
 *   cost_per_customer / cost_per_order ← external cost ÷ ALL users / ALL successful payments
 *                                        (operational, all-traffic — see finOpsDenominators)
 *   cache_hit_ratio{domain}            ← hits ÷ (hits+misses)
 *   cache_saved_calls_total{domain}    ← cache hits (each = one avoided upstream call)
 *   cache_savings_usd_total{domain}    ← saved weather/maps calls × rate
 *   pg_storage_bytes                   ← pg_database_size
 *   pg_slow_queries                    ← pg_stat_statements mean_exec_time > threshold
 *   pg_query_mean_ms_max               ← slowest statement mean time
 *   pg_statements_tracked              ← distinct statements
 */
import prisma from "./prisma";
import { redisClient } from "./redis";
import { setGauge, registerScrapeSampler, sumCounter, sumCounterWhere } from "./metrics";

/** Total external API spend (USD) from real call counts × unit price. Shared by samplers. */
function externalCostUsd(): { maps: number; weather: number; total: number } {
  let maps = 0;
  for (const ep of ["geocode", "place", "directions", "distancematrix"] as const) {
    maps += sumCounterWhere("google_api_calls_total", `endpoint=${ep}`) * PRICE[ep];
  }
  const weather = sumCounter("weather_api_calls_total") * PRICE.weather;
  return { maps, weather, total: maps + weather };
}

// Published unit prices (USD/call), override via env. Google Maps $5/1k = $0.005; OpenWeather paid ~$0.0015.
const PRICE = {
  geocode: Number(process.env.COST_MAPS_GEOCODE_USD ?? 0.005),
  place: Number(process.env.COST_MAPS_PLACES_USD ?? 0.005),
  directions: Number(process.env.COST_MAPS_DIRECTIONS_USD ?? 0.005),
  distancematrix: Number(process.env.COST_MAPS_DISTANCEMATRIX_USD ?? 0.005),
  weather: Number(process.env.COST_WEATHER_USD ?? 0.0015),
};
const SLOW_MS = Number(process.env.PG_SLOW_QUERY_MS ?? 50);

/** USD per unit, 4 dp. Zero when there is nothing to divide by, so a gauge is never NaN or Infinity. */
export function unitCost(totalUsd: number, units: number): number {
  if (!Number.isFinite(totalUsd) || !Number.isFinite(units) || units <= 0) return 0;
  return Math.round((totalUsd / units) * 10000) / 10000;
}

/**
 * Denominators for the cost-per-X gauges. Owner decision (Phase 15): these are operational,
 * ALL-TRAFFIC counts and are never filtered by `analyticsWhere()`. External API spend is incurred
 * by every request (real, test, fixture, synthetic), so dividing it by business units only would
 * charge all traffic's cost to the business population.
 *
 *   users              every `users` row, any role — `cost_per_customer` is cost per USER
 *   successfulPayments every gateway payment in SUCCESS — `cost_per_order` excludes wallet-only orders
 */
export async function finOpsDenominators(): Promise<{ users: number; providers: number; successfulPayments: number; activeCities: number }> {
  const [users, providers, successfulPayments, activeCities] = await Promise.all([
    prisma.user.count().catch(() => 0),
    prisma.provider.count().catch(() => 0),
    prisma.payment.count({ where: { status: "SUCCESS" } }).catch(() => 0),
    prisma.geofence.findMany({ where: { isActive: true, city: { not: null } }, select: { city: true }, distinct: ["city"] }).then((z) => z.length).catch(() => 0),
  ]);
  return { users, providers, successfulPayments, activeCities };
}

export function registerFinOpsSamplers(): void {
  // --- Maps + Weather API cost (real call counts × price) ---
  registerScrapeSampler(async () => {
    let mapsCost = 0;
    for (const ep of ["geocode", "place", "directions", "distancematrix"] as const) {
      const calls = sumCounterWhere("google_api_calls_total", `endpoint=${ep}`);
      const cost = calls * PRICE[ep];
      setGauge("maps_cost_usd_total", Math.round(cost * 10000) / 10000, { endpoint: ep });
      mapsCost += cost;
    }
    const weatherCalls = sumCounter("weather_api_calls_total");
    const weatherCost = weatherCalls * PRICE.weather;
    setGauge("weather_cost_usd_total", Math.round(weatherCost * 10000) / 10000);

    const external = mapsCost + weatherCost;
    setGauge("external_api_cost_usd_total", Math.round(external * 10000) / 10000);

    const bookings = sumCounter("booking_created_total");
    setGauge("cost_per_booking_usd", bookings > 0 ? Math.round((external / bookings) * 10000) / 10000 : 0);
  });

  // --- Cache savings (each hit = one avoided upstream call) ---
  registerScrapeSampler(async () => {
    for (const domain of ["weather", "catalog", "heatmap", "ops-map"]) {
      const hits = sumCounterWhere("cache_hits_total", `domain=${domain}`);
      const misses = sumCounterWhere("cache_misses_total", `domain=${domain}`);
      const total = hits + misses;
      setGauge("cache_hit_ratio", total > 0 ? Math.round((hits / total) * 1000) / 1000 : 0, { domain });
      setGauge("cache_saved_calls_total", hits, { domain });
      // Weather cache hits avoid a billable OpenWeather call.
      if (domain === "weather") setGauge("cache_savings_usd_total", Math.round(hits * PRICE.weather * 10000) / 10000, { domain });
    }
  });

  // --- PostgreSQL storage + slow-query economics ---
  registerScrapeSampler(async () => {
    const size = await prisma.$queryRawUnsafe<Array<{ s: bigint }>>(
      `SELECT pg_database_size(current_database()) AS s`,
    ).catch(() => [] as Array<{ s: bigint }>);
    if (size[0]) setGauge("pg_storage_bytes", Number(size[0].s));

    const slow = await prisma.$queryRawUnsafe<Array<{ n: number; mx: number; tracked: number }>>(
      `SELECT count(*) FILTER (WHERE mean_exec_time > ${SLOW_MS})::int AS n,
              coalesce(max(mean_exec_time),0) AS mx, count(*)::int AS tracked
       FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat%'`,
    ).catch(() => [] as Array<{ n: number; mx: number; tracked: number }>);
    if (slow[0]) {
      setGauge("pg_slow_queries", slow[0].n);
      setGauge("pg_query_mean_ms_max", Math.round(slow[0].mx * 100) / 100);
      setGauge("pg_statements_tracked", slow[0].tracked);
    }
    // DB query cost proxy = total cumulative exec time (ms) across tracked statements.
    const qcost = await prisma.$queryRawUnsafe<Array<{ t: number }>>(
      `SELECT coalesce(sum(total_exec_time),0) AS t FROM pg_stat_statements`,
    ).catch(() => [] as Array<{ t: number }>);
    if (qcost[0]) setGauge("db_query_cost_ms_total", Math.round(qcost[0].t));
  });

  // --- Cost-per-X (real DB denominators) + Maps/Redis rollups ---
  registerScrapeSampler(async () => {
    const ext = externalCostUsd();
    const r = (n: number) => Math.round(n * 10000) / 10000;
    setGauge("external_api_cost_usd_total", r(ext.total));

    const d = await finOpsDenominators();
    setGauge("cost_per_order", unitCost(ext.total, d.successfulPayments));
    setGauge("cost_per_customer", unitCost(ext.total, d.users));
    setGauge("cost_per_provider", unitCost(ext.total, d.providers));
    setGauge("cost_per_city", unitCost(ext.total, d.activeCities));

    // Maps economics rollups (spec metric names).
    setGauge("maps_requests_total", sumCounter("google_api_calls_total"));
    setGauge("maps_cost_total", r(ext.maps));
    setGauge("maps_cache_savings", sumCounterWhere("cache_saved_calls_total", "domain=catalog") + sumCounterWhere("cache_saved_calls_total", "domain=heatmap"));
    // Weather economics (spec metric names).
    setGauge("weather_cost_total", r(ext.weather));
    const wHits = sumCounterWhere("cache_hits_total", "domain=weather");
    const wMiss = sumCounterWhere("cache_misses_total", "domain=weather");
    setGauge("weather_cache_hit_rate", wHits + wMiss > 0 ? Math.round((wHits / (wHits + wMiss)) * 1000) / 1000 : 0);

    // Redis economics.
    const rm = await redisClient.getMetrics().catch(() => null);
    if (rm) {
      setGauge("redis_memory_bytes", rm.usedMemoryBytes ?? 0);
      setGauge("redis_evicted_keys", rm.evictedKeys ?? 0);
      setGauge("redis_hit_rate", rm.hitRate);
    }
  });
}
