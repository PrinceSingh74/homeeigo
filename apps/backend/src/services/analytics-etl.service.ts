/**
 * HOMIGO Analytics ETL — PostgreSQL → BigQuery (homigo-497619.homigo_analytics, asia-south1).
 *
 * Loads the operational Postgres data into the analytics warehouse for ML training +
 * geo intelligence. PII-safe: customer/provider identities are carried only as SHA256
 * hashes. Uses ADC (Application Default Credentials) — no key file in the repo.
 *
 * Run on demand:   bun run src/scripts/run-etl.ts
 * Or schedule via the maintenance loop / Cloud Scheduler → this service's runEtl().
 */
import { createHash } from "node:crypto";
import { BigQuery } from "@google-cloud/bigquery";
import prisma from "../lib/prisma";

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const DATASET = process.env.BQ_DATASET ?? "homigo_analytics";
const LOCATION = process.env.BQ_LOCATION ?? "asia-south1";

let _bq: BigQuery | null = null;
function bq(): BigQuery {
  if (!_bq) _bq = new BigQuery({ projectId: PROJECT_ID });
  return _bq;
}

/** PII-safe stable hash for join keys (never store raw customer/provider ids). */
function hash(id: string | null | undefined): string | null {
  if (!id) return null;
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Atomic load of in-memory rows via a streaming load job (no temp files). */
async function loadRows(
  tableId: string,
  rows: Record<string, unknown>[],
  writeDisposition: "WRITE_TRUNCATE" | "WRITE_APPEND",
): Promise<number> {
  if (rows.length === 0) return 0;
  const table = bq().dataset(DATASET).table(tableId);
  await new Promise<void>((resolve, reject) => {
    const stream = table.createWriteStream({
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition,
      location: LOCATION,
      schema: undefined, // use the table's existing schema
    });
    stream.on("error", reject);
    stream.on("job", (job) => job.on("complete", () => resolve()).on("error", reject));
    for (const r of rows) stream.write(Buffer.from(JSON.stringify(r) + "\n"));
    stream.end();
  });
  return rows.length;
}

async function bqQuery(query: string): Promise<void> {
  await bq().query({ query, location: LOCATION });
}

// ---- Dimensions ----------------------------------------------------------
async function syncDimensions(): Promise<{ services: number; zones: number }> {
  const now = new Date().toISOString();
  const services = await prisma.service.findMany({
    select: { id: true, name: true, category: true, basePrice: true, isActive: true },
  });
  const svcRows = services.map((s) => ({
    service_id: s.id, name: s.name, category: s.category, base_price: s.basePrice, is_active: s.isActive, loaded_at: now,
  }));

  const zones = await prisma.geofence.findMany({
    select: { id: true, name: true, city: true, centerLat: true, centerLng: true, radiusMeters: true, surgeMultiplier: true },
  });
  const zoneRows = zones.map((z) => ({
    zone_id: z.id, name: z.name, city: z.city ?? null, center_lat: z.centerLat, center_lng: z.centerLng,
    radius_m: z.radiusMeters, surge_multiplier: z.surgeMultiplier, loaded_at: now,
  }));

  const [a, b] = await Promise.all([
    loadRows("dim_service", svcRows, "WRITE_TRUNCATE"),
    loadRows("dim_zone", zoneRows, "WRITE_TRUNCATE"),
  ]);
  return { services: a, zones: b };
}

// ---- Fact: bookings ------------------------------------------------------
async function syncBookings(sinceDays = 365): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const now = new Date().toISOString();
  const bookings = await prisma.booking.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true, createdAt: true, scheduledDate: true, completedAt: true, userId: true, providerId: true,
      serviceId: true, status: true, baseAmount: true, finalAmount: true, totalAmount: true, eta: true,
      paymentStatus: true,
      address: { select: { latitude: true, longitude: true, city: true } },
      service: { select: { category: true } },
      rating: { select: { stars: true } },
    },
    take: 50_000,
  });

  const rows = bookings.map((b) => {
    const completed = b.status === "COMPLETED";
    const cancelled = b.status.startsWith("CANCELLED");
    // realised travel minutes (completedAt − createdAt), used as the ETA-training label.
    const durMin = b.completedAt ? Math.round(((b.completedAt.getTime() - b.createdAt.getTime()) / 60000) * 10) / 10 : null;
    return {
      booking_id: b.id,
      created_at: iso(b.createdAt),
      scheduled_at: iso(b.scheduledDate),
      completed_at: iso(b.completedAt),
      customer_hash: hash(b.userId),
      provider_hash: hash(b.providerId),
      service_id: b.serviceId,
      category: b.service?.category ?? null,
      city: b.address?.city ?? null,
      zone_id: null,
      status: b.status,
      is_completed: completed,
      is_cancelled: cancelled,
      base_amount: b.baseAmount ?? null,
      final_amount: b.finalAmount ?? null,
      total_amount: b.totalAmount ?? null,
      commission: null, // joined from earnings in a later sync; not needed for the foundation
      eta_min: b.eta ?? null,
      distance_km: null,
      actual_duration_min: durMin != null && durMin > 0 && durMin < 600 ? durMin : null,
      dest_lat: b.address?.latitude ?? null,
      dest_lng: b.address?.longitude ?? null,
      payment_status: b.paymentStatus ?? null,
      rating: b.rating?.stars ?? null,
      weather_temp_c: null,
      weather_surge: null,
      hour_of_day: b.createdAt.getUTCHours(),
      day_of_week: b.createdAt.getUTCDay(),
      loaded_at: now,
    };
  });
  return loadRows("fact_bookings", rows, "WRITE_TRUNCATE");
}

