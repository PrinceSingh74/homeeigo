import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { notificationService } from "./notification.service";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildPartnerComplianceExpiredEvent,
  buildPartnerComplianceExpiringEvent,
  buildPartnerRestrictedEvent,
  buildPartnerUnrestrictedEvent,
} from "../events/catalog/partner.events";
import {
  COMPLIANCE_REMINDER_DAYS,
  documentCta,
  evaluateExpiry,
  partnerFacingStatus,
  type ComplianceExpiryState,
  type PartnerComplianceStatus,
} from "../lib/compliance-expiry";

const INSURANCE_TYPES = new Set(["insurance", "policy", "liability_insurance"]);
const CERT_TYPES = new Set(["certificate", "certification", "license", "trade_license"]);

function isPrismaUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export type ComplianceDocumentView = {
  id: string;
  documentType: string;
  documentName: string | null;
  issuer: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  isVerified: boolean;
  expiryState: ComplianceExpiryState;
  daysToExpiry: number | null;
  cta: string;
  category: "kyc" | "insurance" | "certification" | "document";
};

export class ComplianceExpiryService {
  categorize(documentType: string): ComplianceDocumentView["category"] {
    const t = documentType.toLowerCase();
    if (INSURANCE_TYPES.has(t) || t.includes("insurance")) return "insurance";
    if (CERT_TYPES.has(t) || t.includes("certif") || t.includes("license")) return "certification";
    if (t === "pan" || t === "aadhar" || t === "aadhaar" || t === "kyc") return "kyc";
    return "document";
  }

  viewDocument(d: {
    id: string;
    documentType: string;
    documentName: string | null;
    issuer?: string | null;
    issueDate?: Date | null;
    expiryDate: Date | null;
    isVerified: boolean;
  }, now = new Date()): ComplianceDocumentView {
    const ev = evaluateExpiry(d.expiryDate, now);
    return {
      id: d.id,
      documentType: d.documentType,
      documentName: d.documentName,
      issuer: d.issuer ?? null,
      issueDate: d.issueDate ?? null,
      expiryDate: d.expiryDate,
      isVerified: d.isVerified,
      expiryState: ev.state,
      daysToExpiry: ev.daysToExpiry,
      cta: documentCta(ev.state, d.isVerified),
      category: this.categorize(d.documentType),
    };
  }

