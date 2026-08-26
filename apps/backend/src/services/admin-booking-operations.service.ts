import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { incCounter } from "../lib/metrics";
import { addressPiiService } from "./address-pii.service";
import { bookingService } from "./booking.service";
import { bookingRefundService } from "./booking-refund.service";
import { assignmentEngine } from "./assignment-engine.service";
import { AuditLogService } from "./audit-log.service";
import { notificationService } from "./notification.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { bookingValidationService } from "./booking-validation.service";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { evaluatePaymentGate, PAYMENT_GATE_REASON } from "./booking-payment-gate";

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
  | "RETRY_REFUND";

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

    const [assignmentJob, assignmentAttempts, activityLogs, supportTickets, adminActions] =
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

  async cancelBooking(bookingId: string, adminId: string, reason: string, ipAddress?: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const beforeStatus = booking.status;
    const result = await bookingService.cancel({ userId: adminId }, bookingId, `[Admin] ${reason}`);

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        const updated = await prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: BookingStatus.CANCELLED_BY_USER,
            cancelledAt: new Date(),
            cancellationReason: sanitizeUserInput(reason, 500),
          },
        });
        await this.recordAdminAction(bookingId, adminId, "CANCEL", reason, ipAddress, beforeStatus, updated.status);
        return { booking: updated, adminOverride: true };
      }
      throw new Error(result.error);
    }

    await this.recordAdminAction(bookingId, adminId, "CANCEL", reason, ipAddress, beforeStatus, "CANCELLED");
    return result;
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
    const beforeDate = booking.scheduledDate.toISOString();

    await prisma.$transaction(async (tx) => {
      const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
        userId: booking.userId,
        providerId: booking.providerId,
        scheduledDate: scheduled,
        excludeBookingId: bookingId,
      });
      if (conflict) throw new Error(conflict.code);

      await tx.booking.update({
        where: { id: bookingId },
        data: { scheduledDate: scheduled },
      });
    });

    if (booking.providerId) {
      const provider = await prisma.provider.findUnique({
        where: { id: booking.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        void notificationService.createForUser({
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
  ) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

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
    if (!gate.allowed) throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);

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
    await prisma.booking.update({
      where: { id: bookingId },
      data: { providerId, status: BookingStatus.ASSIGNED, assignedAt: new Date() },
    });

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { userId: true },
    });
    if (provider?.userId) {
      void notificationService.createForUser({
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
        await prisma.booking.update({
          where: { id: bookingId },
          data: { providerId: attempt.providerId },
        });
        repaired = true;
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

    const result = await bookingRefundService.processCancellationRefund({
      bookingId,
      userId: booking.userId,
      actorUserId: adminId,
      reason: `[Admin] ${reason}`,
      cancelledBy: "user",
      refundAmount: amount,
    });

    await this.recordAdminAction(bookingId, adminId, "REFUND", reason, ipAddress, undefined, String(amount));
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
