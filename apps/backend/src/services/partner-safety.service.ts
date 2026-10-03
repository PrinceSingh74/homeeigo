import { Prisma, type PartnerSafetyIncidentStatus, type PartnerSafetyIncidentType } from "@prisma/client";
import { logger } from "../lib/logger";
import prisma from "../lib/prisma";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildPartnerSafetyIncidentCreatedEvent,
  buildPartnerSafetyIncidentResolvedEvent,
  buildPartnerSosCreatedEvent,
} from "../events/catalog/partner.events";
import { notificationService } from "./notification.service";
import { maskPhone } from "../lib/pii-normalize";

const TX_OPTS = { maxWait: 20_000, timeout: 30_000 } as const;
const SOS_ADMIN_NOTIFY_CAP = 20;

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function openKey(providerId: string, bookingId?: string | null) {
  return `sos:${providerId}:${bookingId || "standalone"}`;
}

export class PartnerSafetyService {
  async triggerSos(input: {
    providerId: string;
    userId: string;
    bookingId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
  }) {
    const loc =
      input.latitude != null && input.longitude != null
        ? { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? null }
        : await prisma.location.findUnique({
            where: { providerId: input.providerId },
            select: { latitude: true, longitude: true, accuracy: true },
          });

    const bookingId = input.bookingId
      ? (
          await prisma.booking.findFirst({
            where: { id: input.bookingId, providerId: input.providerId },
            select: { id: true },
          })
        )?.id ?? null
      : (
          await prisma.booking.findFirst({
            where: {
              providerId: input.providerId,
              status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
            },
            orderBy: { scheduledDate: "desc" },
            select: { id: true },
          })
        )?.id ?? null;

    const key = openKey(input.providerId, bookingId);
    const existing = await prisma.partnerSafetyIncident.findUnique({ where: { openIdempotencyKey: key } });
    if (existing) return { incident: existing, created: false };

    const provider = await prisma.provider.findUnique({
      where: { id: input.providerId },
      select: { emergencyContactName: true, emergencyContactPhone: true, userId: true },
    });

    try {
      const incident = await prisma.$transaction(async (tx) => {
        const row = await tx.partnerSafetyIncident.create({
          data: {
            providerId: input.providerId,
            bookingId,
            type: "SOS",
            severity: "CRITICAL",
            status: "OPEN",
            latitude: loc?.latitude ?? null,
            longitude: loc?.longitude ?? null,
            accuracy: loc?.accuracy ?? null,
            openIdempotencyKey: key,
            evidence: {
              source: "partner_sos",
              locationCaptured: Boolean(loc),
            },
            emergencyContactNotifiedAt: provider?.emergencyContactPhone ? new Date() : null,
          },
        });
        await tx.opsAlert.create({
          data: {
            alertType: `partner_sos:${row.id}`,
            severity: "CRITICAL",
            message: "Partner SOS activated. Live location captured for authorized ops.",
            metadata: JSON.stringify({
              incidentId: row.id,
              providerId: input.providerId,
              bookingId,
              hasLocation: Boolean(loc),
            }),
          },
        });
        await tx.activityLog.create({
          data: {
            providerId: input.providerId,
            userId: input.userId,
            bookingId: bookingId ?? undefined,
            action: "SAFETY_SOS_CREATED",
            description: `SOS incident ${row.id}`,
          },
        });
        await emitInTransaction(
          tx,
          buildPartnerSosCreatedEvent({
            providerId: input.providerId,
            incidentId: row.id,
            bookingId,
            hasLocation: Boolean(loc),
          }),
        );
        await emitInTransaction(
          tx,
          buildPartnerSafetyIncidentCreatedEvent({
            providerId: input.providerId,
            incidentId: row.id,
            type: "SOS",
            severity: "CRITICAL",
          }),
        );
        return row;
      }, TX_OPTS);

      const admins = await prisma.user.findMany({
        where: { role: "ADMIN", isActive: true, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        take: SOS_ADMIN_NOTIFY_CAP,
      });
      /**
       * Detached per admin, and counted.
       *
       * The incident and its ops alert are already committed. Previously one failing insert threw
       * out of the loop: the partner pressing SOS got a 500 in an emergency, the admins after the
       * failure were never told, and the retry — which carries the same `openIdempotencyKey` —
       * returns `created: false` without re-notifying, so the partial fan-out was never repaired.
       */
      let sosNotified = 0;
      for (const a of admins) {
        const { delivered } = await notificationService.createForUserDetached(
          {
            userId: a.id,
            type: "SAFETY_SOS",
            title: "Partner SOS",
            message: "A partner activated SOS. Open Trust & Safety for live location.",
            referenceId: incident.id,
            referenceType: "safety_incident",
            priority: "urgent",
          },
          { incidentId: incident.id },
        );
        if (delivered) sosNotified += 1;
      }
      if (sosNotified < admins.length) {
        // A partially-delivered SOS is an operational fact someone must be able to see.
        logger.error("sos_admin_fanout_incomplete", {
          category: "SECURITY",
          incidentId: incident.id,
          notified: sosNotified,
          expected: admins.length,
        });
      }

      return { incident, created: true, emergencyContactMasked: provider?.emergencyContactPhone ? maskPhone(provider.emergencyContactPhone) : null };
    } catch (err) {
      if (isUnique(err)) {
        const again = await prisma.partnerSafetyIncident.findUnique({ where: { openIdempotencyKey: key } });
        if (again) return { incident: again, created: false };
      }
      throw err;
    }
  }

  async reportIssue(input: {
    providerId: string;
    userId: string;
    type: PartnerSafetyIncidentType;
    bookingId?: string | null;
    notes?: string;
  }) {
    const type = input.type === "SOS" ? "OTHER" : input.type;
    // Same ownership rule as the SOS path: a partner can only attach an incident to a booking
    // that is theirs. An unowned id is dropped, never persisted against someone else's booking.
    const ownedBookingId = input.bookingId
      ? (
          await prisma.booking.findFirst({
            where: { id: input.bookingId, providerId: input.providerId },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    const incident = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerSafetyIncident.create({
        data: {
          providerId: input.providerId,
          bookingId: ownedBookingId,
          type,
          severity: type === "THREAT" || type === "MEDICAL" ? "HIGH" : "MEDIUM",
          status: "OPEN",
          evidence: input.notes ? { notes: input.notes.slice(0, 500) } : undefined,
        },
      });
      await tx.activityLog.create({
        data: {
          providerId: input.providerId,
          userId: input.userId,
          action: "SAFETY_INCIDENT_CREATED",
          description: `${type} ${row.id}`,
        },
      });
      await emitInTransaction(
        tx,
        buildPartnerSafetyIncidentCreatedEvent({
          providerId: input.providerId,
          incidentId: row.id,
          type,
          severity: row.severity,
        }),
      );
      return row;
    }, TX_OPTS);
    return incident;
  }

  async partnerHistory(providerId: string) {
    return prisma.partnerSafetyIncident.findMany({
      where: { providerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        severity: true,
        createdAt: true,
        resolvedAt: true,
        bookingId: true,
      },
    });
  }

  async adminQueue(query: {
    status?: string;
    type?: string;
    severity?: string;
    providerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Prisma.PartnerSafetyIncidentWhereInput = {};
    if (query.status) where.status = query.status as PartnerSafetyIncidentStatus;
    if (query.type) where.type = query.type as PartnerSafetyIncidentType;
    if (query.severity) where.severity = query.severity;
    if (query.providerId) where.providerId = query.providerId;
    const [rows, total] = await Promise.all([
      prisma.partnerSafetyIncident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          provider: {
            select: {
              id: true,
              businessName: true,
              emergencyContactName: true,
              emergencyContactPhone: true,
              currentLocation: { select: { latitude: true, longitude: true, lastUpdated: true } },
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      prisma.partnerSafetyIncident.count({ where }),
    ]);
    return {
      page,
      limit,
      total,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        severity: r.severity,
        providerId: r.providerId,
        partnerName: r.provider.businessName || [r.provider.user.firstName, r.provider.user.lastName].filter(Boolean).join(" "),
        bookingId: r.bookingId,
        createdAt: r.createdAt,
        assignedTo: r.assignedTo,
        hasLocation: r.latitude != null,
      })),
    };
  }

  async adminDetail(id: string) {
    const row = await prisma.partnerSafetyIncident.findUnique({
      where: { id },
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            emergencyContactName: true,
            emergencyContactPhone: true,
            currentLocation: { select: { latitude: true, longitude: true, accuracy: true, lastUpdated: true } },
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!row) return null;
    const audits = await prisma.activityLog.findMany({
      where: { providerId: row.providerId, action: { startsWith: "SAFETY_" } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const { emergencyContactPhone, ...providerSafe } = row.provider;
    return {
      ...row,
      provider: providerSafe,
      emergencyContact: {
        name: row.provider.emergencyContactName,
        phoneMasked: emergencyContactPhone ? maskPhone(emergencyContactPhone) : null,
      },
      liveLocation: row.provider.currentLocation,
      timeline: audits.map((a) => ({
        id: a.id,
        action: a.action,
        description: a.description,
        createdAt: a.createdAt,
        userId: a.userId,
      })),
    };
  }

  async assign(id: string, actorId: string, assignedTo: string) {
    const row = await prisma.partnerSafetyIncident.update({
      where: { id },
      data: { assignedTo, assignedBy: actorId, assignedAt: new Date(), status: "ACKNOWLEDGED" },
    });
    await prisma.activityLog.create({
      data: {
        providerId: row.providerId,
        userId: actorId,
        action: "SAFETY_INCIDENT_ASSIGNED",
        description: assignedTo,
      },
    });
    return row;
  }

  async acknowledge(id: string, actorId: string) {
    const row = await prisma.partnerSafetyIncident.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
    });
    await prisma.activityLog.create({
      data: { providerId: row.providerId, userId: actorId, action: "SAFETY_INCIDENT_ACKNOWLEDGED" },
    });
    return row;
  }

  async resolve(id: string, actorId: string, notes: string) {
    const existing = await prisma.partnerSafetyIncident.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.partnerSafetyIncident.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: actorId,
          resolutionNotes: notes.slice(0, 2000),
          openIdempotencyKey: null,
        },
      });
      await tx.activityLog.create({
        data: {
          providerId: updated.providerId,
          userId: actorId,
          action: "SAFETY_INCIDENT_RESOLVED",
          description: notes.slice(0, 200),
        },
      });
      await emitInTransaction(
        tx,
        buildPartnerSafetyIncidentResolvedEvent({
          providerId: updated.providerId,
          incidentId: updated.id,
        }),
      );
      return updated;
    }, TX_OPTS);
    // X-60: an open incident gates START; resolving it may reopen the gate. Push the new gate to the
    // booking's parties (after commit). Dynamic import: booking-safety already imports this service.
    if (row.bookingId) {
      const bookingId = row.bookingId;
      void import("./booking-safety.service")
        .then(({ bookingSafetyService }) => bookingSafetyService.publishGateChange(bookingId, "SAFETY_INCIDENT_RESOLVED"))
        .catch((err) => logger.error("safety_incident_resolve_publish_failed", { incidentId: row.id, error: err instanceof Error ? err.message : String(err) }));
    }
    return row;
  }
}

export const partnerSafetyService = new PartnerSafetyService();
