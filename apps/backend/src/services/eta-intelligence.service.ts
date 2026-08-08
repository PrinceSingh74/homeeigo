/**
 * Phase 2 — ETA Intelligence Data Collection Platform.
 * Collects training labels from completed bookings. NO ML inference.
 */
import { gzipSync } from "node:zlib";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { hashPii } from "../../analytics/etl/pii";
import { mergeRows } from "../../analytics/etl/bq-client";
import { emitStandalone } from "../events/core/event-publisher";
import {
  buildEtaFeatureUpdatedEvent,
  buildEtaLabelCreatedEvent,
  buildEtaTripCompletedEvent,
} from "../events/catalog/eta.events";
import { validateEtaLabel } from "../../analytics/eta/validation";
import { engineerEtaFeatures } from "../../analytics/eta/feature-engineering";
import { weatherService } from "./weather.service";
import { distanceKm } from "../lib/geo";
import {
  recordEtaCollectionLatency,
  recordEtaDistanceBucket,
  recordEtaGoogleLatency,
  recordEtaLabelCreated,
  recordEtaLabelFailure,
  recordEtaTrainingReady,
} from "../lib/eta-metrics";
import type { EtaLabelStatus } from "@prisma/client";

/**
 * Only `nextBookingNumber()` (src/lib/booking-number.ts) can mint a production booking
 * number, and it always emits `HOMIGO-YYYYMMDD-NNNNN`. Anything else was created by a
 * certification script, test fixture or seed — such trips are real data structurally but
 * not real business events, so they must never reach ETA model training.
 *
 * Deliberately an allowlist: a new fixture prefix is excluded by default rather than
 * silently entering the training set.
 */
const PRODUCTION_BOOKING_NUMBER = /^HOMIGO-\d{8}-\d{5}$/;

export function isSyntheticBookingNumber(bookingNumber: string | null | undefined): boolean {
  if (!bookingNumber) return true;
  return !PRODUCTION_BOOKING_NUMBER.test(bookingNumber);
}

export type EtaLabelSummary = {
  bookingId: string;
  city: string | null;
  status: EtaLabelStatus;
  qualityScore: number;
  actualTravelDurationMin: number | null;
  googleEtaMinutes: number | null;
  gapMinutes: number | null;
  createdAt: Date;
};