  async partnerSummary(providerId: string, now = new Date()) {
    const [provider, documents, restriction] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: {
          complianceRestricted: true,
          complianceRestrictionReason: true,
          isVerified: true,
          backgroundCheckStatus: true,
          certifications: true,
          user: { select: { kycStatus: true } },
          partnerBackgroundCheck: { select: { status: true, expiresAt: true } },
        },
      }),
      prisma.providerDocument.findMany({ where: { providerId }, orderBy: { uploadedAt: "desc" } }),
      prisma.partnerComplianceRestriction.findFirst({
        where: { providerId, active: true },
        orderBy: { restrictedAt: "desc" },
      }),
    ]);

    const views = documents.map((d) => this.viewDocument(d, now));
    const kycOk = provider?.user.kycStatus === "APPROVED" || provider?.isVerified === true;
    const facing = partnerFacingStatus({
      restricted: Boolean(provider?.complianceRestricted || restriction),
      hasExpired: views.some((d) => d.expiryState === "EXPIRED"),
      hasExpiring: views.some((d) => d.expiryState === "EXPIRING_SOON" || d.expiryState === "EXPIRING_URGENT"),
      hasUnverified: views.some((d) => !d.isVerified),
      kycOk: Boolean(kycOk),
    });

    return {
      status: facing.status as PartnerComplianceStatus,
      explanation: facing.explanation,
      restricted: Boolean(provider?.complianceRestricted),
      restrictionReason: provider?.complianceRestricted ? provider.complianceRestrictionReason : null,
      documents: views,
      kyc: {
        status: provider?.user.kycStatus ?? "NOT_STARTED",
        isVerified: provider?.isVerified ?? false,
      },
      backgroundCheck: {
        status: provider?.partnerBackgroundCheck?.status ?? provider?.backgroundCheckStatus ?? "NOT_DONE",
        expiresAt: provider?.partnerBackgroundCheck?.expiresAt ?? null,
      },
      certifications: provider?.certifications ?? [],
      insurance: views.filter((d) => d.category === "insurance"),
    };
  }

  async evaluateAll(now = new Date()) {
    // Only documents that can still change state: inside the reminder horizon ahead, or expired
    // recently enough that a restriction/reminder could still be owed. Without the floor every
    // document that ever expired was re-evaluated (serially, with per-doc queries) every hour, forever.
    const horizonAhead = new Date(now.getTime() + (COMPLIANCE_REMINDER_DAYS + 1) * 86_400_000);
    const lookback = new Date(now.getTime() - 90 * 86_400_000);
    const docs = await prisma.providerDocument.findMany({
      where: { expiryDate: { gte: lookback, lte: horizonAhead } },
      orderBy: { expiryDate: "asc" },
      take: 5_000,
      select: {
        id: true,
        providerId: true,
        documentType: true,
        documentName: true,
        expiryDate: true,
        isVerified: true,
        provider: { select: { userId: true, complianceRestricted: true } },
      },
    });

    let reminders = 0;
    let expired = 0;
    let restricted = 0;
    for (const doc of docs) {
      const result = await this.evaluateDocument(doc, now);
      reminders += result.reminderSent ? 1 : 0;
      if (result.expired) expired += 1;
      if (result.restricted) restricted += 1;
    }
    logger.info("compliance_expiry_eval", { scanned: docs.length, reminders, expired, restricted });
    return { scanned: docs.length, reminders, expired, restricted };
  }

  async evaluateDocument(
    doc: {
      id: string;
      providerId: string;
      documentType: string;
      documentName: string | null;
      expiryDate: Date | null;
      isVerified: boolean;
      provider: { userId: string; complianceRestricted: boolean };
    },
    now = new Date(),
  ) {
    const ev = evaluateExpiry(doc.expiryDate, now);
    let reminderSent = false;
    let expired = false;
    let restricted = false;
    if (ev.reminderWindow) {
      reminderSent = await this.sendWindowReminder(doc, ev.reminderWindow, ev.daysToExpiry ?? 0, now);
    }
    if (ev.state === "EXPIRED") {
      expired = true;
      restricted = await this.applyExpiredRestriction(doc, now);
    }
    return { reminderSent, expired, restricted, state: ev.state };
  }

  private async sendWindowReminder(
    doc: {
      id: string;
      providerId: string;
      documentType: string;
      documentName: string | null;
      expiryDate: Date | null;
      isVerified: boolean;
      provider: { userId: string };
    },
    window: "D30" | "D7" | "EXPIRED",
    daysToExpiry: number,
    now: Date,
  ): Promise<boolean> {
    if (!doc.expiryDate) return false;
    const already = await prisma.partnerComplianceReminder.findUnique({
      where: { documentId_window: { documentId: doc.id, window } },
    });
    if (already) return false;
    const correlationId = crypto.randomUUID();
    try {
      await prisma.partnerComplianceReminder.create({
        data: {
          providerId: doc.providerId,
          documentId: doc.id,
          window,
          expiryDate: doc.expiryDate,
          correlationId,
        },
      });
    } catch (err) {
      if (isPrismaUnique(err)) return false;
      throw err;
    }

    const urgent = window === "D7" || window === "EXPIRED";
    const title =
      window === "EXPIRED"
        ? "Document expired"
        : urgent
          ? "Urgent: document expiring"
          : "Document expiring soon";
    const cta = documentCta(window === "EXPIRED" ? "EXPIRED" : urgent ? "EXPIRING_URGENT" : "EXPIRING_SOON", doc.isVerified);
    const label = doc.documentName || doc.documentType;
    const message =
      window === "EXPIRED"
        ? `${label} has expired. ${cta} to restore access to new jobs.`
        : `${label} expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"}. ${cta} now.`;

    /**
     * The reminder row is the dedupe token, and it was committed BEFORE this send. So a failure
     * here used to suppress that (document, window) reminder permanently: the next sweep found the
     * row, returned early, and the partner was never told their document was expiring — with
     * `notificationId` left null as the only, unread, evidence.
     *
     * Releasing the token on failure restores the retry. The sweep runs hourly and the windows are
     * D30/D7/EXPIRED, so a re-send on the next pass is the intended behaviour, not a duplicate.
     */
    let n: { id: string };
    try {
      n = await notificationService.createForUser({
        userId: doc.provider.userId,
        type: window === "EXPIRED" ? "COMPLIANCE_EXPIRED" : urgent ? "COMPLIANCE_URGENT" : "COMPLIANCE_REMINDER",
        title,
        message,
        referenceId: doc.id,
        referenceType: "provider_document",
        priority: urgent ? "high" : "normal",
      });
    } catch (err) {
      await prisma.partnerComplianceReminder
        .delete({ where: { documentId_window: { documentId: doc.id, window } } })
        .catch(() => undefined);
      logger.error("compliance_reminder_send_failed", {
        category: "APPLICATION",
        documentId: doc.id,
        window,
        providerId: doc.providerId,
        reason: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
      });
      return false;
    }

    await prisma.partnerComplianceReminder.update({
      where: { documentId_window: { documentId: doc.id, window } },
      data: { notificationId: n.id },
    });

    await prisma.activityLog.create({
      data: {
        providerId: doc.providerId,
        userId: doc.provider.userId,
        action: `COMPLIANCE_REMINDER_${window}`,
        description: `Reminder ${window} for document ${doc.id}`,
      },
    });

    await prisma.$transaction(async (tx) => {
      const event =
        window === "EXPIRED"
          ? buildPartnerComplianceExpiredEvent({
              providerId: doc.providerId,
              documentId: doc.id,
              documentType: doc.documentType,
              expiredAt: now,
            })
          : buildPartnerComplianceExpiringEvent({
              providerId: doc.providerId,
              documentId: doc.id,
              documentType: doc.documentType,
              window,
              daysToExpiry,
            });
      await emitInTransaction(tx, event);
    });

    return true;
  }

  private async applyExpiredRestriction(
    doc: {
      id: string;
      providerId: string;
      documentType: string;
      provider: { userId: string; complianceRestricted: boolean };
    },
    now: Date,
  ): Promise<boolean> {
    const existing = await prisma.partnerComplianceRestriction.findFirst({
      where: { providerId: doc.providerId, documentId: doc.id, active: true },
    });
    if (existing) {
      if (!doc.provider.complianceRestricted) {
        await prisma.provider.update({
          where: { id: doc.providerId },
          data: {
            complianceRestricted: true,
            complianceRestrictedAt: now,
            complianceRestrictionReason: `${doc.documentType} expired`,
            isOnline: false,
          },
        });
      }
      return false;
    }

    const correlationId = crypto.randomUUID();
    const reason = `${doc.documentType} expired`;
    await prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.partnerComplianceRestriction.create({
          data: {
            providerId: doc.providerId,
            documentId: doc.id,
            reason,
            source: "EXPIRED_DOCUMENT",
            correlationId,
          },
        });
      }
      await tx.provider.update({
        where: { id: doc.providerId },
        data: {
          complianceRestricted: true,
          complianceRestrictedAt: now,
          complianceRestrictionReason: reason,
          isOnline: false,
        },
      });
      await tx.activityLog.create({
        data: {
          providerId: doc.providerId,
          userId: doc.provider.userId,
          action: "COMPLIANCE_RESTRICT",
          description: reason,
        },
      });
      await emitInTransaction(
        tx,
        buildPartnerRestrictedEvent({
          providerId: doc.providerId,
          reason,
          source: "EXPIRED_DOCUMENT",
          documentId: doc.id,
        }),
      );
    });
    const { partnerLifecycleService } = await import("./partner-lifecycle.service");
    void partnerLifecycleService.onComplianceRestricted(doc.providerId).catch(() => undefined);
    return true;
  }

  async unrestrict(providerId: string, actorId: string, reason: string) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.partnerComplianceRestriction.updateMany({
        where: { providerId, active: true },
        data: { active: false, unrestrictedAt: now, unrestrictedBy: actorId },
      });
      await tx.provider.update({
        where: { id: providerId },
        data: {
          complianceRestricted: false,
          complianceRestrictedAt: null,
          complianceRestrictionReason: null,
        },
      });
      await tx.activityLog.create({
        data: {
          providerId,
          userId: actorId,
          action: "COMPLIANCE_UNRESTRICT",
          description: reason,
        },
      });
      await emitInTransaction(tx, buildPartnerUnrestrictedEvent({ providerId, reason, actorId }));
    });
    const risk = await prisma.partnerRiskProfile.findUnique({
      where: { providerId },
      select: { reviewStatus: true },
    });
    if (!risk || risk.reviewStatus === "MONITOR" || risk.reviewStatus === "CLEARED") {
      const { partnerLifecycleService } = await import("./partner-lifecycle.service");
      await partnerLifecycleService
        .onRiskAction(providerId, "CLEAR", actorId)
        .catch(() => undefined);
    }
  }

  async adminQueue(query: {
    filter?: "expiring" | "expired" | "restricted" | "pending" | "verified";
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const where: Prisma.ProviderDocumentWhereInput = {};
    if (query.filter === "expiring") where.expiryDate = { gte: now, lte: soon };
    if (query.filter === "expired") where.expiryDate = { lt: now };
    if (query.filter === "pending") where.isVerified = false;
    if (query.filter === "verified") where.isVerified = true;
    if (query.filter === "restricted") {
      where.provider = { complianceRestricted: true };
    }

    const [rows, total] = await Promise.all([
      prisma.providerDocument.findMany({
        where,
        orderBy: [{ expiryDate: "asc" }, { uploadedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          provider: {
            select: {
              id: true,
              businessName: true,
              complianceRestricted: true,
              complianceRestrictionReason: true,
              user: { select: { firstName: true, lastName: true, kycStatus: true } },
            },
          },
        },
      }),
      prisma.providerDocument.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      items: rows.map((d) => {
        const view = this.viewDocument(d, now);
        return {
          partnerId: d.provider.id,
          partnerName: d.provider.businessName || [d.provider.user.firstName, d.provider.user.lastName].filter(Boolean).join(" "),
          documentId: d.id,
          documentType: d.documentType,
          expiryDate: d.expiryDate,
          isVerified: d.isVerified,
          expiryState: view.expiryState,
          daysToExpiry: view.daysToExpiry,
          restricted: d.provider.complianceRestricted,
          restrictionReason: d.provider.complianceRestrictionReason,
          kycStatus: d.provider.user.kycStatus,
          nextAction: view.cta,
        };
      }),
    };
  }
}

export const complianceExpiryService = new ComplianceExpiryService();
