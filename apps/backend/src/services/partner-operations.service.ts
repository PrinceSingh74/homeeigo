/**
 * Canonical Partner Operations service — availability FSM, capacity, service areas.
 * Matching and assignment MUST call this rather than inventing a second engine.
 */
import { AssignmentAttemptStatus, BookingStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/app-error";
import { sanitizeUserInput } from "../utils/sanitizer";
import { mapsService } from "./maps.service";
import { geofenceService } from "./geofence.service";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildPartnerAvailabilityUpdatedEvent,
  buildPartnerCapacityChangedEvent,
  buildPartnerOfflineEvent,
  buildPartnerOnlineEvent,
  buildPartnerPausedEvent,
  buildPartnerResumedEvent,
  buildPartnerServiceAreaUpdatedEvent,
} from "../events/catalog/partner.events";
import {
  assertPartnerAction,
  deriveOperationalStatus,
  normalizePauseReason,
  type OperationalState,
  type PauseReason,
} from "../lib/partner-availability-fsm";
import {
  computeCapacity,
  MAX_JOBS_PER_DAY,
  MAX_CONCURRENT_JOBS,
  MAX_SERVICE_RADIUS_KM,
  MIN_JOBS_PER_DAY,
  MIN_CONCURRENT_JOBS,
  MIN_SERVICE_RADIUS_KM,
  type CapacitySnapshot,
} from "../lib/partner-capacity";
import {
  assertStartBeforeEnd,
  computeNextAvailableAt,
  DEFAULT_PARTNER_TZ,
  isInBreakWindow,
  isValidHm,
  isWithinWorkingWindow,
  normalizeWorkingDays,
  parseBreakWindows,
  zonedDayBounds,
  type BreakWindow,
} from "../lib/partner-ops-clock";
import { distanceKm } from "../lib/geo";

const CONCURRENT_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
];

const TODAY_QUOTA_STATUSES: BookingStatus[] = [...CONCURRENT_STATUSES, BookingStatus.COMPLETED];

export type ReadinessBlocker = { code: string; message: string };

export type PartnerOperationsSnapshot = {
  operationalStatus: OperationalState;
  uiOnline: boolean;
  isOnline: boolean;
  isPaused: boolean;
  isSuspended: boolean;
  suspendedMessage: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  onlineSince: string | null;
  lastSeenAt: string | null;
  timezone: string;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  breakWindows: BreakWindow[];
  maxJobsPerDay: number | null;
  maxConcurrentJobs: number;
  serviceRadiusKm: number | null;
  serviceRegions: string[];
  city: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  capacity: CapacitySnapshot & { nextAvailableAt: string | null };
  readiness: { ready: boolean; blockers: ReadinessBlocker[] };
  preferredAreaLabel: string;
};

function opsError(message: string, code: string, status = 409): never {
  if (status === 403) throw new ForbiddenError(message, { code });
  if (status === 400) throw new BadRequestError(message, { code });
  throw new ConflictError(message, { code });
}

function parseOpsError(err: unknown): never {
  if (err instanceof Error && err.message.includes(":")) {
    const [code, ...rest] = err.message.split(":");
    const msg = rest.join(":");
    if (code === "ACCOUNT_RESTRICTED") opsError(msg, code, 403);
    if (code === "INVALID_TRANSITION") opsError(msg, code, 409);
    if (code === "VALIDATION") opsError(msg, "VALIDATION_ERROR", 400);
  }
  throw err;
}


