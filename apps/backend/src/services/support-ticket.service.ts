import { Prisma, SupportPriorityLevel, SupportTicketStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { parsePagination } from "../lib/pagination";
import { entitlementService } from "./entitlement.service";
import { notificationService } from "./notification.service";

const SLA_MS: Record<SupportPriorityLevel, number> = {
  HIGH: 2 * 60 * 60 * 1000,
  NORMAL: 24 * 60 * 60 * 1000,
  LOW: 48 * 60 * 60 * 1000,
};

function nextTicketNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seq = Math.floor(Math.random() * 90000) + 10000;
  return `TKT-${d}-${seq}`;
}

function parsePriority(raw?: string): SupportPriorityLevel | null {
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u === "HIGH" || u === "NORMAL" || u === "LOW") return u;
  return null;
}

/**
 * Premium Support Queue — priority from EntitlementService, SLA tracked server-side.
 */
export class SupportTicketService {
  async resolvePriority(userId: string): Promise<SupportPriorityLevel> {
    const e = await entitlementService.resolve(userId);
    if (e.prioritySupport || e.hasMembership) return SupportPriorityLevel.HIGH;
    return SupportPriorityLevel.NORMAL;
  }

  /** Accept booking UUID or HOMIGO booking reference; verify caller access. */
  private async resolveBookingLink(
    raw: string | undefined,
    userId: string,
    providerId?: string,
  ): Promise<string | undefined> {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: trimmed }, { bookingNumber: trimmed }],
      },
      select: { id: true, userId: true, providerId: true },
    });

    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    if (providerId) {
      if (booking.providerId !== providerId) throw new Error("BOOKING_ACCESS_DENIED");
    } else if (booking.userId !== userId) {
      throw new Error("BOOKING_ACCESS_DENIED");
    }

    return booking.id;
  }

  async create(
    userId: string,
    body: {
      subject: string;
      description: string;
      category: string;
      bookingId?: string;
      attachments?: string[];
      priorityLevel?: string;
    },
    ctx: { providerId?: string } = {},
  ) {
    const requested = parsePriority(body.priorityLevel);
    const entitlementPriority = await this.resolvePriority(userId);
    const priorityLevel =
      requested && requested === SupportPriorityLevel.HIGH
        ? entitlementPriority === SupportPriorityLevel.HIGH
          ? SupportPriorityLevel.HIGH
          : SupportPriorityLevel.NORMAL
        : requested ?? entitlementPriority;
    const slaDueAt = new Date(Date.now() + SLA_MS[priorityLevel]);
    const bookingId = await this.resolveBookingLink(body.bookingId, userId, ctx.providerId);

    const ticket = await prisma.$transaction(async (tx) => {
      const row = await tx.supportTicket.create({
        data: {
          ticketNumber: nextTicketNumber(),
          userId,
          providerId: ctx.providerId,
          bookingId,
          subject: body.subject,
          description: body.description,
          category: body.category,
          priority: priorityLevel.toLowerCase(),
          priorityLevel,
          slaDueAt,
          attachments: body.attachments ?? [],
        },
      });
      await tx.supportTicketMessage.create({
        data: {
          ticketId: row.id,
          authorId: userId,
          authorRole: ctx.providerId ? "partner" : "user",
          body: body.description,
        },
      });
      return row;
    });

    void this.notifySupportAdmins(
      ticket,
      `New ${ctx.providerId ? "partner" : "customer"} ticket: ${body.subject.slice(0, 120)}`,
    );

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      priorityLevel: ticket.priorityLevel.toLowerCase(),
      slaDueAt: ticket.slaDueAt,
      status: ticket.status.toLowerCase(),
      createdAt: ticket.createdAt,
    };
  }

  private accessWhere(
    userId: string,
    providerId?: string,
  ): Prisma.SupportTicketWhereInput {
    if (providerId) {
      return { OR: [{ userId }, { providerId }] };
    }
    return { userId };
  }

  async listForUser(
    userId: string,
    query: Record<string, string | undefined> = {},
    providerId?: string,
  ) {
    const { page, limit, skip } = parsePagination(query);
    const access = this.accessWhere(userId, providerId);
    const filters: Prisma.SupportTicketWhereInput[] = [access];

    if (query.status) {
      filters.push({ status: query.status.toUpperCase() as SupportTicketStatus });
    } else if (query.closed === "true") {
      filters.push({ status: { in: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED] } });
    } else if (query.closed === "false") {
      filters.push({ status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] } });
    }

    if (query.category) filters.push({ category: query.category });

    if (query.search?.trim()) {
      const q = query.search.trim();
      filters.push({
        OR: [
          { subject: { contains: q, mode: "insensitive" } },
          { ticketNumber: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.SupportTicketWhereInput = { AND: filters };

    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priorityLevel: "asc" }, { createdAt: "desc" }],
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets: rows.map((t) => this.serialize(t)),
      total,
      page,
    };
  }

  async getForUser(ticketId: string, userId: string, providerId?: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, ...this.accessWhere(userId, providerId) },
      include: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!ticket) return null;
    return {
      ...this.serialize(ticket),
      attachments: ticket.attachments,
      bookingId: ticket.bookingId,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        body: m.body,
        authorRole: m.authorRole,
        createdAt: m.createdAt,
      })),
    };
  }

  async userReply(ticketId: string, userId: string, body: string, providerId?: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, ...this.accessWhere(userId, providerId) },
    });
    if (!ticket) return { error: "NOT_FOUND" as const };
    if (ticket.status === SupportTicketStatus.CLOSED) {
      return { error: "CLOSED" as const };
    }

    const reopening = ticket.status === SupportTicketStatus.RESOLVED;
    const authorRole = providerId ? "partner" : "user";

    const msg = await prisma.$transaction(async (tx) => {
      const row = await tx.supportTicketMessage.create({
        data: {
          ticketId,
          authorId: userId,
          authorRole,
          body,
        },
      });
      if (reopening) {
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: SupportTicketStatus.OPEN,
            resolution: null,
            resolvedAt: null,
            resolvedBy: null,
          },
        });
      }
      return row;
    });

    void this.notifySupportAdmins(
      ticket,
      `${authorRole === "partner" ? "Partner" : "Customer"} replied on ${ticket.ticketNumber}`,
    );

    return { ok: true as const, message: msg };
  }

  async adminGet(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        provider: { select: { businessName: true, userId: true } },
        booking: { select: { id: true, bookingNumber: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!ticket) return null;
    return {
      ...this.serialize(ticket),
      email: ticket.user?.email,
      user: ticket.user ? `${ticket.user.firstName} ${ticket.user.lastName}` : null,
      providerName: ticket.provider?.businessName,
      source: ticket.providerId ? "partner" : "customer",
      attachments: ticket.attachments,
      bookingId: ticket.bookingId,
      bookingNumber: ticket.booking?.bookingNumber ?? null,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        body: m.body,
        authorRole: m.authorRole,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
      })),
    };
  }

  async adminList(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.SupportTicketWhereInput = {};
    // "all" (or empty) = no status filter; anything else maps to the enum.
    if (query.status && query.status.toLowerCase() !== "all") {
      where.status = query.status.toUpperCase() as SupportTicketStatus;
    }
    if (query.priority) where.priorityLevel = query.priority.toUpperCase() as SupportPriorityLevel;
    if (query.assigned === "open") {
      where.status = { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] };
    }
    // In-context filters (booking detail / partner command center cross-links).
    if (query.bookingId) where.bookingId = query.bookingId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { ticketNumber: { contains: q, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priorityLevel: "asc" }, { createdAt: "desc" }],
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          provider: { select: { businessName: true } },
          booking: { select: { bookingNumber: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets: rows.map((t) => ({
        ...this.serialize(t),
        user: t.user ? `${t.user.firstName} ${t.user.lastName}` : null,
        email: t.user?.email,
        providerName: t.provider?.businessName ?? null,
        bookingNumber: t.booking?.bookingNumber ?? null,
        source: t.providerId ? "partner" : "customer",
      })),
      total,
      page,
    };
  }

  private async notifySupportAdmins(
    ticket: { id: string; ticketNumber: string },
    message: string,
  ) {
    const admins = await prisma.adminUser.findMany({
      where: {
        isActive: true,
        role: {
          OR: [
            { name: "SUPER_ADMIN" },
            { name: "OPERATIONS_ADMIN" },
            { name: "SUPPORT_ADMIN" },
            { permissions: { some: { resource: "DISPUTES", action: "READ" } } },
          ],
        },
      },
      select: { userId: true },
    });

    await Promise.all(
      admins.map((admin) =>
        notificationService.createForUser({
          userId: admin.userId,
          type: "SYSTEM",
          title: `Support queue — ${ticket.ticketNumber}`,
          message,
          referenceId: ticket.id,
          referenceType: "support_ticket",
        }),
      ),
    );
  }

  private async notifyTicketUpdate(ticket: {
    id: string;
    ticketNumber: string;
    userId: string | null;
    providerId: string | null;
    subject: string;
  }, message: string) {
    if (ticket.userId) {
      await notificationService.createForUser({
        userId: ticket.userId,
        type: "SYSTEM",
        title: `Support update — ${ticket.ticketNumber}`,
        message,
        referenceId: ticket.id,
        referenceType: "support_ticket",
      });
    }
    if (ticket.providerId) {
      const provider = await prisma.provider.findUnique({
        where: { id: ticket.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        await notificationService.createForUser({
          userId: provider.userId,
          type: "SYSTEM",
          title: `Support update — ${ticket.ticketNumber}`,
          message,
          referenceId: ticket.id,
          referenceType: "support_ticket",
        });
      }
    }
  }

  async adminRespond(ticketId: string, adminUserId: string, resolution: string, isInternal = false) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const now = new Date();
    const firstResponse = !ticket.firstResponseAt;
    const responseTimeMs = firstResponse ? now.getTime() - ticket.createdAt.getTime() : ticket.responseTimeMs;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: {
          ticketId,
          authorId: adminUserId,
          authorRole: "admin",
          body: resolution,
          isInternal,
        },
      });
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: isInternal ? ticket.status : SupportTicketStatus.IN_PROGRESS,
          resolution: isInternal ? ticket.resolution : resolution,
          resolvedBy: adminUserId,
          firstResponseAt: firstResponse ? now : ticket.firstResponseAt,
          responseTimeMs: firstResponse ? responseTimeMs : ticket.responseTimeMs,
        },
      });
    });

    if (!isInternal) {
      void this.notifyTicketUpdate(ticket, resolution.slice(0, 200));
    }
    void this.notifySupportAdmins(
      ticket,
      `Ticket ${ticket.ticketNumber} updated by support team`,
    );
    return updated;
  }

  async adminResolve(ticketId: string, adminUserId: string, resolution: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const now = new Date();
    const firstResponse = !ticket.firstResponseAt;
    const responseTimeMs = firstResponse ? now.getTime() - ticket.createdAt.getTime() : ticket.responseTimeMs;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: {
          ticketId,
          authorId: adminUserId,
          authorRole: "admin",
          body: resolution,
        },
      });
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: SupportTicketStatus.RESOLVED,
          resolution,
          resolvedBy: adminUserId,
          resolvedAt: now,
          firstResponseAt: firstResponse ? now : ticket.firstResponseAt,
          responseTimeMs: firstResponse ? responseTimeMs : ticket.responseTimeMs,
        },
      });
    });

    void this.notifyTicketUpdate(ticket, `Resolved: ${resolution.slice(0, 160)}`);
    void this.notifySupportAdmins(ticket, `Ticket ${ticket.ticketNumber} resolved`);
    return updated;
  }

  async adminEscalate(ticketId: string, adminUserId: string, note?: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const updated = await prisma.$transaction(async (tx) => {
      if (note?.trim()) {
        await tx.supportTicketMessage.create({
          data: {
            ticketId,
            authorId: adminUserId,
            authorRole: "admin",
            body: note.trim(),
            isInternal: true,
          },
        });
      }
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          priorityLevel: SupportPriorityLevel.HIGH,
          priority: "high",
          slaDueAt: new Date(Date.now() + SLA_MS.HIGH),
          status:
            ticket.status === SupportTicketStatus.RESOLVED
              ? SupportTicketStatus.IN_PROGRESS
              : ticket.status,
        },
      });
    });

    void this.notifyTicketUpdate(
      ticket,
      `Your ticket ${ticket.ticketNumber} has been escalated to high priority.`,
    );
    void this.notifySupportAdmins(ticket, `Escalated to HIGH — ${ticket.ticketNumber}`);
    return updated;
  }

  async adminMerge(primaryId: string, duplicateId: string, adminUserId: string) {
    if (primaryId === duplicateId) return { error: "SAME_TICKET" as const };
    const [primary, duplicate] = await Promise.all([
      prisma.supportTicket.findUnique({ where: { id: primaryId } }),
      prisma.supportTicket.findUnique({ where: { id: duplicateId } }),
    ]);
    if (!primary || !duplicate) return { error: "NOT_FOUND" as const };

    await prisma.$transaction(async (tx) => {
      const dupMessages = await tx.supportTicketMessage.findMany({ where: { ticketId: duplicateId } });
      for (const m of dupMessages) {
        await tx.supportTicketMessage.create({
          data: {
            ticketId: primaryId,
            authorId: m.authorId,
            authorRole: m.authorRole,
            body: `[Merged from ${duplicate.ticketNumber}] ${m.body}`,
            isInternal: m.isInternal,
          },
        });
      }
      await tx.supportTicketMessage.create({
        data: {
          ticketId: primaryId,
          authorId: adminUserId,
          authorRole: "admin",
          body: `Merged duplicate ticket ${duplicate.ticketNumber}`,
          isInternal: true,
        },
      });
      await tx.supportTicket.update({
        where: { id: duplicateId },
        data: {
          status: SupportTicketStatus.CLOSED,
          resolution: `Merged into ${primary.ticketNumber}`,
          resolvedBy: adminUserId,
          resolvedAt: new Date(),
        },
      });
    });

    void this.notifyTicketUpdate(
      primary,
      `Ticket ${duplicate.ticketNumber} was merged into ${primary.ticketNumber}.`,
    );
    void this.notifySupportAdmins(primary, `Merged ${duplicate.ticketNumber} → ${primary.ticketNumber}`);

    return { ok: true as const, primaryId };
  }

  async adminAnalytics() {
    const [byPriority, slaBreached, avgResponse, openCount] = await Promise.all([
      prisma.supportTicket.groupBy({
        by: ["priorityLevel"],
        where: { status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] } },
        _count: true,
      }),
      prisma.supportTicket.count({
        where: {
          status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] },
          slaDueAt: { lt: new Date() },
        },
      }),
      prisma.supportTicket.aggregate({
        where: { responseTimeMs: { not: null } },
        _avg: { responseTimeMs: true },
      }),
      prisma.supportTicket.count({
        where: { status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] } },
      }),
    ]);

    const byPriorityMap = Object.fromEntries(
      byPriority.map((b) => [b.priorityLevel.toLowerCase(), b._count]),
    );

    return {
      openByPriority: byPriorityMap,
      openTotal: openCount,
      slaBreached,
      avgResponseTimeMs: Math.round(avgResponse._avg.responseTimeMs ?? 0),
      slaTargets: {
        high: SLA_MS.HIGH,
        normal: SLA_MS.NORMAL,
        low: SLA_MS.LOW,
      },
    };
  }

  private serialize(t: {
    id: string;
    ticketNumber: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
    priorityLevel: SupportPriorityLevel;
    status: SupportTicketStatus;
    slaDueAt: Date | null;
    firstResponseAt: Date | null;
    responseTimeMs: number | null;
    resolution: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      description: t.description,
      category: t.category,
      priorityLevel: t.priorityLevel.toLowerCase(),
      status: t.status.toLowerCase(),
      slaDueAt: t.slaDueAt,
      firstResponseAt: t.firstResponseAt,
      responseTimeMs: t.responseTimeMs,
      slaBreached:
        t.slaDueAt
          ? t.slaDueAt < new Date() && t.status !== SupportTicketStatus.RESOLVED && t.status !== SupportTicketStatus.CLOSED
          : false,
      resolution: t.resolution,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}

export const supportTicketService = new SupportTicketService();
