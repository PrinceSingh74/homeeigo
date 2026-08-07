/**
 * ETL job handlers — PostgreSQL → BigQuery per domain.
 * PII-safe: identities hashed; no raw emails/phones in warehouse rows.
 */
import prisma from "../../../src/lib/prisma";
import { hashPii } from "../pii";
import { fqTable, iso, loadRows, bqQuery } from "../bq-client";
import type { EtlJobContext, EtlJobResult, EtlJobRegistry } from "../types";
import { ANALYTICS_CONFIG } from "../../config";

async function syncBookings(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const bookings = await prisma.booking.findMany({
    where: { updatedAt: { gte: since }, ...(ctx.cursorId ? { id: { gt: ctx.cursorId } } : {}) },
    select: {
      id: true, createdAt: true, updatedAt: true, scheduledDate: true, completedAt: true,
      userId: true, providerId: true, serviceId: true, status: true, baseAmount: true,
      finalAmount: true, totalAmount: true, eta: true, paymentStatus: true,
      address: { select: { latitude: true, longitude: true, city: true } },
      service: { select: { category: true } },
      rating: { select: { stars: true } },
    },
    take: ctx.batchSize,
    orderBy: { id: "asc" },
  });
  const rows = bookings.map((b) => {
    const durMin = b.completedAt ? Math.round(((b.completedAt.getTime() - b.createdAt.getTime()) / 60000) * 10) / 10 : null;
    return {
      booking_id: b.id, created_at: iso(b.createdAt), updated_at: iso(b.updatedAt),
      scheduled_at: iso(b.scheduledDate), completed_at: iso(b.completedAt),
      customer_hash: hashPii(b.userId), provider_hash: hashPii(b.providerId),
      service_id: b.serviceId, category: b.service?.category ?? null,
      city: b.address?.city ?? null, zone_id: null, status: b.status,
      is_completed: b.status === "COMPLETED", is_cancelled: b.status.startsWith("CANCELLED"),
      base_amount: b.baseAmount, final_amount: b.finalAmount, total_amount: b.totalAmount,
      eta_min: b.eta, actual_duration_min: durMin != null && durMin > 0 && durMin < 600 ? durMin : null,
      dest_lat: b.address?.latitude, dest_lng: b.address?.longitude,
      payment_status: b.paymentStatus, rating: b.rating?.stars ?? null,
      hour_of_day: b.createdAt.getUTCHours(), day_of_week: b.createdAt.getUTCDay(), loaded_at: now,
    };
  });
  const loaded = await loadRows("curated", "fact_bookings", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  const high = bookings.length ? bookings[bookings.length - 1].updatedAt : ctx.highWatermark;
  return { rowsExtracted: bookings.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: high, cursorEnd: bookings.at(-1)?.id ?? ctx.cursorId };
}

async function syncPartners(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(0);
  const now = new Date().toISOString();
  const providers = await prisma.provider.findMany({
    where: { updatedAt: { gte: since } },
    select: {
      id: true, userId: true, isVerified: true, isActive: true, rating: true,
      totalBookings: true, acceptanceRate: true, cancellationRate: true,
      serviceRegions: true, createdAt: true, updatedAt: true,
    },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = providers.map((p) => ({
    provider_hash: hashPii(p.id), user_hash: hashPii(p.userId), is_verified: p.isVerified,
    is_active: p.isActive, rating: p.rating, total_bookings: p.totalBookings,
    acceptance_rate: p.acceptanceRate, cancellation_rate: p.cancellationRate,
    city: p.serviceRegions[0] ?? null, created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "dim_partner", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: providers.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: providers.at(-1)?.updatedAt ?? ctx.highWatermark, cursorEnd: providers.at(-1)?.id ?? null };
}

async function syncPayments(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const payments = await prisma.payment.findMany({
    where: { updatedAt: { gte: since } },
    select: { id: true, bookingId: true, userId: true, amount: true, amountPaise: true, status: true, paymentMethod: true, createdAt: true, updatedAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = payments.map((p) => ({
    payment_id: p.id, booking_id: p.bookingId, customer_hash: hashPii(p.userId),
    amount: p.amount, amount_paise: p.amountPaise?.toString(), status: p.status, method: p.paymentMethod,
    created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_payments", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: payments.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: payments.at(-1)?.updatedAt ?? ctx.highWatermark, cursorEnd: payments.at(-1)?.id ?? null };
}

async function syncWallet(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const txns = await prisma.walletTransaction.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, amount: true, type: true, description: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = txns.map((t) => ({
    txn_id: t.id, customer_hash: hashPii(t.userId), amount: t.amount, type: t.type,
    description: t.description?.slice(0, 100), created_at: iso(t.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_wallet_txns", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: txns.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: txns.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: txns.at(-1)?.id ?? null };
}

async function syncLedger(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const entries = await prisma.ledgerEntry.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, accountId: true, debitPaise: true, creditPaise: true, createdAt: true, journalId: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = entries.map((e) => ({
    entry_id: e.id, account_id: e.accountId, journal_id: e.journalId,
    debit_paise: e.debitPaise?.toString(), credit_paise: e.creditPaise?.toString(),
    created_at: iso(e.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_ledger_entries", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: entries.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: entries.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: entries.at(-1)?.id ?? null };
}

async function syncFraud(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 90 * 86400_000);
  const now = new Date().toISOString();
  const signals = await prisma.fraudSignal.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, eventType: true, referenceId: true, referenceType: true, city: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = signals.map((s) => ({
    signal_id: s.id, customer_hash: hashPii(s.userId), signal_type: s.eventType,
    reference_id: s.referenceId, reference_type: s.referenceType, city: s.city,
    created_at: iso(s.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_fraud_signals", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: signals.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: signals.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: signals.at(-1)?.id ?? null };
}

async function syncLocation(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(Date.now() - 30 * 86400_000) : ctx.lowWatermark ?? new Date(Date.now() - 30 * 86400_000);
  const now = new Date().toISOString();
  const pings = await prisma.locationHistory.findMany({
    where: { timestamp: { gte: since } },
    select: { id: true, providerId: true, latitude: true, longitude: true, accuracy: true, timestamp: true, tracking: { select: { bookingId: true } } },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = pings.map((p) => ({
    ping_id: p.id, booking_id: p.tracking?.bookingId, provider_hash: hashPii(p.providerId),
    ts: iso(p.timestamp), lat: p.latitude, lng: p.longitude, accuracy_m: p.accuracy, loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_gps_pings", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: pings.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: pings.at(-1)?.timestamp ?? ctx.highWatermark, cursorEnd: pings.at(-1)?.id ?? null };
}

async function syncCustomers(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(0);
  const now = new Date().toISOString();
  const users = await prisma.user.findMany({
    where: { updatedAt: { gte: since }, role: "CUSTOMER" },
    select: { id: true, createdAt: true, updatedAt: true, preferredCity: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = users.map((u) => ({
    customer_hash: hashPii(u.id), city: u.preferredCity, created_at: iso(u.createdAt), updated_at: iso(u.updatedAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "dim_customer", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: users.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: users.at(-1)?.updatedAt ?? ctx.highWatermark, cursorEnd: users.at(-1)?.id ?? null };
}

async function syncNotifications(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 90 * 86400_000);
  const now = new Date().toISOString();
  const items = await prisma.notification.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, type: true, title: true, isRead: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = items.map((n) => ({
    notification_id: n.id, user_hash: hashPii(n.userId), type: n.type, is_read: n.isRead,
    created_at: iso(n.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("raw", "fact_notifications", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: items.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: items.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: items.at(-1)?.id ?? null };
}

async function syncReviews(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const ratings = await prisma.rating.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, bookingId: true, userId: true, providerId: true, stars: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = ratings.map((r) => ({
    review_id: r.id, booking_id: r.bookingId, customer_hash: hashPii(r.userId),
    provider_hash: hashPii(r.providerId), stars: r.stars, created_at: iso(r.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_reviews", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: ratings.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: ratings.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: ratings.at(-1)?.id ?? null };
}

async function syncReferrals(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(0);
  const now = new Date().toISOString();
  const txns = await prisma.referralTransaction.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, referrerId: true, refereeId: true, status: true, fraudFlagged: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = txns.map((t) => ({
    referral_id: t.id, referrer_hash: hashPii(t.referrerId), referred_hash: hashPii(t.refereeId),
    status: t.status, fraud_flagged: t.fraudFlagged, created_at: iso(t.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_referrals", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: txns.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: txns.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: txns.at(-1)?.id ?? null };
}

async function syncHcoin(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 365 * 86400_000);
  const now = new Date().toISOString();
  const txns = await prisma.hCoinTransaction.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, amount: true, type: true, reason: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = txns.map((t) => ({
    txn_id: t.id, customer_hash: hashPii(t.userId), amount: t.amount, type: t.type,
    reason: t.reason?.slice(0, 100), created_at: iso(t.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("curated", "fact_hcoin_txns", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: txns.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: txns.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: txns.at(-1)?.id ?? null };
}

async function syncAutomation(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 90 * 86400_000);
  const now = new Date().toISOString();
  const jobs = await prisma.scheduledJob.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, jobType: true, status: true, runAt: true, attempts: true, createdAt: true, completedAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = jobs.map((j) => ({
    job_id: j.id, job_type: j.jobType, status: j.status, run_at: iso(j.runAt),
    attempts: j.attempts, created_at: iso(j.createdAt), completed_at: iso(j.completedAt), loaded_at: now,
  }));
  const loaded = await loadRows("raw", "fact_scheduled_jobs", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: jobs.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: jobs.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: jobs.at(-1)?.id ?? null };
}

async function syncEvents(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 30 * 86400_000);
  const now = new Date().toISOString();
  const events = await prisma.eventOutbox.findMany({
    where: { createdAt: { gte: since }, status: "PUBLISHED" },
    select: { id: true, eventId: true, eventType: true, aggregateType: true, aggregateId: true, publishedAt: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = events.map((e) => ({
    outbox_id: e.id, event_id: e.eventId, event_type: e.eventType,
    aggregate_type: e.aggregateType, aggregate_id: e.aggregateId,
    published_at: iso(e.publishedAt), created_at: iso(e.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("raw", "fact_domain_events", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: events.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: events.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: events.at(-1)?.id ?? null };
}

async function syncAudit(ctx: EtlJobContext): Promise<EtlJobResult> {
  const since = ctx.runMode === "FULL" ? new Date(0) : ctx.lowWatermark ?? new Date(Date.now() - 90 * 86400_000);
  const now = new Date().toISOString();
  const logs = await prisma.enterpriseAuditLog.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, action: true, actor: true, actorType: true, resource: true, resourceId: true, createdAt: true },
    take: ctx.batchSize, orderBy: { id: "asc" },
  });
  const rows = logs.map((l) => ({
    audit_id: l.id, action: l.action, actor_hash: hashPii(l.actor), actor_type: l.actorType,
    resource_type: l.resource, resource_id: l.resourceId, created_at: iso(l.createdAt), loaded_at: now,
  }));
  const loaded = await loadRows("raw", "fact_audit_logs", rows, ctx.runMode === "FULL" ? "WRITE_TRUNCATE" : "WRITE_APPEND");
  return { rowsExtracted: logs.length, rowsLoaded: loaded, lowWatermark: since, highWatermark: logs.at(-1)?.createdAt ?? ctx.highWatermark, cursorEnd: logs.at(-1)?.id ?? null };
}

async function syncDimensions(_ctx: EtlJobContext): Promise<EtlJobResult> {
  const now = new Date().toISOString();
  const services = await prisma.service.findMany({ select: { id: true, name: true, category: true, basePrice: true, isActive: true } });
  const zones = await prisma.geofence.findMany({ select: { id: true, name: true, city: true, centerLat: true, centerLng: true, radiusMeters: true, surgeMultiplier: true } });
  const svcRows = services.map((s) => ({ service_id: s.id, name: s.name, category: s.category, base_price: s.basePrice, is_active: s.isActive, loaded_at: now }));
  const zoneRows = zones.map((z) => ({ zone_id: z.id, name: z.name, city: z.city, center_lat: z.centerLat, center_lng: z.centerLng, radius_m: z.radiusMeters, surge_multiplier: z.surgeMultiplier, loaded_at: now }));
  await loadRows("curated", "dim_service", svcRows, "WRITE_TRUNCATE");
  await loadRows("curated", "dim_zone", zoneRows, "WRITE_TRUNCATE");
  return { rowsExtracted: services.length + zones.length, rowsLoaded: services.length + zones.length, lowWatermark: null, highWatermark: new Date(), cursorEnd: null };
}

async function syncAggregates(_ctx: EtlJobContext): Promise<EtlJobResult> {
  const curated = fqTable("curated", "fact_bookings");
  const hourly = fqTable("analytics", "agg_hourly_demand");
  const daily = fqTable("analytics", "agg_daily_demand");
  const weekly = fqTable("analytics", "agg_weekly_demand");
  const monthly = fqTable("analytics", "agg_monthly_demand");

  await bqQuery(`
    TRUNCATE TABLE ${hourly};
    INSERT INTO ${hourly}
    SELECT COALESCE(zone_id,'unzoned') AS zone_id, city, TIMESTAMP_TRUNC(created_at, HOUR) AS hour_ts,
      COUNT(*) AS bookings, COUNTIF(is_completed) AS completed, COUNTIF(is_cancelled) AS cancelled,
      SUM(total_amount) AS revenue, AVG(eta_min) AS avg_eta_min, NULL AS avg_surge, CURRENT_TIMESTAMP() AS loaded_at
    FROM ${curated} GROUP BY zone_id, city, hour_ts;

    TRUNCATE TABLE ${daily};
    INSERT INTO ${daily}
    SELECT COALESCE(zone_id,'unzoned') AS zone_id, city, DATE(created_at) AS day_ts,
      COUNT(*) AS bookings, COUNTIF(is_completed) AS completed, SUM(total_amount) AS revenue, CURRENT_TIMESTAMP() AS loaded_at
    FROM ${curated} GROUP BY zone_id, city, day_ts;

    TRUNCATE TABLE ${weekly};
    INSERT INTO ${weekly}
    SELECT COALESCE(zone_id,'unzoned') AS zone_id, city, DATE_TRUNC(DATE(created_at), WEEK) AS week_ts,
      COUNT(*) AS bookings, COUNTIF(is_completed) AS completed, SUM(total_amount) AS revenue, CURRENT_TIMESTAMP() AS loaded_at
    FROM ${curated} GROUP BY zone_id, city, week_ts;

    TRUNCATE TABLE ${monthly};
    INSERT INTO ${monthly}
    SELECT COALESCE(zone_id,'unzoned') AS zone_id, city, DATE_TRUNC(DATE(created_at), MONTH) AS month_ts,
      COUNT(*) AS bookings, COUNTIF(is_completed) AS completed, SUM(total_amount) AS revenue, CURRENT_TIMESTAMP() AS loaded_at
    FROM ${curated} GROUP BY zone_id, city, month_ts;
  `);
  return { rowsExtracted: 0, rowsLoaded: 0, lowWatermark: null, highWatermark: new Date(), cursorEnd: null, metadata: { rebuilt: ["agg_hourly_demand", "agg_daily_demand", "agg_weekly_demand", "agg_monthly_demand"] } };
}

export const ETL_JOB_REGISTRY: EtlJobRegistry = {
  "etl.booking": syncBookings,
  "etl.partner": syncPartners,
  "etl.payment": syncPayments,
  "etl.wallet": syncWallet,
  "etl.ledger": syncLedger,
  "etl.fraud": syncFraud,
  "etl.location": syncLocation,
  "etl.customer": syncCustomers,
  "etl.notification": syncNotifications,
  "etl.review": syncReviews,
  "etl.referral": syncReferrals,
  "etl.hcoin": syncHcoin,
  "etl.automation": syncAutomation,
  "etl.events": syncEvents,
  "etl.audit": syncAudit,
  "etl.dimensions": syncDimensions,
  "etl.aggregates": syncAggregates,
};
