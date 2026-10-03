import { evictProviderFromBooking } from "../lib/ws-eviction";
import { PaymentStatus, BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { isBusinessRow } from "../lib/analytics-scope";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildBookingAssignedEvent, buildBookingRescheduledEvent } from "../events/catalog/booking.events";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { bookingRequirementService } from "./booking-requirement.service";
import {
  isReassignableBookingStatus,
  REASSIGNABLE_BOOKING_STATUSES,
  RESCHEDULABLE_BOOKING_STATUSES,
} from "../lib/booking-state-machine";
import type { AdminRefundPolicy } from "./cancellation-policy.service";
import { incCounter } from "../lib/metrics";
import { publishBookingStatusBackground } from "../lib/booking-realtime";
import { addressPiiService } from "./address-pii.service";
import { bookingService } from "./booking.service";
import { bookingRefundService } from "./booking-refund.service";
import { assignmentEngine } from "./assignment-engine.service";
import { AuditLogService } from "./audit-log.service";
import { notificationService } from "./notification.service";
import { bookingValidationService } from "./booking-validation.service";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { evaluatePaymentGate, isNoPaymentFollowUp, PAYMENT_GATE_REASON } from "./booking-payment-gate";
import { partnerOperationsService } from "./partner-operations.service";
import {
  dispatchEligibilityService,
  isPresenceLocationOnlyBlock,
} from "./dispatch-eligibility.service";
import type { AdminAssignmentOverride } from "../lib/dispatch-eligibility.types";

export type AdminBookingAction =
  | "CANCEL"
  | "REASSIGN"
  | "RESCHEDULE"
  | "FORCE_DISPATCH"
  /** Dispatching a booking whose payment has not settled. Always carries an admin id and reason. */
  | "PAYMENT_GATE_OVERRIDE"
  | "MARK_COMPLETE"
  | "REPAIR"
  | "REFUND"
  | "RETRY_REFUND"
  | "DISPATCH_ELIGIBILITY_OVERRIDE";