export class PartnerOperationsService {
  async loadJobFlags(providerId: string) {
    const [inProgress, enRoute, accepted, openOffer] = await Promise.all([
      prisma.booking.count({ where: { providerId, status: BookingStatus.IN_PROGRESS } }),
      prisma.booking.count({ where: { providerId, status: BookingStatus.EN_ROUTE } }),
      prisma.booking.count({
        where: { providerId, status: { in: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED] } },
      }),
      prisma.assignmentAttempt.count({
        where: { providerId, status: AssignmentAttemptStatus.SENT },
      }),
    ]);
    return {
      hasInProgress: inProgress > 0,
      hasEnRoute: enRoute > 0,
      hasAccepted: accepted > 0,
      hasOpenOffer: openOffer > 0,
    };
  }

  async loadCapacityMap(providerIds: string[], at = new Date()): Promise<Map<string, CapacitySnapshot>> {
    const map = new Map<string, CapacitySnapshot>();
    if (providerIds.length === 0) return map;

    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, maxConcurrentJobs: true, maxJobsPerDay: true, timezone: true },
    });
    const tz = providers[0]?.timezone || DEFAULT_PARTNER_TZ;
    const { start, end } = zonedDayBounds(tz, at);

    const [currentRows, offerRows, todayRows] = await Promise.all([
      prisma.booking.groupBy({
        by: ["providerId"],
        where: { providerId: { in: providerIds }, status: { in: CONCURRENT_STATUSES } },
        _count: { _all: true },
      }),
      prisma.assignmentAttempt.groupBy({
        by: ["providerId"],
        where: { providerId: { in: providerIds }, status: AssignmentAttemptStatus.SENT },
        _count: { _all: true },
      }),
      prisma.booking.groupBy({
        by: ["providerId"],
        where: {
          providerId: { in: providerIds },
          status: { in: TODAY_QUOTA_STATUSES },
          scheduledDate: { gte: start, lt: end },
        },
        _count: { _all: true },
      }),
    ]);

    const current = new Map(currentRows.map((r) => [r.providerId!, r._count._all]));
    const reserved = new Map(offerRows.map((r) => [r.providerId, r._count._all]));
    const today = new Map(todayRows.map((r) => [r.providerId!, r._count._all]));

    for (const p of providers) {
      map.set(
        p.id,
        computeCapacity({
          currentJobs: current.get(p.id) ?? 0,
          reservedOffers: reserved.get(p.id) ?? 0,
          jobsToday: today.get(p.id) ?? 0,
          maxConcurrentJobs: p.maxConcurrentJobs,
          maxJobsPerDay: p.maxJobsPerDay,
        }),
      );
    }
    return map;
  }

  async loadCapacityFor(providerId: string, at = new Date()): Promise<CapacitySnapshot> {
    const map = await this.loadCapacityMap([providerId], at);
    return (
      map.get(providerId) ??
      computeCapacity({
        currentJobs: 0,
        reservedOffers: 0,
        jobsToday: 0,
        maxConcurrentJobs: 4,
        maxJobsPerDay: null,
      })
    );
  }

  readinessFor(provider: {
    isActive: boolean;
    isBanned: boolean;
    isApproved: boolean;
    serviceCategories: string[];
    serviceRegions: string[];
    serviceRadiusKm: number | null;
    city: string | null;
    baseLatitude: number | null;
    baseLongitude: number | null;
  }): { ready: boolean; blockers: ReadinessBlocker[] } {
    const blockers: ReadinessBlocker[] = [];
    if (provider.isBanned || !provider.isActive) {
      blockers.push({
        code: "ACCOUNT_RESTRICTED",
        message: "Your account is currently unavailable for job assignments. Contact Support.",
      });
    }
    if (!provider.isApproved) {
      blockers.push({
        code: "APPROVAL_PENDING",
        message: "Complete required profile first. Your application is pending approval.",
      });
    }
    if (provider.serviceCategories.length === 0) {
      blockers.push({ code: "SKILL_REQUIRED", message: "Select at least one skill before going online." });
    }
    const hasArea =
      Boolean(provider.city) ||
      provider.serviceRegions.length > 0 ||
      (provider.serviceRadiusKm != null && provider.baseLatitude != null && provider.baseLongitude != null);
    if (!hasArea) {
      blockers.push({
        code: "SERVICE_AREA_REQUIRED",
        message: "Select at least one service area.",
      });
    }
    return { ready: blockers.length === 0, blockers };
  }

  async snapshot(providerId: string): Promise<PartnerOperationsSnapshot> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) throw new NotFoundError("Provider");

    const [flags, capacity] = await Promise.all([this.loadJobFlags(providerId), this.loadCapacityFor(providerId)]);
    const operationalStatus = deriveOperationalStatus({
      isBanned: provider.isBanned || provider.user.isBanned,
      isActive: provider.isActive,
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      ...flags,
    });

    const schedule = {
      workingDays: provider.workingDays,
      workingHoursStart: provider.workingHoursStart,
      workingHoursEnd: provider.workingHoursEnd,
      breakWindows: parseBreakWindows(provider.breakWindows),
      timezone: provider.timezone || DEFAULT_PARTNER_TZ,
    };
    const now = new Date();
    const outsideHours = !isWithinWorkingWindow(schedule, now);
    const breakActive = isInBreakWindow(schedule, now);
    const availableNow =
      operationalStatus === "available" && !capacity.capacityFull && !outsideHours && !breakActive;
    const next = computeNextAvailableAt(schedule, now, {
      availableNow,
      breakActive,
      outsideHours,
    });

    const readiness = this.readinessFor(provider);
    const preferred = provider.serviceRegions.length
      ? provider.serviceRegions.join(" · ")
      : provider.city ?? "Not set";

    return {
      operationalStatus,
      uiOnline: provider.isOnline && operationalStatus !== "suspended",
      isOnline: provider.isOnline,
      isPaused: operationalStatus === "paused",
      isSuspended: operationalStatus === "suspended",
      suspendedMessage:
        operationalStatus === "suspended"
          ? "Your account is currently unavailable for job assignments. Contact Support."
          : null,
      pauseReason: provider.pauseReason,
      pausedAt: provider.pausedAt?.toISOString() ?? null,
      onlineSince: provider.onlineSince?.toISOString() ?? null,
      lastSeenAt: provider.lastSeenAt?.toISOString() ?? null,
      timezone: schedule.timezone,
      workingDays: provider.workingDays,
      workingHoursStart: provider.workingHoursStart,
      workingHoursEnd: provider.workingHoursEnd,
      breakWindows: schedule.breakWindows,
      maxJobsPerDay: provider.maxJobsPerDay,
      maxConcurrentJobs: provider.maxConcurrentJobs,
      serviceRadiusKm: provider.serviceRadiusKm,
      serviceRegions: provider.serviceRegions,
      city: provider.city,
      baseLatitude: provider.baseLatitude,
      baseLongitude: provider.baseLongitude,
      capacity: { ...capacity, nextAvailableAt: next?.toISOString() ?? null },
      readiness,
      preferredAreaLabel: preferred,
    };
  }

  async syncCurrentStatus(providerId: string): Promise<OperationalState> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) throw new NotFoundError("Provider");
    const flags = await this.loadJobFlags(providerId);
    const status = deriveOperationalStatus({
      isBanned: provider.isBanned || provider.user.isBanned,
      isActive: provider.isActive,
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      ...flags,
    });
    if (provider.currentStatus !== status) {
      await prisma.provider.update({ where: { id: providerId }, data: { currentStatus: status } });
    }
    return status;
  }

  /**
   * Re-check under a row lock. Used by dispatch offer + accept.
   * Returns null when eligible, otherwise a machine code.
   */
  async assertOfferEligible(
    tx: Prisma.TransactionClient,
    providerId: string,
    job: { latitude: number; longitude: number; scheduledDate: Date },
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        is_online: boolean;
        paused_at: Date | null;
        is_banned: boolean;
        is_active: boolean;
        is_approved: boolean;
        max_concurrent_jobs: number;
        max_jobs_per_day: number | null;
        working_days: string[];
        working_hours_start: string | null;
        working_hours_end: string | null;
        break_windows: unknown;
        timezone: string;
        service_radius_km: number | null;
        service_regions: string[];
        base_latitude: number | null;
        base_longitude: number | null;
      }>
    >`
      SELECT id, is_online, paused_at, is_banned, is_active, is_approved,
             max_concurrent_jobs, max_jobs_per_day, working_days, working_hours_start,
             working_hours_end, break_windows, timezone, service_radius_km, service_regions,
             base_latitude, base_longitude
      FROM providers
      WHERE id = ${providerId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return "NOT_FOUND";
    if (row.is_banned || !row.is_active) return "ACCOUNT_RESTRICTED";
    if (!row.is_approved) return "APPROVAL_PENDING";
    if (!row.is_online) return "OFFLINE";
    if (row.paused_at) return "PAUSED";

    const schedule = {
      workingDays: row.working_days ?? [],
      workingHoursStart: row.working_hours_start,
      workingHoursEnd: row.working_hours_end,
      breakWindows: parseBreakWindows(row.break_windows),
      timezone: row.timezone || DEFAULT_PARTNER_TZ,
    };
    if (!isWithinWorkingWindow(schedule, job.scheduledDate)) return "OUTSIDE_WORKING_HOURS";
    if (isInBreakWindow(schedule, new Date())) return "BREAK_ACTIVE";

    const loc = await tx.location.findUnique({
      where: { providerId },
      select: { latitude: true, longitude: true },
    });
    const originLat = loc?.latitude ?? row.base_latitude;
    const originLng = loc?.longitude ?? row.base_longitude;
    if (row.service_radius_km != null && row.service_radius_km >= MIN_SERVICE_RADIUS_KM) {
      if (originLat == null || originLng == null) return "OUTSIDE_SERVICE_AREA";
      if (distanceKm(job.latitude, job.longitude, originLat, originLng) > row.service_radius_km) {
        return "OUTSIDE_SERVICE_AREA";
      }
    }
    /**
     * `service_regions` is declared `String[]` (non-optional) in schema.prisma, but this row
     * comes from a raw query — Postgres genuinely returns `null` for provider rows whose column
     * was never backfilled with `{}`, and a raw query bypasses the normal Prisma client's
     * null-to-[] coercion. Every affected job crashed here with `TypeError: null is not an object`
     * before this reached the eligibility check at all, aborting dispatch for that candidate
     * entirely — a `null` (no declared regions) is meant to be treated the same as `[]` (skip the
     * region check, radius/geofence rules elsewhere still apply).
     */
    const serviceRegions = row.service_regions ?? [];
    if (serviceRegions.length > 0) {
      const jobZones = await geofenceService
        .findContaining(job.latitude, job.longitude, { zoneType: "SERVICE_ZONE" })
        .catch(() => []);
      if (jobZones.length > 0) {
        const wants = serviceRegions.map((r) => r.trim().toLowerCase()).filter(Boolean);
        const hit = wants.some((w) =>
          jobZones.some((z) => {
            const n = z.name.trim().toLowerCase();
            return n === w || n.includes(w) || w.includes(n);
          }),
        );
        if (!hit) return "OUTSIDE_SERVICE_AREA";
      }
    }

    const { start, end } = zonedDayBounds(schedule.timezone);
    const [currentJobs, reservedOffers, jobsToday] = await Promise.all([
      tx.booking.count({ where: { providerId, status: { in: CONCURRENT_STATUSES } } }),
      tx.assignmentAttempt.count({ where: { providerId, status: AssignmentAttemptStatus.SENT } }),
      tx.booking.count({
        where: { providerId, status: { in: TODAY_QUOTA_STATUSES }, scheduledDate: { gte: start, lt: end } },
      }),
    ]);
    const cap = computeCapacity({
      currentJobs,
      reservedOffers,
      jobsToday,
      maxConcurrentJobs: row.max_concurrent_jobs,
      maxJobsPerDay: row.max_jobs_per_day,
    });
    if (cap.capacityFull) return "CAPACITY_LIMIT";
    return null;
  }

  async assertAcceptEligible(tx: Prisma.TransactionClient, providerId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<
      Array<{
        is_online: boolean;
        paused_at: Date | null;
        is_banned: boolean;
        is_active: boolean;
        max_concurrent_jobs: number;
        max_jobs_per_day: number | null;
        timezone: string;
      }>
    >`
      SELECT is_online, paused_at, is_banned, is_active, max_concurrent_jobs, max_jobs_per_day, timezone
      FROM providers
      WHERE id = ${providerId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return "NOT_FOUND";
    if (row.is_banned || !row.is_active) return "ACCOUNT_RESTRICTED";
    if (!row.is_online) return "PROVIDER_UNAVAILABLE";
    if (row.paused_at) return "PROVIDER_UNAVAILABLE";

    const { start, end } = zonedDayBounds(row.timezone || DEFAULT_PARTNER_TZ);
    const [currentJobs, jobsToday] = await Promise.all([
      tx.booking.count({ where: { providerId, status: { in: CONCURRENT_STATUSES } } }),
      tx.booking.count({
        where: { providerId, status: { in: TODAY_QUOTA_STATUSES }, scheduledDate: { gte: start, lt: end } },
      }),
    ]);
    const cap = computeCapacity({
      currentJobs,
      reservedOffers: 0,
      jobsToday,
      maxConcurrentJobs: row.max_concurrent_jobs,
      maxJobsPerDay: row.max_jobs_per_day,
    });
    if (cap.availableSlots <= 0) return "CAPACITY_LIMIT";
    return null;
  }

  async setOnline(providerId: string, online: boolean) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) throw new NotFoundError("Provider");
    const flags = await this.loadJobFlags(providerId);
    const from = deriveOperationalStatus({
      isBanned: provider.isBanned || provider.user.isBanned,
      isActive: provider.isActive,
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      ...flags,
    });

    try {
      if (online) {
        if (from === "suspended") opsError("Your account is currently unavailable for job assignments. Contact Support.", "ACCOUNT_RESTRICTED", 403);
        if (provider.isOnline && !provider.pausedAt) {
          return this.snapshot(providerId);
        }
        if (from === "paused") {
          assertPartnerAction("resume", from);
        } else {
          assertPartnerAction("go_online", from);
        }
        const ready = this.readinessFor(provider);
        if (!ready.ready) {
          const first = ready.blockers[0]!;
          opsError(first.message, first.code, 409);
        }
      } else if (provider.isOnline || provider.pausedAt) {
        assertPartnerAction("go_offline", from);
      } else {
        return this.snapshot(providerId);
      }
    } catch (err) {
      parseOpsError(err);
    }

    const now = new Date();
    const nextStatus = online ? "available" : "offline";
    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          isOnline: online,
          onlineSince: online ? now : null,
          pausedAt: null,
          pauseReason: null,
          currentStatus: nextStatus,
          lastSeenAt: now,
        },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
        await emitInTransaction(
          tx,
          online
            ? buildPartnerOnlineEvent({ providerId, onlineSince: now })
            : buildPartnerOfflineEvent({ providerId, offlineAt: now }),
        );
      }
    });
    logger.info("partner.availability.transition", {
      providerId,
      from,
      to: nextStatus,
      action: online ? "go_online" : "go_offline",
    });
    return this.snapshot(providerId);
  }

  async pause(providerId: string, reasonRaw?: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) throw new NotFoundError("Provider");
    const flags = await this.loadJobFlags(providerId);
    const from = deriveOperationalStatus({
      isBanned: provider.isBanned || provider.user.isBanned,
      isActive: provider.isActive,
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      ...flags,
    });
    try {
      assertPartnerAction("pause", from);
    } catch (err) {
      parseOpsError(err);
    }
    const reason: PauseReason = normalizePauseReason(reasonRaw);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: { pausedAt: now, pauseReason: reason, currentStatus: "paused", lastSeenAt: now },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
        await emitInTransaction(tx, buildPartnerPausedEvent({ providerId, pausedAt: now, reason }));
      }
    });
    logger.info("partner.availability.transition", { providerId, from, to: "paused", action: "pause", reason });
    return this.snapshot(providerId);
  }

  async resume(providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) throw new NotFoundError("Provider");
    const flags = await this.loadJobFlags(providerId);
    const from = deriveOperationalStatus({
      isBanned: provider.isBanned || provider.user.isBanned,
      isActive: provider.isActive,
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      ...flags,
    });
    try {
      assertPartnerAction("resume", from);
    } catch (err) {
      parseOpsError(err);
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          pausedAt: null,
          pauseReason: null,
          isOnline: true,
          onlineSince: provider.onlineSince ?? now,
          currentStatus: "available",
          lastSeenAt: now,
        },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
        await emitInTransaction(tx, buildPartnerResumedEvent({ providerId, resumedAt: now }));
      }
    });
    logger.info("partner.availability.transition", { providerId, from, to: "available", action: "resume" });
    return this.syncCurrentStatus(providerId).then(() => this.snapshot(providerId));
  }

  async updateAvailabilityConfig(
    providerId: string,
    patch: {
      workingHoursStart?: string;
      workingHoursEnd?: string;
      workingDays?: string[];
      breakWindows?: BreakWindow[];
      maxJobsPerDay?: number | null;
      maxConcurrentJobs?: number;
      timezone?: string;
    },
  ) {
    const data: Prisma.ProviderUpdateInput = {};
    if (patch.workingDays) {
      const days = normalizeWorkingDays(patch.workingDays);
      if (days.length === 0) opsError("Select at least one working day.", "INVALID_DAY", 400);
      data.workingDays = days;
    }
    if (patch.workingHoursStart !== undefined || patch.workingHoursEnd !== undefined) {
      const current = await prisma.provider.findUnique({
        where: { id: providerId },
        select: { workingHoursStart: true, workingHoursEnd: true },
      });
      const start = patch.workingHoursStart ?? current?.workingHoursStart ?? "09:00";
      const end = patch.workingHoursEnd ?? current?.workingHoursEnd ?? "18:00";
      if (!isValidHm(start) || !isValidHm(end)) opsError("Hours must use HH:MM.", "INVALID_TIME", 400);
      const hoursErr = assertStartBeforeEnd(start, end, "Working hours");
      if (hoursErr) opsError(hoursErr, "INVALID_TIME", 400);
      data.workingHoursStart = start;
      data.workingHoursEnd = end;
    }
    if (patch.breakWindows) {
      const breaks = parseBreakWindows(patch.breakWindows);
      if (patch.breakWindows.length > 0 && breaks.length !== patch.breakWindows.length) {
        opsError("Break windows must use HH:MM and start before end.", "INVALID_TIME", 400);
      }
      data.breakWindows = breaks;
    }
    if (patch.maxJobsPerDay !== undefined) {
      if (patch.maxJobsPerDay === null) data.maxJobsPerDay = null;
      else {
        const n = Number(patch.maxJobsPerDay);
        if (!Number.isInteger(n) || n < MIN_JOBS_PER_DAY || n > MAX_JOBS_PER_DAY) {
          opsError(`Maximum jobs per day must be between ${MIN_JOBS_PER_DAY} and ${MAX_JOBS_PER_DAY}.`, "INVALID_CAPACITY", 400);
        }
        data.maxJobsPerDay = n;
      }
    }
    if (patch.maxConcurrentJobs !== undefined) {
      const n = Number(patch.maxConcurrentJobs);
      if (!Number.isInteger(n) || n < MIN_CONCURRENT_JOBS || n > MAX_CONCURRENT_JOBS) {
        opsError(`Max concurrent jobs must be between ${MIN_CONCURRENT_JOBS} and ${MAX_CONCURRENT_JOBS}.`, "INVALID_CAPACITY", 400);
      }
      data.maxConcurrentJobs = n;
    }
    if (patch.timezone) data.timezone = sanitizeUserInput(patch.timezone, 64) || DEFAULT_PARTNER_TZ;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.provider.update({
        where: { id: providerId },
        data,
        select: {
          workingDays: true,
          workingHoursStart: true,
          workingHoursEnd: true,
          breakWindows: true,
          maxJobsPerDay: true,
          maxConcurrentJobs: true,
          timezone: true,
        },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
        await emitInTransaction(
          tx,
          buildPartnerAvailabilityUpdatedEvent({
            providerId,
            workingDays: row.workingDays,
            workingHoursStart: row.workingHoursStart,
            workingHoursEnd: row.workingHoursEnd,
          }),
        );
      }
      return row;
    });
    logger.info("partner.availability.updated", { providerId });
    return updated;
  }

  async updateServiceArea(
    providerId: string,
    input: {
      city?: string;
      serviceRegions?: string[];
      serviceRadiusKm?: number;
      baseLatitude?: number;
      baseLongitude?: number;
    },
  ) {
    if (input.serviceRadiusKm != null) {
      const r = Number(input.serviceRadiusKm);
      if (!Number.isFinite(r) || r < MIN_SERVICE_RADIUS_KM || r > MAX_SERVICE_RADIUS_KM) {
        opsError(
          `Choose a radius between ${MIN_SERVICE_RADIUS_KM} and ${MAX_SERVICE_RADIUS_KM} km.`,
          "INVALID_RADIUS",
          400,
        );
      }
    }
    const hasLat = input.baseLatitude != null;
    const hasLng = input.baseLongitude != null;
    if (hasLat !== hasLng) opsError("Latitude and longitude must be provided together.", "VALIDATION_ERROR", 400);
    if (hasLat && hasLng && !mapsService.isWithinIndia(input.baseLatitude!, input.baseLongitude!)) {
      opsError("Select a supported service area inside India.", "OUTSIDE_SERVICE_AREA", 400);
    }

    const regions = (input.serviceRegions ?? []).map((r) => sanitizeUserInput(r, 80)).filter(Boolean);
    const unique = [...new Set(regions)];
    if (unique.length > 20) opsError("Too many preferred areas.", "VALIDATION_ERROR", 400);

    let coverageZones: Array<{ id: string; name: string }> = [];
    if (hasLat && hasLng) {
      const containing = await geofenceService.findContaining(input.baseLatitude!, input.baseLongitude!).catch(() => []);
      coverageZones = containing.slice(0, 12).map((z) => ({ id: z.id, name: z.name }));
    }

    const city = input.city ? sanitizeUserInput(input.city, 80) : undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.provider.update({
        where: { id: providerId },
        data: {
          ...(city !== undefined ? { city } : {}),
          ...(input.serviceRegions ? { serviceRegions: unique } : {}),
          ...(input.serviceRadiusKm != null ? { serviceRadiusKm: Number(input.serviceRadiusKm) } : {}),
          ...(hasLat && hasLng ? { baseLatitude: input.baseLatitude, baseLongitude: input.baseLongitude } : {}),
        },
        select: {
          city: true,
          serviceRegions: true,
          serviceRadiusKm: true,
          baseLatitude: true,
          baseLongitude: true,
        },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
        await emitInTransaction(
          tx,
          buildPartnerServiceAreaUpdatedEvent({
            providerId,
            serviceRegions: row.serviceRegions,
            serviceRadiusKm: row.serviceRadiusKm,
          }),
        );
      }
      return row;
    });
    logger.info("partner.service_area.updated", { providerId });
    return { ...updated, coverageZones };
  }

  async nearbyZones(lat: number, lng: number) {
    if (!mapsService.isWithinIndia(lat, lng)) {
      opsError("Select a supported service area inside India.", "OUTSIDE_SERVICE_AREA", 400);
    }
    const zones = await geofenceService.findContaining(lat, lng).catch(() => []);
    return zones.slice(0, 16).map((z) => ({
      id: z.id,
      name: z.name,
      zoneType: z.zoneType,
      city: z.city,
    }));
  }

  async emitCapacityIfChanged(providerId: string, previous?: CapacitySnapshot) {
    const next = await this.loadCapacityFor(providerId);
    if (
      previous &&
      previous.availableSlots === next.availableSlots &&
      previous.currentJobs === next.currentJobs
    ) {
      return next;
    }
    if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.partnerEventsEnabled) return next;
    await prisma.$transaction(async (tx) => {
      await emitInTransaction(
        tx,
        buildPartnerCapacityChangedEvent({
          providerId,
          currentJobs: next.currentJobs,
          availableSlots: next.availableSlots,
          utilization: next.utilization,
        }),
      );
    });
    logger.info("partner.capacity.changed", {
      providerId,
      currentJobs: next.currentJobs,
      availableSlots: next.availableSlots,
    });
    return next;
  }

  async adminRoster(query: {
    status?: string;
    zone?: string;
    skill?: string;
    capacity?: "full" | "available";
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 40));
    const skip = (page - 1) * limit;

    const and: Prisma.ProviderWhereInput[] = [];
    if (query.status === "online") and.push({ isOnline: true });
    if (query.status === "offline") and.push({ isOnline: false });
    if (query.status === "paused") and.push({ pausedAt: { not: null } });
    if (query.status === "suspended") and.push({ OR: [{ isBanned: true }, { isActive: false }] });
    if (query.zone) and.push({ serviceRegions: { has: query.zone } });
    if (query.skill) and.push({ serviceCategories: { has: query.skill } });
    if (query.search?.trim()) {
      const q = query.search.trim();
      and.push({
        OR: [
          { businessName: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { user: { firstName: { contains: q, mode: "insensitive" } } },
          { user: { lastName: { contains: q, mode: "insensitive" } } },
        ],
      });
    }
    const where: Prisma.ProviderWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }],
        include: {
          user: { select: { firstName: true, lastName: true, isBanned: true } },
          currentLocation: { select: { latitude: true, longitude: true, lastUpdated: true } },
        },
      }),
      prisma.provider.count({ where }),
    ]);

    const capMap = await this.loadCapacityMap(rows.map((r) => r.id));
    const flagsList = await Promise.all(rows.map((r) => this.loadJobFlags(r.id)));

    let items = rows.map((p, i) => {
      const flags = flagsList[i]!;
      const status = deriveOperationalStatus({
        isBanned: p.isBanned || p.user.isBanned,
        isActive: p.isActive,
        isOnline: p.isOnline,
        pausedAt: p.pausedAt,
        ...flags,
      });
      const cap = capMap.get(p.id)!;
      const schedule = {
        workingDays: p.workingDays,
        workingHoursStart: p.workingHoursStart,
        workingHoursEnd: p.workingHoursEnd,
        breakWindows: parseBreakWindows(p.breakWindows),
        timezone: p.timezone || DEFAULT_PARTNER_TZ,
      };
      const now = new Date();
      const outsideHours = !isWithinWorkingWindow(schedule, now);
      const breakActive = isInBreakWindow(schedule, now);
      const availableNow =
        status === "available" && cap.availableSlots > 0 && !outsideHours && !breakActive;
      const next = computeNextAvailableAt(schedule, now, {
        availableNow,
        breakActive,
        outsideHours,
      });
      return {
        id: p.id,
        name: p.businessName || `${p.user.firstName} ${p.user.lastName}`.trim(),
        status,
        isOnline: p.isOnline,
        city: p.city,
        zones: p.serviceRegions,
        skills: p.serviceCategories,
        currentJobs: cap.currentJobs,
        maxConcurrent: cap.maxConcurrentJobs,
        dailyQuota: cap.maxJobsPerDay,
        jobsToday: cap.jobsToday,
        availableSlots: cap.availableSlots,
        utilization: cap.utilization,
        lastSeen: p.lastSeenAt?.toISOString() ?? p.currentLocation?.lastUpdated.toISOString() ?? null,
        nextAvailable: next?.toISOString() ?? null,
        rating: p.rating,
      };
    });

    if (query.capacity === "full") items = items.filter((i) => i.availableSlots <= 0);
    if (query.capacity === "available") items = items.filter((i) => i.availableSlots > 0);
    if (query.status && !["online", "offline", "paused", "suspended"].includes(query.status)) {
      items = items.filter((i) => i.status === query.status);
    }

    return { items, total, page, limit };
  }
}

export const partnerOperationsService = new PartnerOperationsService();
