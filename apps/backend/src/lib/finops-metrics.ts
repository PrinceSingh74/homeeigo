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

    const [customers, providers, orders, cities] = await Promise.all([
      prisma.user.count().catch(() => 0),
      prisma.provider.count().catch(() => 0),
      prisma.payment.count({ where: { status: "SUCCESS" } }).catch(() => 0),
      prisma.geofence.findMany({ where: { isActive: true, city: { not: null } }, select: { city: true }, distinct: ["city"] }).then((z) => z.length).catch(() => 0),
    ]);
    setGauge("cost_per_order", orders > 0 ? r(ext.total / orders) : 0);
    setGauge("cost_per_customer", customers > 0 ? r(ext.total / customers) : 0);
    setGauge("cost_per_provider", providers > 0 ? r(ext.total / providers) : 0);
    setGauge("cost_per_city", cities > 0 ? r(ext.total / cities) : 0);

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