export class AdminBookingOperationsService {
  async getDetail(bookingId: string, viewer?: { adminId: string; ipAddress?: string }) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
        provider: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        service: { select: { id: true, name: true, category: true } },
        // Full address row (incl. encrypted PII fields) — decrypted explicitly below via
        // addressPiiService.withDecrypted. Admin-only + audited (see recordAddressView).
        address: true,
        payment: true,
        rating: true,
      },
    });
    if (!booking) return null;

    const [assignmentJob, assignmentAttempts, activityLogs, supportTickets, adminActions, statusHistory] =
      await Promise.all([
        prisma.assignmentJob.findUnique({
          where: { bookingId },
          include: { attempts: { orderBy: { dispatchedAt: "desc" }, take: 20 } },
        }),
        prisma.assignmentAttempt.findMany({
          where: { job: { bookingId } },
          orderBy: { dispatchedAt: "desc" },
          take: 20,
          include: { provider: { select: { businessName: true } } },
        }),
        prisma.activityLog.findMany({
          where: { bookingId },
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
        prisma.supportTicket.findMany({
          where: { bookingId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, ticketNumber: true, status: true, subject: true, createdAt: true },
        }),
        prisma.activityLog.findMany({
          where: { bookingId, action: { startsWith: "ADMIN_BOOKING_" } },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        // Authoritative, trigger-written history (status / partner / payment / schedule), oldest first.
        prisma.bookingStatusHistory.findMany({ where: { bookingId }, orderBy: { id: "asc" }, take: 200 }),
      ]);

    const timeline = this.buildTimeline(booking, activityLogs, assignmentAttempts, adminActions);

    // PII access control: decrypt the service address (admin-only route), return display fields only
    // (never the raw encrypted blobs), and audit + meter every view.
    let address: {
      id: string; label: string | null; addressLine1: string; addressLine2: string | null;
      city: string | null; state: string | null; zipCode: string | null; landmark: string | null;
      latitude: number | null; longitude: number | null;
    } | null = null;
    if (booking.address) {
      const d = await addressPiiService.withDecrypted(booking.address);
      address = {
        id: d.id, label: d.label, addressLine1: d.addressLine1, addressLine2: d.addressLine2,
        city: d.city, state: d.state, zipCode: d.zipCode, landmark: d.landmark,
        latitude: d.latitude, longitude: d.longitude,
      };
      if (viewer?.adminId) await this.recordAddressView(bookingId, viewer.adminId, viewer.ipAddress);
    }

    return {
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        scheduledDate: booking.scheduledDate,
        finalAmount: booking.finalAmount,
        addons: booking.addons ?? undefined,
        description: booking.description,
        createdAt: booking.createdAt,
        acceptedAt: booking.acceptedAt,
        startedAt: booking.startedAt,
        completedAt: booking.completedAt,
        cancelledAt: booking.cancelledAt,
        user: booking.user,
        provider: booking.provider
          ? {
              id: booking.provider.id,
              name: `${booking.provider.user.firstName} ${booking.provider.user.lastName}`,
              businessName: booking.provider.businessName,
            }
          : null,
        service: booking.service,
        address,
        payment: booking.payment,
        rating: booking.rating,
      },
      assignment: assignmentJob,
      dispatchAttempts: assignmentAttempts,
      supportTickets,
      timeline,
      statusHistory: statusHistory.map((h) => ({
        at: h.changedAt,
        status: { from: h.oldStatus, to: h.newStatus },
        provider: { from: h.oldProviderId, to: h.newProviderId },
        payment: { from: h.oldPaymentStatus, to: h.newPaymentStatus },
        schedule: h.oldScheduledDate ? { from: h.oldScheduledDate, to: h.newScheduledDate } : null,
        actor: h.actorType ? { type: h.actorType, id: h.actorId } : null,
        reason: h.reason,
        requestId: h.requestId,
      })),
    };
  }

  private buildTimeline(
    booking: { status: BookingStatus; createdAt: Date; acceptedAt: Date | null; startedAt: Date | null; completedAt: Date | null; cancelledAt: Date | null },
    activityLogs: Array<{ action: string; description: string | null; createdAt: Date; userId: string | null }>,
    attempts: Array<{ status: string; dispatchedAt: Date; respondedAt: Date | null; provider?: { businessName: string | null } }>,
    adminActions: Array<{ action: string; description: string | null; createdAt: Date }>,
  ) {
    const events: Array<{ type: string; label: string; at: string; details?: string }> = [];

    events.push({ type: "booking", label: "Booking created", at: booking.createdAt.toISOString() });
    if (booking.acceptedAt) {
      events.push({ type: "booking", label: "Accepted", at: booking.acceptedAt.toISOString() });
    }
    if (booking.startedAt) {
      events.push({ type: "booking", label: "Service started", at: booking.startedAt.toISOString() });
    }
    if (booking.completedAt) {
      events.push({ type: "booking", label: "Completed", at: booking.completedAt.toISOString() });
    }
    if (booking.cancelledAt) {
      events.push({ type: "booking", label: "Cancelled", at: booking.cancelledAt.toISOString() });
    }

    for (const a of attempts) {
      events.push({
        type: "dispatch",
        label: `Dispatch → ${a.provider?.businessName ?? "provider"}`,
        at: a.dispatchedAt.toISOString(),
        details: a.status,
      });
    }

    for (const log of activityLogs) {
      if (log.action.startsWith("ADMIN_BOOKING_")) continue;
      events.push({
        type: "activity",
        label: log.action,
        at: log.createdAt.toISOString(),
        details: log.description ?? undefined,
      });
    }

    for (const a of adminActions) {
      events.push({
        type: "admin",
        label: a.action.replace("ADMIN_BOOKING_", ""),
        at: a.createdAt.toISOString(),
        details: a.description ?? undefined,
      });
    }

    return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  private async recordAdminAction(
    bookingId: string,
    adminId: string,
    action: AdminBookingAction,
    reason: string,
    ipAddress?: string,
    beforeState?: string,
    afterState?: string,
  ) {
    await prisma.activityLog.create({
      data: {
        bookingId,
        userId: adminId,
        action: `ADMIN_BOOKING_${action}`,
        description: `${reason}${beforeState ? ` | before: ${beforeState}` : ""}${afterState ? ` | after: ${afterState}` : ""}`,
        ipAddress,
      },
    });

    void AuditLogService.success("ADMIN_ACTION", {
      userId: adminId,
      ipAddress,
      reason,
      details: { bookingId, action, beforeState, afterState },
    });
  }

  /**
   * Enterprise PII access trail: every time an admin views a booking's decrypted service address,
   * record who/when/which-booking (activity log), increment a Prometheus counter, and emit the
   * ADMIN_ADDRESS_ACCESSED security event. Never silently expose PII.
   */
  private async recordAddressView(bookingId: string, adminId: string, ipAddress?: string) {
    const viewedAt = new Date();
    await prisma.activityLog.create({
      data: {
        bookingId,
        userId: adminId,
        action: "ADMIN_ADDRESS_ACCESSED",
        description: `Admin ${adminId} viewed booking ${bookingId} service address | viewedBy=${adminId} viewedAt=${viewedAt.toISOString()}`,
        ipAddress,
      },
    });
    incCounter("admin_address_view_total", { role: "ADMIN" });
    void AuditLogService.success("ADMIN_ADDRESS_ACCESSED", {
      userId: adminId,
      ipAddress,
      reason: "admin_booking_detail_address_view",
      details: { bookingId, viewedBy: adminId, viewedAt: viewedAt.toISOString() },
    });
  }

  /**
   * Admin cancellation goes through the one cancellation path (bookingService.cancel) with an
   * explicit admin actor — status guard, refund, offer cleanup, outbox event and notifications
   * included. It used to call cancel() as if the admin were the customer, get NOT_FOUND back, and
   * then write CANCELLED_BY_USER directly: no status guard (a COMPLETED booking could be
   * "cancelled"), no refund, open offers left holding partner capacity, no event.
   *
   * A terminal booking is refused (INVALID_STATUS). There is no admin "reversal" of a completed job
   * in this system; money for one moves through the refund tools, not through a status write.
   */
  async cancelBooking(
    bookingId: string,
    adminId: string,
    reason: string,
    ipAddress?: string,
    refundPolicy: AdminRefundPolicy = "customer_policy",
  ) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const beforeStatus = booking.status;
    const result = await bookingService.cancel({ userId: adminId, admin: { refundPolicy } }, bookingId, `[Admin] ${reason}`);
    if ("error" in result) {
      incCounter("admin_booking_cancel_refused_total", { reason: result.error ?? "unknown" });
      throw new Error(result.error === "INVALID_STATUS" ? "BOOKING_NOT_CANCELLABLE" : result.error ?? "CANCEL_FAILED");
    }

    await this.recordAdminAction(
      bookingId,
      adminId,
      "CANCEL",
      `${reason} (refund policy: ${refundPolicy}, refund ₹${result.refundAmount})`,
      ipAddress,
      beforeStatus,
      String(result.status),
    );
    return { ...result, refundPolicy };
  }

  async rescheduleBooking(
    bookingId: string,
    adminId: string,
    scheduledDate: string,
    reason: string,
    ipAddress?: string,
  ) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const scheduled = new Date(scheduledDate);
    if (Number.isNaN(scheduled.getTime())) throw new Error("INVALID_SCHEDULED_DATE");
    // A finished or cancelled booking has no future to move. Without this, an admin could set a new
    // scheduledDate on a COMPLETED job — rewriting history and re-reserving a slot for work already
    // done. Admins may still move a live booking to any instant, including outside the service's
    // published window; that is a deliberate override, and it is recorded by recordAdminAction.
    if (!RESCHEDULABLE_BOOKING_STATUSES.includes(booking.status)) throw new Error("BOOKING_NOT_RESCHEDULABLE");
    const beforeDate = booking.scheduledDate.toISOString();

    await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `rescheduled by admin: ${reason}` });
      const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
        userId: booking.userId,
        providerId: booking.providerId,
        scheduledDate: scheduled,
        excludeBookingId: bookingId,
        slotDurationMinutes: booking.slotDurationMinutes,
      });
      if (conflict) throw new Error(conflict.code);

      await tx.booking.update({
        where: { id: bookingId },
        data: { scheduledDate: scheduled },
      });

      // Same event as a customer reschedule, from the same kind of transaction — the actor differs,
      // the fact does not.
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingRescheduledEvent({
            bookingId,
            userId: booking.userId,
            providerId: booking.providerId,
            previousScheduledAt: booking.scheduledDate,
            scheduledAt: scheduled,
            actorType: "admin",
            actorId: adminId,
          }),
        );
      }
    });

    if (booking.providerId) {
      const provider = await prisma.provider.findUnique({
        where: { id: booking.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        void notificationService.createForUserDetached({
          userId: provider.userId,
          type: "SYSTEM",
          title: "Booking rescheduled by admin",
          message: reason,
          referenceId: bookingId,
          referenceType: "booking",
        });
      }
    }

    await this.recordAdminAction(
      bookingId,
      adminId,
      "RESCHEDULE",
      reason,
      ipAddress,
      beforeDate,
      scheduled.toISOString(),
    );

    return { ok: true, scheduledDate: scheduled.toISOString() };
  }

  async reassignProvider(
    bookingId: string,
    adminId: string,
    providerId: string,
    reason: string,
    ipAddress?: string,
    /**
     * Set only when an administrator is deliberately dispatching a booking that has not been paid
     * for. Absent, this path enforces the same gate as partner accept — administrative access is
     * not the same thing as an intent to override, and treating it as such would mean the gate
     * simply did not apply to admins.
     */
    overridePaymentGate = false,
    emergencyOverride?: AdminAssignmentOverride,
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { address: { select: { latitude: true, longitude: true } } },
    });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    // Fast refusal; re-checked under the row lock below.
    if (!isReassignableBookingStatus(booking.status)) throw new Error("BOOKING_NOT_REASSIGNABLE");

    /**
     * W2-D4 — an admin cannot move a booking across populations.
     *
     * `assertOfferEligible` below checks ban, lifecycle, presence, capacity and geography, but not
     * provenance, so support could hand a REAL customer's booking to a fixture partner — or put a
     * certification booking on a real partner's calendar. Not overridable: the emergency override
     * exists for stale presence and location, and population is neither. A booking whose partner
     * does not exist is not an emergency fix, it is the defect.
     */
    const [customerOrigin, partnerOrigin] = await Promise.all([
      prisma.user.findUnique({ where: { id: booking.userId }, select: { dataOrigin: true } }),
      prisma.provider.findUnique({ where: { id: providerId }, select: { user: { select: { dataOrigin: true } } } }),
    ]);
    if (
      customerOrigin &&
      partnerOrigin &&
      isBusinessRow(customerOrigin.dataOrigin) !== isBusinessRow(partnerOrigin.user.dataOrigin)
    ) {
      incCounter("admin_reassignment_rejections", { reason: "POPULATION_MISMATCH" });
      throw new Error("REASSIGN_BLOCKED:POPULATION_MISMATCH");
    }

    /**
     * Admin assignment is a separate write path to partner commitment.
     *
     * The audit that found this recorded it plainly: `accept()` was the only place anyone thought
     * to guard, and this method reaches ASSIGNED without going near it. Gating one and not the
     * other leaves the rule true only for the path someone happened to look at.
     */
    const gate = evaluatePaymentGate(
      booking.paymentStatus,
      overridePaymentGate ? { adminId, reason } : null,
    );
    // §11: a case-created follow-up with its fee waived owes nothing (never marked paid).
    const noPaymentFollowUp = !gate.allowed && (await isNoPaymentFollowUp(bookingId));
    if (!gate.allowed && !noPaymentFollowUp) throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);

    if (gate.overridden) {
      /**
       * Written before the assignment, not after.
       *
       * The later gates treat this row as the authorisation itself, so if the assignment succeeded
       * and the audit write then failed, the booking would be dispatched with no record of who
       * allowed it — and `start()` would refuse it, stranding the partner.
       */
      await this.recordAdminAction(
        bookingId,
        adminId,
        "PAYMENT_GATE_OVERRIDE",
        reason,
        ipAddress,
        `paymentStatus: ${booking.paymentStatus}`,
        "dispatched unpaid by admin override",
      );
    }

    const beforeProvider = booking.providerId;
    const jobCtx = {
      latitude: booking.address?.latitude ?? 0,
      longitude: booking.address?.longitude ?? 0,
      scheduledDate: booking.scheduledDate,
      // Phase 11: an admin reassignment re-runs the provenance + typed capability gates for the
      // booking's service (not overridable: the emergency override covers presence/location only).
      capability: { serviceId: booking.serviceId, customerId: booking.userId },
    };

    let closedOfferProviderIds: string[] = [];
    let lockedProviderId: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
      /**
       * The row lock serialises this with a partner's accept (which also locks the row). Whichever
       * commits second sees the other's result: an accept after this sees ASSIGNED to someone else
       * (ALREADY_CLAIMED); this after an accept sees ACCEPTED — still reassignable, by an explicit
       * admin decision, and the displaced partner is evicted below. Status, payment gate and the
       * current partner are all read under this lock, never from the earlier unlocked read.
       *
       * FOR NO KEY UPDATE, not FOR UPDATE: it still conflicts with accept's lock, but not with the
       * KEY SHARE lock a foreign-key check takes — recordAdminAction below writes activity_logs
       * (FK → bookings) on another connection, and under FOR UPDATE it waited on this very
       * transaction until the timeout.
       */
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `reassigned: ${reason}` });
      const rows = await tx.$queryRaw<Array<{ status: BookingStatus; payment_status: PaymentStatus; provider_id: string | null }>>`
        SELECT status, payment_status, provider_id FROM bookings WHERE id = ${bookingId} FOR NO KEY UPDATE`;
      const row = rows[0];
      if (!row) throw new Error("BOOKING_NOT_FOUND");
      if (!isReassignableBookingStatus(row.status)) throw new Error("BOOKING_NOT_REASSIGNABLE");
      if (!evaluatePaymentGate(row.payment_status, overridePaymentGate ? { adminId, reason } : null).allowed && !(await isNoPaymentFollowUp(bookingId, tx))) {
        throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);
      }
      lockedProviderId = row.provider_id;

      const blocked = await partnerOperationsService.assertOfferEligible(tx, providerId, jobCtx);
      if (blocked) {
        const mayOverride =
          emergencyOverride != null &&
          isPresenceLocationOnlyBlock(blocked) &&
          emergencyOverride.adminId === adminId;
        if (!mayOverride) {
          incCounter("admin_reassignment_rejections", { reason: blocked });
          throw new Error(`REASSIGN_BLOCKED:${blocked}`);
        }
        await this.recordAdminAction(
          bookingId,
          adminId,
          "DISPATCH_ELIGIBILITY_OVERRIDE",
          emergencyOverride.reason,
          ipAddress,
          blocked,
          JSON.stringify({
            overrideType: emergencyOverride.overrideType,
            overrideActor: emergencyOverride.adminId,
            overrideTimestamp: new Date().toISOString(),
            overrideAuditId: emergencyOverride.overrideAuditId ?? null,
            targetProviderId: providerId,
            bypassedGate: blocked,
          }),
        );
      }

      const moved = await tx.booking.updateMany({
        where: { id: bookingId, status: { in: [...REASSIGNABLE_BOOKING_STATUSES] } },
        data: { providerId, status: BookingStatus.ASSIGNED, assignedAt: new Date() },
      });
      if (moved.count === 0) throw new Error("BOOKING_NOT_REASSIGNABLE");

      // Same event a partner accept emits, in the same transaction, so consumers (audit, dispatch-
      // stall automation, notifications) see admin assignments too — they used to be invisible.
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingAssignedEvent({
            bookingId,
            userId: booking.userId,
            providerId,
            serviceId: booking.serviceId,
            assignedAt: new Date(),
            eta: null,
            actorType: "admin",
            actorId: adminId,
          }),
        );
      }

      // Every other partner's open offer is superseded in the same transaction: a stale offer can no
      // longer be accepted (the booking is not PENDING) and no longer holds anyone's capacity.
      closedOfferProviderIds = await assignmentEngine.closeOffersInTx(tx, bookingId, { kind: "reassigned", providerId, adminId });
      });
    } catch (err) {
      // The DB slot exclusion refused the new partner: they already have a job at this time.
      if (err instanceof Error && /bookings_provider_slot_excl|exclusion constraint/i.test(err.message)) {
        incCounter("admin_reassignment_rejections", { reason: "PROVIDER_SLOT_CONFLICT" });
        throw new Error("REASSIGN_BLOCKED:PROVIDER_SLOT_CONFLICT", { cause: err });
      }
      throw err;
    }

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { userId: true },
    });
    // The displaced partner's live sockets lose the booking rooms first, so the ASSIGNED frame that
    // names their replacement (and every GPS frame after it) never reaches them.
    const displaced = new Set<string>([...closedOfferProviderIds, ...(lockedProviderId ? [lockedProviderId] : []), ...(beforeProvider ? [beforeProvider] : [])]);
    displaced.delete(providerId);
    for (const pid of displaced) {
      await evictProviderFromBooking(bookingId, pid, "reassigned");
    }
    // §6: the previous partner's on-site checks are not the new partner's evidence.
    if (beforeProvider !== providerId) {
      await bookingRequirementService.resetPartnerChecksAfterReassignment({ bookingId, adminId, reason });
    }
    publishBookingStatusBackground({
      bookingId,
      status: BookingStatus.ASSIGNED,
      providerUserId: provider?.userId ?? null,
      extra: { providerId, assignedBy: "admin" },
    });
    if (provider?.userId) {
      void notificationService.createForUserDetached({
        userId: provider.userId,
        type: "booking_reassigned",
        title: "Booking assigned",
        message: reason,
        referenceId: bookingId,
        referenceType: "booking",
      });
    }

    await this.recordAdminAction(
      bookingId,
      adminId,
      "REASSIGN",
      reason,
      ipAddress,
      beforeProvider ?? "none",
      providerId,
    );

    void dispatchEligibilityService.trackProviderEligibilityTransition(providerId).catch(() => undefined);

    return { ok: true, providerId };
  }

  async forceDispatch(bookingId: string, adminId: string, reason: string, ipAddress?: string) {
    const sent = await assignmentEngine.dispatchBookingNow(bookingId);
    await this.recordAdminAction(bookingId, adminId, "FORCE_DISPATCH", reason, ipAddress, undefined, sent ? "DISPATCHED" : "NO_OP");
    return { dispatched: sent };
  }

  async markComplete(bookingId: string, adminId: string, reason: string, ipAddress?: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const beforeStatus = booking.status;

    // Same completion + earnings path as partner complete — never leave COMPLETED without Earning.
    if (!booking.providerId) {
      throw new Error("NO_ASSIGNED_PROVIDER");
    }

    const { bookingService } = await import("./booking.service");
    try {
      const result = await bookingService.complete(
        booking.providerId,
        bookingId,
        0,
        0,
        `[Admin] ${reason}`,
        // §5: the history records the admin who did this, not the partner it was done on behalf of.
        { auditActor: { actorType: "admin", actorId: adminId, reason } },
      );
      await this.recordAdminAction(
        bookingId,
        adminId,
        "MARK_COMPLETE",
        reason,
        ipAddress,
        beforeStatus,
        result.booking.status,
      );
      return { booking: result.booking };
    } catch (err) {
      const code = err instanceof Error ? err.message : "COMPLETE_FAILED";
      if (code === "INVALID_STATUS" && booking.status === BookingStatus.COMPLETED) {
        await this.recordAdminAction(
          bookingId,
          adminId,
          "MARK_COMPLETE",
          reason,
          ipAddress,
          beforeStatus,
          booking.status,
        );
        return { booking };
      }
      throw err;
    }
  }

  async repairBooking(bookingId: string, adminId: string, reason: string, ipAddress?: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    let repaired = false;

    if (booking.status === BookingStatus.ACCEPTED && !booking.providerId) {
      const attempt = await prisma.assignmentAttempt.findFirst({
        where: { job: { bookingId } },
        orderBy: { dispatchedAt: "desc" },
      });
      if (attempt) {
        /**
         * §5: conditional on the anomaly still being there, and attributed. This was
         * `update where { id }` with no audit context — a partner accepting (or a cancellation)
         * between the read above and this write was overwritten, and the history recorded a partner
         * change made by nobody.
         */
        const res = await prisma.$transaction(async (tx) => {
          await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `repair: ${reason}` });
          return tx.booking.updateMany({
            where: { id: bookingId, status: BookingStatus.ACCEPTED, providerId: null },
            data: { providerId: attempt.providerId },
          });
        });
        repaired = res.count === 1;
      }
    }

    if (!repaired && !booking.providerId) {
      const dispatched = await assignmentEngine.dispatchBookingNow(bookingId);
      if (dispatched) repaired = true;
    }

    await this.recordAdminAction(
      bookingId,
      adminId,
      "REPAIR",
      reason,
      ipAddress,
      booking.status,
      repaired ? "REPAIRED" : "NO_CHANGE",
    );

    return { repaired };
  }

  async refundBooking(
    bookingId: string,
    adminId: string,
    amount: number,
    reason: string,
    ipAddress?: string,
  ) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    /**
     * Previously routed through `processCancellationRefund`, which (a) never validated `amount`
     * against what was paid — any number the admin typed was refunded — and (b) used the
     * per-booking cancellation idempotency key, so a second partial refund silently returned the
     * first one as "processed". Admin refunds now have their own validated, per-request path.
     */
    const result = await bookingRefundService.processAdminRefund({
      bookingId,
      userId: booking.userId,
      adminId,
      amount,
      reason: `[Admin] ${reason}`,
    });
    if ("error" in result) throw new Error(result.error);

    await this.recordAdminAction(bookingId, adminId, "REFUND", reason, ipAddress, undefined, String(result.amount));
    return result;
  }

  async retryFailedRefund(bookingId: string, adminId: string, reason: string, ipAddress?: string) {
    const idempotencyKey = refundOrchestratorService.cancellationIdempotencyKey(bookingId);
    const existing = await prisma.refundRequest.findUnique({ where: { idempotencyKey } });
    if (!existing) throw new Error("NO_REFUND_REQUEST");

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const result = await bookingRefundService.processCancellationRefund({
      bookingId,
      userId: booking.userId,
      actorUserId: adminId,
      reason: `[Admin retry] ${reason}`,
      cancelledBy: booking.cancelledBy === "provider" ? "provider" : "user",
      refundAmount: existing.amount,
    });

    await this.recordAdminAction(bookingId, adminId, "RETRY_REFUND", reason, ipAddress);
    return result;
  }
}

export const adminBookingOperationsService = new AdminBookingOperationsService();