// ---- Fact: GPS pings -----------------------------------------------------
async function syncGpsPings(sinceDays = 30): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const now = new Date().toISOString();
  const pings = await prisma.locationHistory.findMany({
    where: { timestamp: { gte: since } },
    select: { id: true, providerId: true, latitude: true, longitude: true, accuracy: true, timestamp: true, tracking: { select: { bookingId: true } } },
    take: 100_000,
    orderBy: { timestamp: "asc" },
  });
  const rows = pings.map((p) => ({
    ping_id: p.id,
    booking_id: p.tracking?.bookingId ?? null,
    provider_hash: hash(p.providerId),
    ts: iso(p.timestamp),
    lat: p.latitude,
    lng: p.longitude,
    speed_mps: null,
    bearing_deg: null,
    accuracy_m: p.accuracy ?? null,
    loaded_at: now,
  }));
  return loadRows("fact_gps_pings", rows, "WRITE_TRUNCATE");
}

// ---- Fact: geofence events ----------------------------------------------
async function syncGeofenceEvents(sinceDays = 90): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const now = new Date().toISOString();
  const events = await prisma.geofenceEvent.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, geofenceId: true, providerId: true, eventType: true, latitude: true, longitude: true, createdAt: true },
    take: 50_000,
  });
  const rows = events.map((e) => ({
    event_id: e.id, geofence_id: e.geofenceId, provider_hash: hash(e.providerId), event_type: e.eventType,
    ts: iso(e.createdAt), lat: e.latitude, lng: e.longitude, loaded_at: now,
  }));
  return loadRows("fact_geofence_events", rows, "WRITE_TRUNCATE");
}

/** Rebuild the hourly-demand aggregate in-warehouse from fact_bookings. */
async function buildHourlyDemand(): Promise<void> {
  await bqQuery(`
    TRUNCATE TABLE \`${PROJECT_ID}.${DATASET}.agg_hourly_demand\`;
    INSERT INTO \`${PROJECT_ID}.${DATASET}.agg_hourly_demand\`
    SELECT
      COALESCE(zone_id, 'unzoned') AS zone_id,
      city,
      TIMESTAMP_TRUNC(created_at, HOUR) AS hour_ts,
      COUNT(*) AS bookings,
      COUNTIF(is_completed) AS completed,
      COUNTIF(is_cancelled) AS cancelled,
      SUM(total_amount) AS revenue,
      AVG(eta_min) AS avg_eta_min,
      AVG(weather_surge) AS avg_surge,
      CURRENT_TIMESTAMP() AS loaded_at
    FROM \`${PROJECT_ID}.${DATASET}.fact_bookings\`
    GROUP BY zone_id, city, hour_ts;
  `);
}

/** Full ETL run — returns row counts loaded per table. */
export async function runEtl(): Promise<Record<string, number>> {
  const dims = await syncDimensions();
  const [bookings, pings, geofences] = await Promise.all([
    syncBookings(),
    syncGpsPings(),
    syncGeofenceEvents(),
  ]);
  await buildHourlyDemand();
  return { dim_service: dims.services, dim_zone: dims.zones, fact_bookings: bookings, fact_gps_pings: pings, fact_geofence_events: geofences };
}