class EtaIntelligenceService {
  /** Create or refresh training label when a booking completes. Async-safe — never blocks booking flow. */
  async collectLabelFromBooking(bookingId: string, eventId?: string): Promise<EtaLabelSummary | null> {
    const t0 = Date.now();
    try {
      const existing = await prisma.etaTrainingLabel.findUnique({ where: { bookingId } });
      if (existing?.status === "TRAINING_READY") {
        return this.toSummary(existing);
      }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          address: true,
          service: { select: { category: true, name: true } },
          provider: {
            select: {
              id: true,
              rating: true,
              totalBookings: true,
              acceptanceRate: true,
              cancellationRate: true,
            },
          },
          tracking: {
            include: {
              locationHistory: { orderBy: { timestamp: "asc" } },
            },
          },
        },
      });

      if (!booking || booking.status !== "COMPLETED") return null;
      if (!booking.providerId || !booking.arrivedAt) return null;

      const dispatchAttempt = await prisma.assignmentAttempt.findFirst({
        where: { providerId: booking.providerId, job: { bookingId } },
        orderBy: { dispatchedAt: "desc" },
        select: { dispatchedAt: true },
      });

      const dispatchTimestamp = dispatchAttempt?.dispatchedAt ?? booking.assignedAt;
      const arrivalTimestamp = booking.arrivedAt;

      const actualTravelDurationSec =
        dispatchTimestamp && arrivalTimestamp
          ? Math.max(0, Math.round((arrivalTimestamp.getTime() - dispatchTimestamp.getTime()) / 1000))
          : null;

      const googleEtaMinutes = booking.eta ?? null;
      const googleEtaSeconds = googleEtaMinutes != null ? googleEtaMinutes * 60 : null;

      const pings = booking.tracking?.locationHistory ?? [];
      const firstPing = pings[0];
      const lastPing = pings[pings.length - 1];

      const partnerLatDispatch = firstPing?.latitude ?? null;
      const partnerLngDispatch = firstPing?.longitude ?? null;
      const partnerLatArrival = lastPing?.latitude ?? null;
      const partnerLngArrival = lastPing?.longitude ?? null;

      const travelDistanceMeters =
        partnerLatArrival != null &&
        partnerLngArrival != null &&
        booking.address
          ? Math.round(distanceKm(partnerLatArrival, partnerLngArrival, booking.address.latitude, booking.address.longitude) * 1000)
          : booking.tracking?.totalDistance != null
            ? Math.round(booking.tracking.totalDistance * 1000)
            : null;

      const weather = booking.address
        ? await weatherService.getByCoords(booking.address.latitude, booking.address.longitude).catch(() => null)
        : null;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const partnerTodayTrips = booking.providerId
        ? await prisma.booking.count({
            where: { providerId: booking.providerId, completedAt: { gte: todayStart }, status: "COMPLETED" },
          })
        : null;

      const historicalRouteCount = booking.providerId
        ? await prisma.booking.count({
            where: { providerId: booking.providerId, status: "COMPLETED", arrivedAt: { not: null } },
          })
        : null;

      const historicalLabels = booking.providerId
        ? await prisma.etaTrainingLabel.findMany({
            where: { partnerHash: hashPii(booking.providerId), status: "TRAINING_READY" },
            select: { actualTravelDurationMin: true },
            take: 100,
            orderBy: { createdAt: "desc" },
          })
        : [];

      const historicalAvgDuration =
        historicalLabels.length > 0
          ? historicalLabels.reduce((s, l) => s + (l.actualTravelDurationMin ?? 0), 0) / historicalLabels.length
          : null;

      const ref = arrivalTimestamp ?? booking.completedAt ?? new Date();
      const engineered = engineerEtaFeatures({
        dispatchTimestamp,
        arrivalTimestamp,
        partnerLatDispatch,
        partnerLngDispatch,
        partnerLatArrival,
        partnerLngArrival,
        pickupLatitude: booking.address?.latitude ?? null,
        pickupLongitude: booking.address?.longitude ?? null,
        travelDistanceMeters,
        actualTravelDurationSec,
        googleEtaSeconds,
        rain: weather?.rain1hMm ?? null,
        temperature: weather?.tempC ?? null,
        historicalRouteCount,
        historicalAvgDuration,
      });

      // Provenance rides on the partner.arrived event that triggered this collection.
      // Absent (e.g. direct invocation), assume the precise GPS path.
      const arrivalSource = await this.resolveArrivalSource(eventId);

      const validation = validateEtaLabel({
        bookingId,
        dispatchTimestamp,
        arrivalTimestamp,
        actualTravelDurationSec,
        pickupLatitude: booking.address?.latitude ?? null,
        pickupLongitude: booking.address?.longitude ?? null,
        partnerLatArrival,
        partnerLngArrival,
        travelDistanceMeters,
        googleEtaSeconds,
        arrivalSource,
      });

      const labelData = {
        bookingId,
        partnerHash: hashPii(booking.providerId),
        customerHash: hashPii(booking.userId),
        city: booking.address?.city ?? null,
        zone: null as string | null,
        cluster: null as string | null,
        serviceCategory: booking.service?.category ?? null,
        vehicleType: null as string | null,
        bookingPriority: booking.queuePriority ?? null,
        dispatchTimestamp,
        acceptedTimestamp: booking.acceptedAt,
        partnerDepartTimestamp: booking.enRouteAt,
        enRouteTimestamp: booking.enRouteAt,
        arrivalTimestamp,
        bookingStartTimestamp: booking.startedAt,
        bookingCompleteTimestamp: booking.completedAt,
        pickupLatitude: booking.address?.latitude ?? null,
        pickupLongitude: booking.address?.longitude ?? null,
        partnerLatDispatch,
        partnerLngDispatch,
        partnerLatArrival,
        partnerLngArrival,
        travelDistanceMeters,
        actualTravelDurationSec,
        actualTravelDurationMin:
          actualTravelDurationSec != null ? Math.round((actualTravelDurationSec / 60) * 10) / 10 : null,
        googleEtaSeconds,
        googleEtaMinutes,
        googleDistanceMeters: travelDistanceMeters,
        trafficModel: googleEtaMinutes != null ? "best_guess" : null,
        trafficLevel: null as string | null,
        roadSpeed: engineered.averageSpeed,
        weekday: ref.getDay(),
        month: ref.getMonth() + 1,
        hour: ref.getHours(),
        minute: ref.getMinutes(),
        isWeekend: ref.getDay() === 0 || ref.getDay() === 6,
        holidayFlag: false,
        rain: weather?.rain1hMm ?? null,
        temperature: weather?.tempC ?? null,
        humidity: weather?.humidity ?? null,
        wind: weather?.windSpeedKmh ?? null,
        weatherCondition: weather?.condition ?? null,
        partnerRating: booking.provider?.rating ?? null,
        partnerExperience: booking.provider?.totalBookings ?? null,
        partnerAcceptanceRate: booking.provider?.acceptanceRate ?? null,
        partnerCancellationRate: booking.provider?.cancellationRate ?? null,
        partnerTodayTrips,
        partnerTodayHours: null as number | null,
        partnerCurrentLoad: null as number | null,
        partnerBattery: null as number | null,
        partnerNetworkQuality: null as string | null,
        deviceOS: null as string | null,
        deviceModel: null as string | null,
        gpsAccuracy: pings.length ? pings.reduce((s, p) => s + (p.accuracy ?? 0), 0) / pings.length : null,
        locationSamplingRate: this.computeSamplingHz(pings),
        bookingSource: null as string | null,
        campaign: booking.couponCode ?? null,
        surgeMultiplier: null as number | null,
        specialInstructions: booking.userNotes ?? null,
        bearing: engineered.bearing,
        routeEfficiency: engineered.routeEfficiency,
        averageSpeed: engineered.averageSpeed,
        peakHour: engineered.peakHour,
        nightFlag: engineered.nightFlag,
        rushHour: engineered.rushHour,
        distanceBucket: engineered.distanceBucket,
        tripBucket: engineered.tripBucket,
        partnerFamiliarity: engineered.partnerFamiliarity,
        historicalRouteCount,
        historicalAvgDuration,
        historicalAvgDelay: engineered.historicalAvgDelay,
        weatherBucket: engineered.weatherBucket,
        qualityScore: validation.qualityScore,
        status: validation.status,
        rejectionReason: validation.rejectionReasons.length ? validation.rejectionReasons.join(",") : null,
        eventId: eventId ?? null,
        // arrivalSource lives in features so training queries can filter or weight by
        // arrival precision without a schema migration.
        features: { ...engineered, arrivalSource } as object,
      };

      const label = await prisma.etaTrainingLabel.upsert({
        where: { bookingId },
        create: labelData,
        update: labelData,
      });

      if (engineered.distanceBucket) recordEtaDistanceBucket(engineered.distanceBucket);

      await this.compressGpsTrack(bookingId, hashPii(booking.providerId), pings);
      await this.syncToBigQuery(label, {
        arrivalSource,
        isSynthetic: isSyntheticBookingNumber(booking.bookingNumber),
      });

      if (validation.passed) {
        recordEtaLabelCreated(label.city, validation.qualityScore);
        // Authoritative count — excludes synthetic fixtures, so the gauge cannot report
        // labels that BigQuery training would reject.
        recordEtaTrainingReady(await this.countTrainingEligible());

        await emitStandalone(
          prisma,
          buildEtaLabelCreatedEvent({
            bookingId,
            partnerHash: label.partnerHash,
            city: label.city,
            actualTravelDurationSec: label.actualTravelDurationSec,
            googleEtaSeconds: label.googleEtaSeconds,
            qualityScore: validation.qualityScore,
            status: validation.status,
          }),
        );

        const gapMinutes =
          label.actualTravelDurationMin != null && label.googleEtaMinutes != null
            ? Math.round((label.actualTravelDurationMin - label.googleEtaMinutes) * 10) / 10
            : null;

        await emitStandalone(
          prisma,
          buildEtaTripCompletedEvent({
            bookingId,
            partnerHash: label.partnerHash,
            actualTravelDurationMin: label.actualTravelDurationMin,
            googleEtaMinutes: label.googleEtaMinutes,
            gapMinutes,
            city: label.city,
          }),
        );

        await emitStandalone(
          prisma,
          buildEtaFeatureUpdatedEvent({
            bookingId,
            featureGroup: "eta",
            versionTag: "v2.0",
            rowCount: 1,
          }),
        );
      } else {
        recordEtaLabelFailure(validation.rejectionReasons[0] ?? "validation");
      }

      recordEtaCollectionLatency(Date.now() - t0);
      return this.toSummary(label);
    } catch (err) {
      recordEtaLabelFailure("collection_error");
      logger.error("eta_label_collection_failed", {
        bookingId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Reads arrival provenance off the triggering partner.arrived outbox event.
   *
   * Only `eventId` can identify that event: partner events use providerId as their
   * aggregateId, so there is no bookingId-keyed lookup. Without an eventId — direct
   * invocation, or a label predating provenance — we assume the precise GPS path,
   * which matches how every historical label was produced.
   */
  private async resolveArrivalSource(eventId?: string): Promise<"gps_geofence" | "job_start"> {
    if (!eventId) return "gps_geofence";
    try {
      const row = await prisma.eventOutbox.findUnique({
        where: { eventId },
        select: { payload: true },
      });
      const payload = row?.payload as { data?: { arrivalSource?: string } } | null;
      return payload?.data?.arrivalSource === "job_start" ? "job_start" : "gps_geofence";
    } catch {
      return "gps_geofence";
    }
  }

  /**
   * Re-projects an already-stored label to the warehouse without recollecting it.
   *
   * For maintenance paths that change a label in Postgres — a contract re-validation, for
   * instance — and need the warehouse to agree. Reuses the same MERGE projection as the
   * live collection path, so provenance and synthetic classification are applied
   * identically. Creates nothing and recomputes no features.
   */
  async resyncLabelToWarehouse(bookingId: string): Promise<boolean> {
    const label = await prisma.etaTrainingLabel.findUnique({ where: { bookingId } });
    if (!label) return false;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { bookingNumber: true },
    });

    const f = (label.features ?? {}) as Record<string, unknown>;
    const arrivalSource = f.arrivalSource === "job_start" ? "job_start" : "gps_geofence";

    await this.syncToBigQuery(label, {
      arrivalSource,
      isSynthetic: isSyntheticBookingNumber(booking?.bookingNumber),
    });
    return true;
  }

  /** Persist Google Maps API snapshot — called asynchronously from tracking/maps. */
  async captureGoogleSnapshot(input: {
    bookingId: string;
    requestTimestamp: Date;
    responseTimestamp: Date;
    status: string;
    etaSeconds: number | null;
    distanceMeters: number | null;
    trafficModel?: string;
    polylineHash?: string;
    source?: string;
  }): Promise<void> {
    const latencyMs = input.responseTimestamp.getTime() - input.requestTimestamp.getTime();
    recordEtaGoogleLatency(latencyMs, input.status);

    await prisma.etaGoogleSnapshot.create({
      data: {
        bookingId: input.bookingId,
        requestTimestamp: input.requestTimestamp,
        responseTimestamp: input.responseTimestamp,
        apiLatencyMs: latencyMs,
        status: input.status,
        etaSeconds: input.etaSeconds,
        distanceMeters: input.distanceMeters,
        trafficModel: input.trafficModel ?? "best_guess",
        polylineHash: input.polylineHash ?? null,
        source: input.source ?? "google",
      },
    });
  }

  async getDashboardStats(): Promise<{
    tripsCollected: number;
    labelsToday: number;
    trainingReady: number;
    rejected: number;
    avgQualityScore: number;
    avgGapMinutes: number | null;
    cities: Array<{ city: string; count: number }>;
    freshnessMinutes: number | null;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, today, ready, rejected, avgQuality, avgGap, cities, latest] = await Promise.all([
      prisma.etaTrainingLabel.count(),
      prisma.etaTrainingLabel.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.etaTrainingLabel.count({ where: { status: "TRAINING_READY" } }),
      prisma.etaTrainingLabel.count({ where: { status: "REJECTED" } }),
      prisma.etaTrainingLabel.aggregate({ _avg: { qualityScore: true } }),
      prisma.etaTrainingLabel.aggregate({
        where: { status: "TRAINING_READY", actualTravelDurationMin: { not: null }, googleEtaMinutes: { not: null } },
        _avg: { actualTravelDurationMin: true },
      }),
      prisma.etaTrainingLabel.groupBy({
        by: ["city"],
        _count: { city: true },
        where: { city: { not: null } },
        orderBy: { _count: { city: "desc" } },
        take: 10,
      }),
      prisma.etaTrainingLabel.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);

    const avgGoogle = await prisma.etaTrainingLabel.aggregate({
      where: { status: "TRAINING_READY", googleEtaMinutes: { not: null } },
      _avg: { googleEtaMinutes: true },
    });

    const gap =
      avgGap._avg.actualTravelDurationMin != null && avgGoogle._avg.googleEtaMinutes != null
        ? Math.round((avgGap._avg.actualTravelDurationMin - avgGoogle._avg.googleEtaMinutes) * 10) / 10
        : null;

    return {
      tripsCollected: total,
      labelsToday: today,
      trainingReady: ready,
      rejected,
      avgQualityScore: Math.round((avgQuality._avg.qualityScore ?? 100) * 10) / 10,
      avgGapMinutes: gap,
      cities: cities.map((c) => ({ city: c.city ?? "unknown", count: c._count.city })),
      freshnessMinutes: latest ? Math.round((Date.now() - latest.createdAt.getTime()) / 60_000) : null,
    };
  }

  async getQualityReport(): Promise<{
    overallScore: number;
    byStatus: Record<string, number>;
    rejectionReasons: Array<{ reason: string; count: number }>;
  }> {
    const [avg, byStatus, rejected] = await Promise.all([
      prisma.etaTrainingLabel.aggregate({ _avg: { qualityScore: true } }),
      prisma.etaTrainingLabel.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.etaTrainingLabel.findMany({
        where: { status: "REJECTED", rejectionReason: { not: null } },
        select: { rejectionReason: true },
        take: 500,
      }),
    ]);

    const reasonCounts = new Map<string, number>();
    for (const r of rejected) {
      for (const reason of (r.rejectionReason ?? "").split(",")) {
        if (reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
    }

    return {
      overallScore: Math.round((avg._avg.qualityScore ?? 100) * 10) / 10,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.status])),
      rejectionReasons: [...reasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * THE authoritative training-eligible count.
   *
   * Postgres validation cannot see booking numbers, so `status = TRAINING_READY` alone
   * still admits certification fixtures. This applies the last contract condition —
   * `is_synthetic = false` — so the number matches
   * `vw_eta_training_eligible` in BigQuery exactly. Every readiness signal reads from here
   * rather than counting statuses independently, which is how the two layers drifted apart
   * in the first place.
   */
  async countTrainingEligible(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM eta_training_labels l
      JOIN bookings b ON b.id = l.booking_id
      WHERE l.status = 'TRAINING_READY'
        AND b.booking_number ~ '^HOMIGO-[0-9]{8}-[0-9]{5}$'`;
    return Number(rows[0]?.n ?? 0);
  }

  async getReadinessReport(): Promise<{
    trainingReady: number;
    trainingReadyIncludingSynthetic: number;
    validated: number;
    raw: number;
    rejected: number;
    readinessPct: number;
    minLabelsForTraining: number;
  }> {
    const MIN_LABELS = 50;
    const counts = await prisma.etaTrainingLabel.groupBy({ by: ["status"], _count: { status: true } });
    const map = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));
    // `trainingReady` is the eligible count; the raw status tally is exposed separately so
    // an operator can see the gap rather than having it hidden.
    const eligible = await this.countTrainingEligible();
    return {
      trainingReady: eligible,
      trainingReadyIncludingSynthetic: map.TRAINING_READY ?? 0,
      validated: map.VALIDATED ?? 0,
      raw: map.RAW ?? 0,
      rejected: map.REJECTED ?? 0,
      readinessPct: Math.min(100, Math.round((eligible / MIN_LABELS) * 100)),
      minLabelsForTraining: MIN_LABELS,
    };
  }

  async listTrips(limit = 50, offset = 0): Promise<EtaLabelSummary[]> {
    const rows = await prisma.etaTrainingLabel.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map((r) => this.toSummary(r));
  }

  async getGoogleStats(): Promise<{
    snapshotCount: number;
    avgLatencyMs: number;
    failureRate: number;
  }> {
    const [count, avgLatency, failures] = await Promise.all([
      prisma.etaGoogleSnapshot.count(),
      prisma.etaGoogleSnapshot.aggregate({ _avg: { apiLatencyMs: true } }),
      prisma.etaGoogleSnapshot.count({ where: { status: { not: "OK" } } }),
    ]);
    return {
      snapshotCount: count,
      avgLatencyMs: Math.round(avgLatency._avg.apiLatencyMs ?? 0),
      failureRate: count > 0 ? Math.round((failures / count) * 1000) / 10 : 0,
    };
  }

  private async syncToBigQuery(label: {
    bookingId: string;
    partnerHash: string;
    customerHash: string;
    city: string | null;
    status: string;
    qualityScore: number;
    actualTravelDurationSec: number | null;
    actualTravelDurationMin: number | null;
    googleEtaSeconds: number | null;
    googleEtaMinutes: number | null;
    travelDistanceMeters: number | null;
    dispatchTimestamp: Date | null;
    arrivalTimestamp: Date | null;
    serviceCategory: string | null;
    hour: number | null;
    weekday: number | null;
    distanceBucket: string | null;
    weatherBucket: string | null;
    bearing: number | null;
    routeEfficiency: number | null;
    averageSpeed: number | null;
    peakHour: boolean;
    rushHour: boolean;
    rain: number | null;
    temperature: number | null;
    partnerRating: number | null;
    createdAt: Date;
  }, provenance: { arrivalSource: string; isSynthetic: boolean }): Promise<void> {
    const now = new Date().toISOString();
    const rawRow = {
      booking_id: label.bookingId,
      partner_hash: label.partnerHash,
      customer_hash: label.customerHash,
      city: label.city,
      service_category: label.serviceCategory,
      arrival_source: provenance.arrivalSource,
      is_synthetic: provenance.isSynthetic,
      dispatch_at: label.dispatchTimestamp?.toISOString() ?? null,
      arrival_at: label.arrivalTimestamp?.toISOString() ?? null,
      actual_travel_duration_sec: label.actualTravelDurationSec,
      google_eta_seconds: label.googleEtaSeconds,
      google_distance_meters: label.travelDistanceMeters,
      status: label.status,
      ingested_at: now,
    };

    try {
      // MERGE, not append: a label may be re-collected (retry, replay, backfill) and the
      // warehouse must still hold exactly one canonical row per booking. booking_id is the
      // business key — it is @unique on eta_training_labels in Postgres and NOT NULL on
      // every ETA table; there is no separate label id in the warehouse.
      await mergeRows("raw", "eta_raw", "booking_id", [rawRow]);

      if (label.status !== "REJECTED") {
        await mergeRows("validated", "eta_validated", "booking_id", [
          { ...rawRow, quality_score: label.qualityScore },
        ]);
      }

      // Mirror every non-rejected label into the feature and training layers, carrying its
      // CURRENT validation_status. Gating the write on TRAINING_READY left a stale
      // TRAINING_READY row behind whenever a label was later downgraded — the warehouse
      // would then disagree with Postgres. Eligibility is decided by
      // vw_eta_training_eligible, not by whether the row exists.
      if (label.status !== "REJECTED") {
        await mergeRows("feature", "eta_feature", "booking_id", [{
          booking_id: label.bookingId,
          partner_hash: label.partnerHash,
          city: label.city,
          distance_bucket: label.distanceBucket,
          weather_bucket: label.weatherBucket,
          bearing: label.bearing,
          route_efficiency: label.routeEfficiency,
          average_speed: label.averageSpeed,
          peak_hour: label.peakHour,
          rush_hour: label.rushHour,
          rain: label.rain,
          temperature: label.temperature,
          partner_rating: label.partnerRating,
          hour: label.hour,
          weekday: label.weekday,
          arrival_source: provenance.arrivalSource,
          quality_score: label.qualityScore,
          validation_status: label.status,
          is_synthetic: provenance.isSynthetic,
          feature_generated_at: now,
        }]);

        await mergeRows("analytics", "eta_training", "booking_id", [{
          booking_id: label.bookingId,
          label_actual_travel_duration_sec: label.actualTravelDurationSec,
          label_actual_travel_duration_min: label.actualTravelDurationMin,
          feature_google_eta_seconds: label.googleEtaSeconds,
          feature_google_eta_minutes: label.googleEtaMinutes,
          feature_distance_meters: label.travelDistanceMeters,
          feature_city: label.city,
          feature_hour: label.hour,
          feature_weekday: label.weekday,
          gap_seconds:
            label.actualTravelDurationSec != null && label.googleEtaSeconds != null
              ? label.actualTravelDurationSec - label.googleEtaSeconds
              : null,
          // Carried into the training layer so a trainer can filter on precision,
          // readiness and origin without re-joining upstream tables.
          arrival_source: provenance.arrivalSource,
          quality_score: label.qualityScore,
          validation_status: label.status,
          is_synthetic: provenance.isSynthetic,
          training_version: "2.0.0",
          created_at: label.createdAt.toISOString(),
        }]);
      }
    } catch (err) {
      recordEtaLabelFailure("bq_load");
      logger.warn("eta_bq_sync_deferred", {
        bookingId: label.bookingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async compressGpsTrack(
    bookingId: string,
    partnerHash: string,
    pings: Array<{ latitude: number; longitude: number; timestamp: Date; accuracy: number | null }>,
  ): Promise<void> {
    if (pings.length === 0) return;

    const path = pings.map((p) => ({
      lat: Math.round(p.latitude * 1e5) / 1e5,
      lng: Math.round(p.longitude * 1e5) / 1e5,
      t: p.timestamp.getTime(),
      a: p.accuracy != null ? Math.round(p.accuracy) : null,
    }));

    const compressed = gzipSync(Buffer.from(JSON.stringify(path)));

    await prisma.etaGpsTrack.upsert({
      where: { bookingId },
      create: {
        bookingId,
        partnerHash,
        pingCount: pings.length,
        compressedPath: compressed,
        firstTimestamp: pings[0]!.timestamp,
        lastTimestamp: pings[pings.length - 1]!.timestamp,
        avgAccuracy: pings.reduce((s, p) => s + (p.accuracy ?? 0), 0) / pings.length,
        avgSamplingHz: this.computeSamplingHz(pings),
      },
      update: {
        pingCount: pings.length,
        compressedPath: compressed,
        lastTimestamp: pings[pings.length - 1]!.timestamp,
        avgAccuracy: pings.reduce((s, p) => s + (p.accuracy ?? 0), 0) / pings.length,
        avgSamplingHz: this.computeSamplingHz(pings),
      },
    });
  }

  private computeSamplingHz(
    pings: Array<{ timestamp: Date }>,
  ): number | null {
    if (pings.length < 2) return null;
    const spanSec = (pings[pings.length - 1]!.timestamp.getTime() - pings[0]!.timestamp.getTime()) / 1000;
    return spanSec > 0 ? Math.round((pings.length / spanSec) * 100) / 100 : null;
  }

  private toSummary(label: {
    bookingId: string;
    city: string | null;
    status: EtaLabelStatus;
    qualityScore: number;
    actualTravelDurationMin: number | null;
    googleEtaMinutes: number | null;
    createdAt: Date;
  }): EtaLabelSummary {
    const gapMinutes =
      label.actualTravelDurationMin != null && label.googleEtaMinutes != null
        ? Math.round((label.actualTravelDurationMin - label.googleEtaMinutes) * 10) / 10
        : null;
    return {
      bookingId: label.bookingId,
      city: label.city,
      status: label.status,
      qualityScore: label.qualityScore,
      actualTravelDurationMin: label.actualTravelDurationMin,
      googleEtaMinutes: label.googleEtaMinutes,
      gapMinutes,
      createdAt: label.createdAt,
    };
  }
}

export const etaIntelligenceService = new EtaIntelligenceService();
