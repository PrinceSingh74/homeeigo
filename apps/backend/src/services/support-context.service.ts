import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { sanitizeInput } from "../ai/security/prompt-security";
import {
  SUPPORT_INTELLIGENCE_RULES_VERSION,
  SUPPORT_REASON,
  type SupportSignal,
  type SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10, Capabilities 1 and 5 — the authoritative context for one support ticket.
 *
 * ── Every value here comes from a system of record ─────────────────────────────
 *
 * Booking state from `bookings`, payment state from `payments`, refund state from
 * `refund_requests`, partner identity from `providers`. Nothing is inferred from what the customer
 * wrote, and nothing is computed by a model. A ticket saying "you charged me twice" produces a
 * *payment signal read from the payments table*, not a belief about double charging.
 *
 * ── Missing is a state, not a zero ─────────────────────────────────────────────
 *
 * A ticket with no linked booking gets `state: "MISSING", reasonCode: NOT_LINKED`, never
 * `{ status: "unknown" }` and never an empty object that reads as "nothing wrong". The difference
 * matters most on the money signals: "no refund exists" and "we could not read the refund table"
 * are opposite claims, and an agent will act differently on each.
 *
 * ── Ticket text is data ────────────────────────────────────────────────────────
 *
 * `recentMessages` carries customer and partner prose. It is sanitised, truncated and labelled with
 * its author role before it leaves here, and it is the *only* untrusted field in the structure. A
 * consumer that hands this to a model must keep it in the untrusted section of the prompt — the
 * classifier does exactly that.
 */

/** Message excerpts are bounded: a 40 kB complaint must not become a 40 kB prompt or audit row. */
const MESSAGE_EXCERPT_CHARS = 600;
const RECENT_MESSAGE_LIMIT = 8;

/** Beyond this, a read is reported STALE rather than presented as current. */
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

function ok<T>(value: T, source: string, observedAt: Date): SupportSignal<T> {
  const age = Date.now() - observedAt.getTime();
  return {
    state: "OK",
    value,
    source,
    observedAt: observedAt.toISOString(),
    freshness: age <= FRESHNESS_WINDOW_MS ? "FRESH" : "STALE",
  };
}

function missing<T>(source: string, reasonCode: SupportSignal<T>["reasonCode"]): SupportSignal<T> {
  return { state: "MISSING", value: null, source, observedAt: null, freshness: "UNKNOWN", reasonCode };
}

function unavailable<T>(source: string): SupportSignal<T> {
  return {
    state: "UNAVAILABLE", value: null, source, observedAt: null, freshness: "UNKNOWN",
    reasonCode: SUPPORT_REASON.SOURCE_UNAVAILABLE,
  };
}

function notAuthorized<T>(source: string): SupportSignal<T> {
  return {
    state: "NOT_AUTHORIZED", value: null, source, observedAt: null, freshness: "UNKNOWN",
    reasonCode: SUPPORT_REASON.NOT_AUTHORIZED,
  };
}

/**
 * What the requesting actor is allowed to see.
 *
 * Least privilege, spelled out rather than assumed. A support agent working a ticket needs booking
 * and payment state to answer it; a partner reading a ticket about their own job does not need the
 * customer's payment method or refund history, and a customer needs neither the partner's lifecycle
 * state nor internal notes.
 */
export type SupportContextScope = {
  /**
   * `admin` is an actor holding the existing DISPUTES permission with full financial visibility.
   * `support` is an agent working the queue: they need booking and refund *state* to answer a
   * ticket, but not the payment instrument or the customer's wider support history.
   */
  actorRole: "admin" | "support" | "customer" | "partner";
  actorUserId: string;
  /** Set when the actor is a partner, so ownership can be checked rather than trusted. */
  actorProviderId?: string;
};

/** Which signals each role may receive. Financial detail is admin-only. */
const SCOPE_RULES: Record<SupportContextScope["actorRole"], {
  payment: boolean; refund: boolean; partner: boolean; internalMessages: boolean; customerHistory: boolean;
}> = {
  admin: { payment: true, refund: true, partner: true, internalMessages: true, customerHistory: true },
  /**
   * A support agent sees what they need to answer the ticket and no more.
   *
   * `payment: false` is the deliberate one. An agent can be told a refund exists and what state it
   * is in — that is the question customers actually ask — without being shown the payment method
   * and amount, which is the part that turns a support queue into a financial data surface.
   */
  support: { payment: false, refund: true, partner: true, internalMessages: true, customerHistory: true },
  // A customer sees their own booking and whether a refund exists, but not the partner's record.
  customer: { payment: true, refund: true, partner: false, internalMessages: false, customerHistory: false },
  // A partner sees the booking they worked. Not the customer's money, not their own lifecycle audit.
  partner: { payment: false, refund: false, partner: false, internalMessages: false, customerHistory: false },
};

export const supportContextService = {
  /**
   * Assemble the context for one ticket.
   *
   * Ownership is verified before anything is read: a customer may only build context for their own
   * ticket, and a partner only for a ticket linked to their provider record. The check is a
   * database comparison, not a trusted parameter.
   */
  async build(ticketId: string, scope: SupportContextScope): Promise<SupportTicketContext | null> {
    const generatedAt = new Date().toISOString();
    const limitations: string[] = [];

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, ticketNumber: true, status: true, category: true, createdAt: true,
        slaDueAt: true, firstResponseAt: true, userId: true, providerId: true, bookingId: true,
      },
    });
    if (!ticket) return null;

    // Ownership, checked against the row rather than taken from the caller.
    if (scope.actorRole === "customer" && ticket.userId !== scope.actorUserId) return null;
    if (scope.actorRole === "partner" && ticket.providerId !== scope.actorProviderId) return null;

    const rules = SCOPE_RULES[scope.actorRole];

    const messages = await prisma.supportTicketMessage.findMany({
      where: rules.internalMessages ? { ticketId } : { ticketId, isInternal: false },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_LIMIT,
      select: { authorRole: true, body: true, createdAt: true, isInternal: true },
    });
    const messageCount = await prisma.supportTicketMessage.count({ where: { ticketId } });

    const [customer, booking, payment, refund, partner] = await Promise.all([
      rules.customerHistory ? this.customerSignal(ticket.userId) : Promise.resolve(notAuthorized<never>("supportTicket.user")),
      this.bookingSignal(ticket.bookingId),
      rules.payment ? this.paymentSignal(ticket.bookingId) : Promise.resolve(notAuthorized<never>("payments")),
      rules.refund ? this.refundSignal(ticket.bookingId) : Promise.resolve(notAuthorized<never>("refund_requests")),
      rules.partner ? this.partnerSignal(ticket.providerId) : Promise.resolve(notAuthorized<never>("providers")),
    ]);

    for (const [name, sig] of Object.entries({ customer, booking, payment, refund, partner })) {
      if (sig.state !== "OK") limitations.push(`${name}: ${sig.state}${sig.reasonCode ? ` (${sig.reasonCode})` : ""}`);
    }

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      declaredCategory: ticket.category,
      createdAt: ticket.createdAt.toISOString(),
      slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      // Computed only from the existing `slaDueAt` the support service already maintains.
      slaBreached: ticket.slaDueAt ? Date.now() > ticket.slaDueAt.getTime() && ticket.firstResponseAt === null : null,
      messageCount,
      recentMessages: messages.map((m) => ({
        role: m.authorRole,
        at: m.createdAt.toISOString(),
        // Sanitised and bounded. This is the only untrusted field in the structure.
        excerpt: sanitizeInput(m.body).slice(0, MESSAGE_EXCERPT_CHARS),
        isInternal: m.isInternal,
      })),
      customer, booking, payment, refund, partner,
      limitations,
      generatedAt,
      rulesVersion: SUPPORT_INTELLIGENCE_RULES_VERSION,
    } as SupportTicketContext;
  },

  /** Prior support history, as counts only. No other ticket's contents crosses this boundary. */
  async customerSignal(userId: string | null): Promise<SupportTicketContext["customer"]> {
    const source = "support_tickets";
    if (!userId) return missing(source, SUPPORT_REASON.NOT_LINKED);
    try {
      const [priorSupportTickets, priorResolved] = await Promise.all([
        prisma.supportTicket.count({ where: { userId } }),
        prisma.supportTicket.count({ where: { userId, status: "RESOLVED" } }),
      ]);
      return ok({ userId, priorSupportTickets, priorResolved }, source, new Date());
    } catch (err) {
      logger.warn("support_context_customer_unavailable", { error: String(err).slice(0, 200) });
      return unavailable(source);
    }
  },

  async bookingSignal(bookingId: string | null): Promise<SupportTicketContext["booking"]> {
    const source = "bookings";
    if (!bookingId) return missing(source, SUPPORT_REASON.NOT_LINKED);
    try {
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, bookingNumber: true, status: true, scheduledDate: true, completedAt: true },
      });
      if (!b) return missing(source, SUPPORT_REASON.DATA_NOT_FOUND);
      return ok({
        id: b.id, number: b.bookingNumber, status: b.status,
        scheduledDate: b.scheduledDate?.toISOString() ?? null,
        completedAt: b.completedAt?.toISOString() ?? null,
      }, source, new Date());
    } catch (err) {
      logger.warn("support_context_booking_unavailable", { error: String(err).slice(0, 200) });
      return unavailable(source);
    }
  },

  /**
   * Payment state, read from the payments table.
   *
   * The amounts are carried exactly as stored. Nothing here adds, subtracts or converts them, and
   * no consumer may recompute a refundable amount from these numbers — that is the finance
   * service's job, and Phase 10 does not do finance arithmetic.
   */
  async paymentSignal(bookingId: string | null): Promise<SupportTicketContext["payment"]> {
    const source = "payments";
    if (!bookingId) return missing(source, SUPPORT_REASON.NOT_LINKED);
    try {
      const p = await prisma.payment.findUnique({
        where: { bookingId },
        select: { id: true, status: true, amount: true, refundedAmount: true, paymentMethod: true },
      });
      if (!p) return missing(source, SUPPORT_REASON.DATA_NOT_FOUND);
      return ok({
        id: p.id, status: p.status, amount: p.amount,
        refundedAmount: p.refundedAmount, method: p.paymentMethod,
      }, source, new Date());
    } catch (err) {
      logger.warn("support_context_payment_unavailable", { error: String(err).slice(0, 200) });
      return unavailable(source);
    }
  },

  /** Refund state. Presence of a request is a fact; eligibility for one is not decided here. */
  async refundSignal(bookingId: string | null): Promise<SupportTicketContext["refund"]> {
    const source = "refund_requests";
    if (!bookingId) return missing(source, SUPPORT_REASON.NOT_LINKED);
    try {
      const payment = await prisma.payment.findUnique({ where: { bookingId }, select: { id: true } });
      if (!payment) return missing(source, SUPPORT_REASON.DATA_NOT_FOUND);
      const [requests, latest] = await Promise.all([
        prisma.refundRequest.count({ where: { paymentId: payment.id } }),
        prisma.refundRequest.findFirst({
          where: { paymentId: payment.id },
          orderBy: { createdAt: "desc" },
          select: { status: true, amount: true },
        }),
      ]);
      return ok({
        requests,
        latestStatus: latest?.status ?? null,
        latestAmount: latest?.amount ?? null,
      }, source, new Date());
    } catch (err) {
      logger.warn("support_context_refund_unavailable", { error: String(err).slice(0, 200) });
      return unavailable(source);
    }
  },

  async partnerSignal(providerId: string | null): Promise<SupportTicketContext["partner"]> {
    const source = "providers";
    if (!providerId) return missing(source, SUPPORT_REASON.NOT_LINKED);
    try {
      const p = await prisma.provider.findUnique({
        where: { id: providerId },
        select: { id: true, businessName: true, lifecycleState: true },
      });
      if (!p) return missing(source, SUPPORT_REASON.DATA_NOT_FOUND);
      return ok({ providerId: p.id, businessName: p.businessName, lifecycleState: p.lifecycleState }, source, new Date());
    } catch (err) {
      logger.warn("support_context_partner_unavailable", { error: String(err).slice(0, 200) });
      return unavailable(source);
    }
  },
};
