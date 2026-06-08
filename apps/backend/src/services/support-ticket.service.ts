import { SupportPriorityLevel, SupportTicketStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { parsePagination } from "../lib/pagination";
import { entitlementService } from "./entitlement.service";

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

/**
 * Premium Support Queue — priority from EntitlementService, SLA tracked server-side.
 */
export class SupportTicketService {
  async resolvePriority(userId: string): Promise<SupportPriorityLevel> {
    const e = await entitlementService.resolve(userId);
    if (e.prioritySupport || e.hasMembership) return SupportPriorityLevel.HIGH;
    return SupportPriorityLevel.NORMAL;
  }

  async create(
    userId: string,
    body: {
      subject: string;
      description: string;
      category: string;
      bookingId?: string;
      attachments?: string[];
    },
  ) {
    const priorityLevel = await this.resolvePriority(userId);
    const slaDueAt = new Date(Date.now() + SLA_MS[priorityLevel]);

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber: nextTicketNumber(),
        userId,
        bookingId: body.bookingId,
        subject: body.subject,
        description: body.description,
        category: body.category,
        priority: priorityLevel.toLowerCase(),
        priorityLevel,
        slaDueAt,
        attachments: body.attachments ?? [],
      },
    });

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      priorityLevel: ticket.priorityLevel.toLowerCase(),
      slaDueAt: ticket.slaDueAt,
      status: ticket.status.toLowerCase(),
      createdAt: ticket.createdAt,
    };
  }

  async listForUser(userId: string, query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: { userId: string; status?: SupportTicketStatus } = { userId };
    if (query.status) where.status = query.status.toUpperCase() as SupportTicketStatus;

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

  async adminList(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: { status?: SupportTicketStatus; priorityLevel?: SupportPriorityLevel } = {};
    if (query.status) where.status = query.status.toUpperCase() as SupportTicketStatus;
    if (query.priority) where.priorityLevel = query.priority.toUpperCase() as SupportPriorityLevel;

    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priorityLevel: "asc" }, { createdAt: "asc" }],
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets: rows.map((t) => ({
        ...this.serialize(t),
        user: t.user ? `${t.user.firstName} ${t.user.lastName}` : null,
        email: t.user?.email,
      })),
      total,
      page,
    };
  }

  async adminRespond(ticketId: string, adminUserId: string, resolution: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const now = new Date();
    const firstResponse = !ticket.firstResponseAt;
    const responseTimeMs = firstResponse ? now.getTime() - ticket.createdAt.getTime() : ticket.responseTimeMs;

    return prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.IN_PROGRESS,
        resolution,
        resolvedBy: adminUserId,
        firstResponseAt: firstResponse ? now : ticket.firstResponseAt,
        responseTimeMs: firstResponse ? responseTimeMs : ticket.responseTimeMs,
      },
    });
  }

  async adminResolve(ticketId: string, adminUserId: string, resolution: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const now = new Date();
    const firstResponse = !ticket.firstResponseAt;
    const responseTimeMs = firstResponse ? now.getTime() - ticket.createdAt.getTime() : ticket.responseTimeMs;

    return prisma.supportTicket.update({
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
  }

  async adminAnalytics() {
    const [byPriority, slaBreached, avgResponse] = await Promise.all([
      prisma.supportTicket.groupBy({
        by: ["priorityLevel"],
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
    ]);

    const byPriorityMap = Object.fromEntries(
      byPriority.map((b) => [b.priorityLevel.toLowerCase(), b._count]),
    );

    return {
      openByPriority: byPriorityMap,
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
      slaBreached: t.slaDueAt ? t.slaDueAt < new Date() && t.status !== SupportTicketStatus.RESOLVED : false,
      resolution: t.resolution,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}

export const supportTicketService = new SupportTicketService();
