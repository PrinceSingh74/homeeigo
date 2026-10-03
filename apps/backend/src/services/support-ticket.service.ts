import { randomInt } from "node:crypto";
import { Prisma, SupportPriorityLevel, SupportTicketStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { isRetryablePrismaError } from "../lib/prisma-errors";
import { parsePagination } from "../lib/pagination";
import { entitlementService } from "./entitlement.service";
import { notificationService } from "./notification.service";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildSupportTicketCreatedEvent } from "../events/catalog/support-ops.events";

const SLA_MS: Record<SupportPriorityLevel, number> = {
  HIGH: 2 * 60 * 60 * 1000,
  NORMAL: 24 * 60 * 60 * 1000,
  LOW: 48 * 60 * 60 * 1000,
};

function nextTicketNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // 900k/day space. Retrying P2002 *inside* an open Postgres transaction is a no-op:
  // a unique violation aborts the txn, so the previous 8-attempt loop still failed soak.
  const seq = randomInt(100_000, 1_000_000);
  return `TKT-${d}-${seq}`;
}

function isTicketNumberConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String).join(",") : String(target ?? "");
  return fields.length === 0 || /ticket_number|ticketNumber/i.test(fields);
}

async function createTicketRow(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.SupportTicketUncheckedCreateInput, "ticketNumber"> & { ticketNumber?: string },
) {
  return tx.supportTicket.create({
    data: { ...data, ticketNumber: data.ticketNumber ?? nextTicketNumber() },
  });
}

const TX_OPTS = { maxWait: 30_000, timeout: 45_000 };

/** Max support-admin notifications per ticket event — prevents pool storms on large AdminUser tables. */
export const SUPPORT_NOTIFY_CAP = 25;

async function runTicketCreateTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.$transaction((tx) => fn(tx), TX_OPTS);
    } catch (err) {
      lastErr = err;
      if (isTicketNumberConflict(err)) continue;
      if (isRetryablePrismaError(err) && attempt < 7) {
        await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function runRetryableTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.$transaction((tx) => fn(tx), TX_OPTS);
    } catch (err) {
      lastErr = err;
      if (isRetryablePrismaError(err) && attempt < 7) {
        await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

    const ticket = await runTicketCreateTx(async (tx) => {
      const row = await createTicketRow(tx, {
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
      });
      await tx.supportTicketMessage.create({
        data: {
          ticketId: row.id,
          authorId: userId,
          authorRole: ctx.providerId ? "partner" : "user",
          body: body.description,
        },
      });

      /**
       * Phase 16 — the ticket and its event are written in ONE transaction.
       *
       * Inside `runTicketCreateTx` deliberately. This helper retries on ticket-number conflicts
       * and on retryable Prisma errors, re-running the whole closure each time — so emitting
       * outside it would publish an event for a ticket that a later attempt replaced, and
       * emitting after it would open a window where the ticket exists and the event does not.
       * Here, a rolled-back attempt takes its outbox row with it and a retry writes a fresh
       * event id for the row that actually survived.
       *
       * The payload carries ids and classification only — never the subject or description. See
       * `support-ops.events.ts` for why that is not merely a size decision.
       */
      await emitInTransaction(
        tx,
        buildSupportTicketCreatedEvent({
          ticketId: row.id,
          ticketNumber: row.ticketNumber,
          category: row.category,
          priorityLevel: row.priorityLevel,
          bookingId: row.bookingId,
          providerId: ctx.providerId,
          userId,
          slaDueAt: row.slaDueAt,
          createdAt: row.createdAt,
        }),
      );

      return row;
    });

    await this.notifySupportAdmins(
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

    await this.notifySupportAdmins(
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
    /**
     * Cap fan-out. Unbounded findMany over every SUPER/SUPPORT admin ever seeded
     * (measured 422+ rows on homigo_test after adversarial suites) turns each reply into
     * hundreds of concurrent notification.create calls and exhausts connection_limit=8 (P2024).
     * Prefer recently active admins; Alert Center / admin:ops WS remains the live queue signal.
     * AdminUser has lastLogin only — never orderBy updatedAt (field does not exist).
     */
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
      orderBy: { lastLogin: "desc" },
      take: SUPPORT_NOTIFY_CAP,
    });

    for (const admin of admins) {
      // Detached: the ticket mutation is committed. A throw here 500'd the API, and the retry
      // wrote a second ticket message plus a second 25-admin fan-out.
      await notificationService.createForUserDetached({
        userId: admin.userId,
        type: "SYSTEM",
        title: `Support queue — ${ticket.ticketNumber}`,
        message,
        referenceId: ticket.id,
        referenceType: "support_ticket",
      });
    }
  }

  private async notifyTicketUpdate(ticket: {
    id: string;
    ticketNumber: string;
    userId: string | null;
    providerId: string | null;
    subject: string;
  }, message: string) {
    if (ticket.userId) {
      await notificationService.createForUserDetached({
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
        await notificationService.createForUserDetached({
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

    const updated = await runRetryableTx(async (tx) => {
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

    // Await notifications so fire-and-forget cannot pile concurrent creates on the pool
    // while the next adminRespond transaction starts (soak 4 / connection_limit=8).
    if (!isInternal) {
      await this.notifyTicketUpdate(ticket, resolution.slice(0, 200));
    }
    await this.notifySupportAdmins(
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

    await this.notifyTicketUpdate(ticket, `Resolved: ${resolution.slice(0, 160)}`);
    await this.notifySupportAdmins(ticket, `Ticket ${ticket.ticketNumber} resolved`);
    return updated;
  }

  async adminEscalate(ticketId: string, adminUserId: string, note?: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return null;

    const updated = await runRetryableTx(async (tx) => {
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

    await this.notifyTicketUpdate(
      ticket,
      `Your ticket ${ticket.ticketNumber} has been escalated to high priority.`,
    );
    await this.notifySupportAdmins(ticket, `Escalated to HIGH — ${ticket.ticketNumber}`);
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

    await this.notifyTicketUpdate(
      primary,
      `Ticket ${duplicate.ticketNumber} was merged into ${primary.ticketNumber}.`,
    );
    await this.notifySupportAdmins(primary, `Merged ${duplicate.ticketNumber} → ${primary.ticketNumber}`);

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
