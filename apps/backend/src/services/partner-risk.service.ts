import { Prisma, type PartnerRiskReviewStatus, type PartnerRiskSignalType } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { distanceKm } from "../lib/geo";
import {
  ARRIVAL_MISMATCH_METERS,
  CANCELLATION_ABUSE_MIN_JOBS,
  CANCELLATION_ABUSE_RATE,
  GPS_SPOOF_KMH,
  IMPOSSIBLE_TRAVEL_KMH,
  impliedSpeedKmh,
  scoreFromSignals,
} from "../lib/partner-risk-score";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildPartnerRiskUpdatedEvent } from "../events/catalog/partner.events";
import { notificationService } from "./notification.service";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export class PartnerRiskService {
  async ingestLocationSample(input: {
    providerId: string;
    bookingId?: string;
    latitude: number;
    longitude: number;
    at: Date;
    previous?: { latitude: number; longitude: number; at: Date } | null;
  }) {
    const prev = input.previous;
    if (!prev) return null;
    const km = distanceKm(prev.latitude, prev.longitude, input.latitude, input.longitude);
    const elapsed = input.at.getTime() - prev.at.getTime();
    const speed = impliedSpeedKmh(km, elapsed);
    if (speed == null) return null;

    if (speed >= IMPOSSIBLE_TRAVEL_KMH) {
      return this.recordSignal({
        providerId: input.providerId,
        type: "IMPOSSIBLE_TRAVEL",
        source: "location_history",
        severity: Math.min(100, Math.round(speed / 8)),
        confidence: 0.7,
        bookingId: input.bookingId,
        fingerprint: `IMPOSSIBLE_TRAVEL:${input.providerId}:${input.bookingId ?? "none"}:${dayKey(input.at)}`,
        evidence: { km: Math.round(km * 10) / 10, elapsedMs: elapsed, speedKmh: Math.round(speed) },
      });
    }
    if (speed >= GPS_SPOOF_KMH) {
      return this.recordSignal({
        providerId: input.providerId,
        type: "GPS_SPOOF",
        source: "location_history",
        severity: Math.min(90, Math.round(speed / 6)),
        confidence: 0.55,
        bookingId: input.bookingId,
        fingerprint: `GPS_SPOOF:${input.providerId}:${input.bookingId ?? "none"}:${dayKey(input.at)}`,
        evidence: { km: Math.round(km * 10) / 10, elapsedMs: elapsed, speedKmh: Math.round(speed) },
      });
    }
    return null;
  }

  async evaluateArrival(input: {
    providerId: string;
    bookingId: string;
    jobLat: number;
    jobLng: number;
    partnerLat: number;
    partnerLng: number;
  }) {
    const meters = distanceKm(input.jobLat, input.jobLng, input.partnerLat, input.partnerLng) * 1000;
    if (meters <= ARRIVAL_MISMATCH_METERS) return null;
    return this.recordSignal({
      providerId: input.providerId,
      type: "FAKE_ARRIVAL",
      source: "job_arrival",
      severity: Math.min(90, Math.round(meters / 80)),
      confidence: 0.6,
      bookingId: input.bookingId,
      fingerprint: `FAKE_ARRIVAL:${input.providerId}:${input.bookingId}`,
      evidence: { meters: Math.round(meters) },
    });
  }

  async evaluateCompletion(input: {
    providerId: string;
    bookingId: string;
    jobLat: number;
    jobLng: number;
    partnerLat: number | null;
    partnerLng: number | null;
  }) {
    if (input.partnerLat == null || input.partnerLng == null) return null;
    const meters = distanceKm(input.jobLat, input.jobLng, input.partnerLat, input.partnerLng) * 1000;
    if (meters <= ARRIVAL_MISMATCH_METERS) return null;
    return this.recordSignal({
      providerId: input.providerId,
      type: "FAKE_COMPLETION",
      source: "job_completion",
      severity: Math.min(95, Math.round(meters / 70)),
      confidence: 0.65,
      bookingId: input.bookingId,
      fingerprint: `FAKE_COMPLETION:${input.providerId}:${input.bookingId}`,
      evidence: { meters: Math.round(meters) },
    });
  }

  async evaluateCancellationAbuse(providerId: string) {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const [cancelled, total] = await Promise.all([
      prisma.booking.count({
        where: { providerId, status: "CANCELLED_BY_PROVIDER", cancelledAt: { gte: since } },
      }),
      prisma.booking.count({
        where: { providerId, createdAt: { gte: since } },
      }),
    ]);
    if (total < CANCELLATION_ABUSE_MIN_JOBS) return null;
    const rate = cancelled / total;
    if (rate < CANCELLATION_ABUSE_RATE) return null;
    return this.recordSignal({
      providerId,
      type: "CANCELLATION_ABUSE",
      source: "booking_stats",
      severity: Math.min(90, Math.round(rate * 100)),
      confidence: 0.7,
      fingerprint: `CANCELLATION_ABUSE:${providerId}:${dayKey()}`,
      evidence: { cancelled, total, rate: Math.round(rate * 100) / 100 },
    });
  }

  async recordSignal(input: {
    providerId: string;
    type: PartnerRiskSignalType;
    source: string;
    severity: number;
    confidence?: number;
    evidence: Record<string, unknown>;
    bookingId?: string;
    fingerprint?: string;
  }) {
    if (input.fingerprint) {
      const existing = await prisma.partnerRiskSignal.findUnique({ where: { fingerprint: input.fingerprint } });
      if (existing) return null;
    }
    try {
      const created = await prisma.partnerRiskSignal.createMany({
        data: [
          {
            providerId: input.providerId,
            type: input.type,
            source: input.source,
            severity: Math.max(1, Math.min(100, input.severity)),
            confidence: input.confidence ?? null,
            evidence: input.evidence as Prisma.InputJsonValue,
            bookingId: input.bookingId,
            fingerprint: input.fingerprint,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) return null;
      const row = input.fingerprint
        ? await prisma.partnerRiskSignal.findUnique({ where: { fingerprint: input.fingerprint } })
        : await prisma.partnerRiskSignal.findFirst({
            where: { providerId: input.providerId, type: input.type },
            orderBy: { createdAt: "desc" },
          });
      if (!row) return null;
      await this.evaluateProfile(input.providerId);
      return row;
    } catch (err) {
      if (isUnique(err)) return null;
      throw err;
    }
  }

  async evaluateProfile(providerId: string) {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const signals = await prisma.partnerRiskSignal.findMany({
      where: { providerId, createdAt: { gte: since } },
      select: { type: true, severity: true, confidence: true },
    });
    const scored = scoreFromSignals(signals);
    const existing = await prisma.partnerRiskProfile.findUnique({ where: { providerId } });
    const nextReview: PartnerRiskReviewStatus =
      existing?.reviewStatus === "RESTRICT" || existing?.reviewStatus === "SUSPEND" || existing?.reviewStatus === "CLEARED"
        ? existing.reviewStatus
        : scored.level === "HIGH" || scored.level === "CRITICAL"
          ? "REVIEW"
          : "MONITOR";

    const unchanged =
      existing &&
      existing.riskScore === scored.score &&
      existing.riskLevel === scored.level &&
      existing.reviewStatus === nextReview;

    const profile = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerRiskProfile.upsert({
        where: { providerId },
        create: {
          providerId,
          riskScore: scored.score,
          riskLevel: scored.level,
          reviewStatus: nextReview,
          explanation: scored.explanation,
          lastEvaluatedAt: new Date(),
        },
        update: {
          riskScore: scored.score,
          riskLevel: scored.level,
          reviewStatus: nextReview,
          explanation: scored.explanation,
          lastEvaluatedAt: new Date(),
        },
      });
      if (!unchanged) {
        await emitInTransaction(
          tx,
          buildPartnerRiskUpdatedEvent({
            providerId,
            riskLevel: scored.level,
            reviewStatus: nextReview,
            signalCount: signals.length,
          }),
        );
      }
      return row;
    });

    if (nextReview === "REVIEW" && existing?.reviewStatus !== "REVIEW") {
      const already = await prisma.notification.findFirst({
        where: {
          type: "RISK_REVIEW",
          referenceId: providerId,
          referenceType: "partner_risk",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (!already) {
        await this.notifyAdmins(providerId, scored.level, scored.explanation.why);
      }
    }
    const { partnerReferralService } = await import("./partner-referral.service");
    void partnerReferralService.onRiskUpdated(providerId).catch(() => undefined);
    return profile;
  }

  private async notifyAdmins(providerId: string, level: string, why: string) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
      select: { id: true },
      take: 20,
    });
    await Promise.all(
      admins.map((a) =>
        notificationService.createForUser({
          userId: a.id,
          type: "RISK_REVIEW",
          title: "Partner risk review required",
          message: `Partner ${providerId.slice(0, 8)} is ${level}. Open the risk queue.`,
          referenceId: providerId,
          referenceType: "partner_risk",
          priority: "high",
        }).catch((err) => logger.warn("risk_admin_notify_failed", { error: String(err) })),
      ),
    );
    void why;
  }

  async adminQueue(query: { level?: string; reviewStatus?: string; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Prisma.PartnerRiskProfileWhereInput = {};
    if (query.level) where.riskLevel = query.level as never;
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus as never;
    const [rows, total] = await Promise.all([
      prisma.partnerRiskProfile.findMany({
        where,
        orderBy: [{ riskScore: "desc" }, { lastEvaluatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          provider: {
            select: {
              id: true,
              businessName: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      prisma.partnerRiskProfile.count({ where }),
    ]);
    return {
      page,
      limit,
      total,
      items: rows.map((r) => ({
        providerId: r.providerId,
        partnerName: r.provider.businessName || [r.provider.user.firstName, r.provider.user.lastName].filter(Boolean).join(" "),
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        reviewStatus: r.reviewStatus,
        explanation: r.explanation ?? { why: "No explanation yet.", signals: [] },
        lastEvaluatedAt: r.lastEvaluatedAt,
      })),
    };
  }

  async detail(providerId: string, page = 1, limit = 25) {
    const take = Math.min(100, Math.max(1, limit));
    const [profile, signals, totalSignals] = await Promise.all([
      prisma.partnerRiskProfile.findUnique({ where: { providerId } }),
      prisma.partnerRiskSignal.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
      }),
      prisma.partnerRiskSignal.count({ where: { providerId } }),
    ]);
    return { profile, signals, page, limit: take, totalSignals };
  }

  async review(input: {
    providerId: string;
    actorId: string;
    action: "MONITOR" | "REVIEW" | "CLEAR" | "RESTRICT" | "SUSPEND";
    notes?: string;
  }) {
    const statusMap: Record<typeof input.action, PartnerRiskReviewStatus> = {
      MONITOR: "MONITOR",
      REVIEW: "REVIEW",
      CLEAR: "CLEARED",
      RESTRICT: "RESTRICT",
      SUSPEND: "SUSPEND",
    };
    const profile = await prisma.partnerRiskProfile.upsert({
      where: { providerId: input.providerId },
      create: {
        providerId: input.providerId,
        reviewStatus: statusMap[input.action],
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
        reviewNotes: input.notes,
        lastEvaluatedAt: new Date(),
      },
      update: {
        reviewStatus: statusMap[input.action],
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
        reviewNotes: input.notes,
      },
    });
    await prisma.activityLog.create({
      data: {
        providerId: input.providerId,
        userId: input.actorId,
        action: `RISK_${input.action}`,
        description: input.notes ?? input.action,
      },
    });
    if (input.action === "RESTRICT") {
      await prisma.provider.update({
        where: { id: input.providerId },
        data: {
          complianceRestricted: true,
          complianceRestrictedAt: new Date(),
          complianceRestrictionReason: "Risk policy restriction",
          isOnline: false,
        },
      });
      const already = await prisma.partnerComplianceRestriction.findFirst({
        where: { providerId: input.providerId, source: "RISK_POLICY", active: true },
      });
      if (!already) {
        await prisma.partnerComplianceRestriction.create({
          data: {
            providerId: input.providerId,
            reason: "Risk policy restriction",
            source: "RISK_POLICY",
            actorId: input.actorId,
          },
        });
      }
    }
    if (input.action === "SUSPEND") {
      await prisma.provider.update({
        where: { id: input.providerId },
        data: { isActive: false, isOnline: false, bannedReason: "Risk policy suspend" },
      });
    }
    if (input.action === "CLEAR") {
      /* Risk clear does not lift compliance document restrictions. */
    }
    const { partnerLifecycleService } = await import("./partner-lifecycle.service");
    await partnerLifecycleService
      .onRiskAction(input.providerId, input.action, input.actorId)
      .catch(() => undefined);
    return profile;
  }
}

export const partnerRiskService = new PartnerRiskService();
