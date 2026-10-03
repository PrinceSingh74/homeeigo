import { type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { isBusinessRow } from "../lib/analytics-scope";
import { DISPATCH_LIFECYCLE_WHERE } from "../lib/partner-four-axis";
import { distanceKm } from "../lib/geo";
import { providerOffersService, resolveServiceMatchTokens } from "../lib/service-match";
import { coverageAllowsAddress } from "../lib/service-catalog-config";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { assertBookable } from "../lib/service-domain";
import { incCounter } from "../lib/metrics";
import { isAppointmentWithinWorkingWindow } from "../lib/partner-ops-clock";
import {
  evaluateServiceTimeRules,
  type ServiceTimeConfig,
  type ServiceTimeReason,
} from "../lib/service-availability";

export interface ValidationRequest {
  userId: string;
  providerId?: string | null;
  serviceId: string;
  addressId: string;
  scheduledDate: Date;
  amount: number;
  /** Minutes this booking reserves beyond the buffer (D1). Omitted / null = legacy fixed window. */
  slotDurationMinutes?: number | null;
}

/**
 * The reserved window of a booking — THE same rule as trigger bookings_sync_conflict_slots:
 *   [scheduled − 30 min, scheduled + slotDurationMinutes + 30 min)   (half-open)
 * NULL / 0 minutes is the legacy fixed 60-minute block. Kept in one function so the application
 * pre-checks can never again disagree with the exclusion constraints.
 */
export function reservedWindow(scheduledDate: Date, slotDurationMinutes?: number | null): { start: Date; end: Date } {
  const occupancy = Math.max(0, slotDurationMinutes ?? 0);
  return {
    start: new Date(scheduledDate.getTime() - BOOKING_BUFFER_MINUTES * 60_000),
    end: new Date(scheduledDate.getTime() + (occupancy + BOOKING_BUFFER_MINUTES) * 60_000),
  };
}

/**
 * Minutes a new booking reserves (owner decision D1): the resolved appointment duration, except for
 * services whose duration is a turnaround time (partnerSlotPolicy FIXED) — those keep the fixed block.
 */
export function slotDurationFor(partnerSlotPolicy: string | null | undefined, appointmentMinutes: number): number {
  return partnerSlotPolicy === "FIXED" ? 0 : Math.max(0, Math.round(appointmentMinutes));
}

export interface BookingValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  /** Machine-readable sub-cause of a broad code (e.g. SCHEDULE_NOT_ALLOWED + LEAD_TIME_NOT_MET). */
  reason?: string;
}

/**
 * Metric labels for `service_availability_failures_total`. Pinned to the values the existing
 * dashboards query, so moving the rules into `service-availability.ts` does not silently blank them.
 */
const TIME_REASON_METRIC: Record<ServiceTimeReason, string> = {
  INVALID_DATE: "invalid_date",
  SLOT_IN_PAST: "past",
  LEAD_TIME_NOT_MET: "lead_time",
  BEYOND_ADVANCE_WINDOW: "advance_window",
  SAME_DAY_UNAVAILABLE: "same_day",
  BLACKOUT_DATE: "blackout",
};

const MAX_AMOUNT = 100_000;
/** @deprecated The advance window is the service's (`availability.maximumAdvanceDays`); the default
 * when it configures none lives in `service-availability.ts` as DEFAULT_MAX_ADVANCE_DAYS. */
export const BOOKING_BUFFER_MINUTES = 30;
const FAR_DISTANCE_THRESHOLD_KM = 15;

export class BookingValidationService {
  /**
   * Run all 7 validation checks from Part 4 of the spec.
   * Errors block the booking; warnings are returned but non-blocking.
   */
  async validateBooking(request: ValidationRequest): Promise<BookingValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const push = (target: ValidationIssue[], code: string, message: string | null) => {
      if (message) target.push({ code, message });
    };
    const pushIssue = (target: ValidationIssue[], issue: ValidationIssue | null) => {
      if (issue) target.push(issue);
    };

    push(errors, "USER_INVALID", await this.validateUser(request.userId));
    pushIssue(errors, await this.validateService(request.serviceId, request.scheduledDate));
    push(errors, "ADDRESS_INVALID", await this.validateAddress(request.userId, request.addressId));
    push(errors, "COVERAGE_INVALID", await this.validateCoverage(request.serviceId, request.userId, request.addressId));

    if (request.providerId) {
      push(errors, "PROVIDER_INVALID", await this.validateProvider(request.providerId, request.serviceId, request.userId));
      pushIssue(
        errors,
        await this.validateBookingDetails(request.providerId, request.scheduledDate, request.slotDurationMinutes),
      );
      const conflict = await this.detectConflicts(request.providerId, request.scheduledDate, request.userId, request.slotDurationMinutes);
      if (conflict) errors.push(conflict);
      push(
        warnings,
        "PROVIDER_FAR",
        await this.checkDistance(request.providerId, request.addressId),
      );
    } else {
      pushIssue(errors, this.validateScheduledDate(request.scheduledDate));
      const userOverlap = await this.detectUserOverlap(request.userId, request.scheduledDate, request.slotDurationMinutes);
      if (userOverlap) errors.push(userOverlap);
    }

    push(errors, "AMOUNT_INVALID", this.validateAmount(request.amount));

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * A reschedule moves the SAME booking to a new instant, so the new instant has to satisfy the same
   * rules a new booking would — the service's lead time, advance window, same-day rule and blackout
   * dates, and the assigned partner's working window. Until now reschedule ran conflict detection
   * only: a customer could move a confirmed booking into the past, onto a blackout date, or to 03:00.
   *
   * Conflict/overlap stays where it must be — inside the transaction, under locks
   * (`assertBookingConflictFree`). This is the read-only policy half, safe to run before it.
   */
  async validateReschedule(request: {
    userId: string;
    serviceId: string;
    providerId?: string | null;
    scheduledDate: Date;
    slotDurationMinutes?: number | null;
  }): Promise<ValidationIssue | null> {
    // The service's TIME rules, but deliberately NOT its sellability gate. A reschedule moves an
    // appointment that already exists; gating it on the service still being bookable would mean that
    // retiring or suspending a service silently blocks customers from moving bookings already
    // placed, leaving cancellation as their only option. That was never a platform rule, so it is
    // not invented here. Whether the NEW instant is workable is still fully enforced.
    const service = await prisma.service.findUnique({ where: { id: request.serviceId } });
    if (service) {
      const timeIssue = this.serviceTimeIssue(service, await loadHydratedCatalog(service), request.scheduledDate);
      if (timeIssue) return timeIssue;
    }
    if (!request.providerId) return this.validateScheduledDate(request.scheduledDate);
    return this.validateBookingDetails(request.providerId, request.scheduledDate, request.slotDurationMinutes);
  }

  /** Convenience formatter that joins error messages for legacy throw-based call sites. */
  formatErrors(result: BookingValidationResult): string {
    return result.errors.map((e) => e.message).join("; ");
  }

  /**
   * Authoritative conflict engine — used by create(), update(), and reschedule paths.
   * Runs inside an open transaction with row locks before any schedule mutation.
   */
  async assertBookingConflictFree(
    tx: Prisma.TransactionClient,
    request: Pick<ValidationRequest, "userId" | "providerId" | "scheduledDate" | "slotDurationMinutes"> & {
      excludeBookingId?: string;
    },
  ): Promise<ValidationIssue | null> {
    const excludeId = request.excludeBookingId ?? null;
    const win = reservedWindow(request.scheduledDate, request.slotDurationMinutes);

    /**
     * -- Ordered entry, so concurrent bookings for one slot cannot deadlock ----------
     *
     * "One active booking per provider slot" is enforced by THREE mechanisms: the `FOR UPDATE`
     * range scans below, which also cover the buffer window either side; the partial unique index
     * `bookings_provider_scheduled_active_key` on the exact timestamp; and the GiST exclusion
     * constraint `bookings_provider_slot_excl` on the slot range. All three are needed - neither
     * index can express the buffer rule, and the scan is not atomic.
     *
     * The deadlock comes from their interaction. Concurrent INSERTs of the same unique key each
     * register a speculative index entry and then wait on each other's transaction to resolve;
     * when those transactions have also taken row locks from the range scan, two can end up each
     * holding what the other needs. A raw-SQL reproduction at 60-way concurrency produced 1 success
     * and 10 deadlocks, with the Postgres graph naming two INSERTs waiting on each other's
     * ShareLock.
     *
     * Scope of the evidence, stated honestly: that raw probe does not call this function, so it is
     * evidence for the CYCLE, not for this fix. Measured through this path at 250-way concurrency
     * the service does not deadlock either way (the GiST constraint rejects first); what this lock
     * demonstrably changes there is 7 raw constraint errors -> 0, all rejections becoming typed
     * PROVIDER_UNAVAILABLE. On the full release-blocker suite, 8/8 runs with this lock were clean
     * while 2 of 3 valid runs without it produced ~300-500 deadlocks - consistent with the lock
     * helping, not proof of it.
     *
     * The remedy is one lock taken FIRST, keyed on the contended resource, so everyone competing
     * for a provider-slot queues in a single order and no cycle can form. Different slots hash
     * differently and never meet - concurrency is ordered, not reduced. `pg_advisory_xact_lock` is
     * transaction-scoped: it releases on commit or rollback, including a rollback the caller never
     * sees. Nothing to leak.
     *
     * Deliberately NOT done instead: lowering the test's concurrency, adding a sleep, widening the
     * retry loop, or catching 40P01 and reporting success. Each hides the cycle rather than
     * removing it.
     */
    if (request.providerId) {
      // Keyed on the provider alone: with duration-aware windows (D1) two bookings with different
      // start times can overlap, so a (provider, start) key would no longer put them in one queue.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.providerId}), 0)`;
    }

    // Overlap of the stored reserved windows (maintained by the trigger) with this booking's window:
    // exactly the predicate the GiST exclusion constraints enforce, so a pre-check pass means the
    // insert will not be refused by the database for the same reason.
    if (request.providerId) {
      const providerRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM bookings
        WHERE provider_id = ${request.providerId}
          AND (${excludeId}::text IS NULL OR id <> ${excludeId})
          AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
          AND provider_slot_start < ${win.end}
          AND provider_slot_end > ${win.start}
        FOR UPDATE
      `;
      if (providerRows.length > 0) {
        return {
          code: "PROVIDER_UNAVAILABLE",
          message: "Provider is not available for this time — pick a slot after their current job ends.",
        };
      }
    }

    const userRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE user_id = ${request.userId}
        AND (${excludeId}::text IS NULL OR id <> ${excludeId})
        AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
        AND user_slot_start < ${win.end}
        AND user_slot_end > ${win.start}
      FOR UPDATE
    `;
    if (userRows.length > 0) {
      return { code: "OVERLAPPING_BOOKING", message: "You already have a booking at this time" };
    }

    return null;
  }

  /** @deprecated Use assertBookingConflictFree */
  async assertNoConflictsInTransaction(
    tx: Prisma.TransactionClient,
    request: Pick<ValidationRequest, "userId" | "providerId" | "scheduledDate" | "slotDurationMinutes">,
  ): Promise<ValidationIssue | null> {
    return this.assertBookingConflictFree(tx, request);
  }

  // ── individual checks ──────────────────────────────────────────────────────

  private async validateUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "User not found";
    if (user.isBanned) return "User account is banned";
    if (!user.isActive) return "User account is inactive";
    return null;
  }

  /**
   * A provider named directly by the caller must clear the SAME hard gates matching applies.
   *
   * W2-D4 found two ways this function was weaker than matching's candidate query:
   *
   *   * it never compared populations, so a real customer could book a fixture partner simply by
   *     sending that partner's id — the direct route to the "real customer waiting on a partner who
   *     does not exist" outcome measured on homigo_db (9 such bookings, 4 still live);
   *   * it skipped `complianceRestricted` and the dispatch lifecycle, both of which matching filters
   *     on, so a partner restricted for an expired document, or not in an ACTIVE lifecycle, could
   *     still be chosen by id.
   *
   * The population rule is `isBusinessRow` on both sides — the one provenance policy, not a copy.
   */
  private async validateProvider(providerId: string, serviceId: string, customerId?: string): Promise<string | null> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true, dataOrigin: true } } },
    });
    if (!provider) return "Provider not found";
    if (!provider.isActive) return "Provider is not active";
    if (!provider.isApproved) return "Provider is not approved";
    if (provider.isBanned) return "Provider is banned";
    if (provider.user.isBanned) return "Provider account is banned";
    if (provider.complianceRestricted) {
      incCounter("service_provider_ineligible_total", { reason: "compliance_restricted" });
      return "Provider is not available";
    }
    if (provider.lifecycleState !== DISPATCH_LIFECYCLE_WHERE.lifecycleState) {
      incCounter("service_provider_ineligible_total", { reason: "lifecycle" });
      return "Provider is not available";
    }
    if (customerId) {
      const customer = await prisma.user.findUnique({ where: { id: customerId }, select: { dataOrigin: true } });
      if (customer && isBusinessRow(customer.dataOrigin) !== isBusinessRow(provider.user.dataOrigin)) {
        // Deliberately the same message as any other unavailability: telling a caller that a partner
        // is a fixture would leak which accounts are test data.
        incCounter("service_provider_ineligible_total", { reason: "population" });
        return "Provider is not available";
      }
    }
    const matchTokens = await resolveServiceMatchTokens(serviceId);
    if (!matchTokens || !providerOffersService(provider.serviceCategories, matchTokens)) {
      incCounter("service_provider_ineligible_total", { reason: "category_map" });
      return "Provider does not offer this service";
    }
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { catalogConfig: true } });
    const requiredSkills = (await loadHydratedCatalog({ id: serviceId, catalogConfig: service?.catalogConfig }))
      ?.providerRequirements?.requiredSkills;
    if (requiredSkills?.length && !requiredSkills.every((skill) => provider.serviceCategories.includes(skill))) {
      incCounter("service_provider_ineligible_total", { reason: "required_skill" });
      return "Provider does not offer this service";
    }
    return null;
  }

  /**
   * Service-level gate: is this service bookable at all, and may it start at this instant?
   *
   * The time rules live in `service-availability.ts` — ONE implementation shared with reschedule and
   * the availability projection. They used to be inlined here with the server's local calendar
   * (`toDateString`) for same-day and UTC (`toISOString`) for blackout dates: two different notions
   * of "day", neither of them the business's, so a 00:30 IST slot escaped a blackout date.
   */
  private async validateService(serviceId: string, scheduledDate?: Date): Promise<ValidationIssue | null> {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return { code: "SERVICE_INVALID", message: "Service not found" };
    const cfg = await loadHydratedCatalog(service);
    if (!assertBookable(service, cfg).ok) {
      incCounter("service_availability_failures_total", { reason: "not_bookable" });
      return { code: "SERVICE_NOT_AVAILABLE", message: "Service is not available" };
    }
    if (!scheduledDate) return null;
    return this.serviceTimeIssue(service, cfg, scheduledDate);
  }

  /** The service's TIME rules alone — no sellability gate. Shared by create and reschedule. */
  private serviceTimeIssue(
    service: { id: string },
    cfg: Awaited<ReturnType<typeof loadHydratedCatalog>>,
    scheduledDate: Date,
  ): ValidationIssue | null {
    void service;
    const verdict = evaluateServiceTimeRules({
      scheduledDate,
      availability: (cfg?.availability ?? null) as ServiceTimeConfig | null,
      sameDayAvailable: cfg?.sameDayAvailable ?? null,
    });
    if (verdict.ok) return null;
    incCounter("service_availability_failures_total", { reason: TIME_REASON_METRIC[verdict.reason] });
    return { code: "SCHEDULE_NOT_ALLOWED", reason: verdict.reason, message: verdict.message };
  }

  private async validateAddress(userId: string, addressId: string): Promise<string | null> {
    const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) return "Address not found";
    return null;
  }

  private async validateCoverage(serviceId: string, userId: string, addressId: string): Promise<string | null> {
    const [service, address] = await Promise.all([
      prisma.service.findUnique({ where: { id: serviceId } }),
      prisma.address.findFirst({ where: { id: addressId, userId }, select: { city: true, zipCode: true } }),
    ]);
    if (!service || !address) return null;
    const cfg = await loadHydratedCatalog(service);
    const cov = coverageAllowsAddress(service, cfg, { city: address.city, zipCode: address.zipCode });
    if (!cov.ok) {
      incCounter("service_availability_failures_total", { reason: "coverage" });
      return cov.error;
    }
    return null;
  }

  /**
   * Instant sanity only (valid date, not in the past). Lead time, advance window, same-day and
   * blackout dates are the SERVICE's rules and are enforced once, in `validateService`, which is the
   * only caller that has the service's configuration. This used to re-apply a hard 30-day cap with
   * no config in hand, which silently overrode a service configured for a longer booking horizon.
   */
  private validateScheduledDate(scheduledDate: Date): ValidationIssue | null {
    const verdict = evaluateServiceTimeRules({ scheduledDate });
    if (verdict.ok || (verdict.reason !== "INVALID_DATE" && verdict.reason !== "SLOT_IN_PAST")) return null;
    return { code: "SCHEDULE_NOT_ALLOWED", reason: verdict.reason, message: verdict.message };
  }

  private async validateBookingDetails(
    providerId: string,
    scheduledDate: Date,
    slotDurationMinutes?: number | null,
  ): Promise<ValidationIssue | null> {
    const baseError = this.validateScheduledDate(scheduledDate);
    if (baseError) return baseError;

    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return null;

    if (!isAppointmentWithinWorkingWindow(
      {
        workingDays: provider.workingDays,
        workingHoursStart: provider.workingHoursStart,
        workingHoursEnd: provider.workingHoursEnd,
        timezone: provider.timezone,
      },
      scheduledDate,
      slotDurationMinutes ?? 0,
    )) {
      incCounter("service_availability_failures_total", { reason: "outside_working_hours" });
      return {
        code: "PROVIDER_UNAVAILABLE",
        reason: "OUTSIDE_WORKING_HOURS",
        message: "This partner does not work at that time. Please choose another slot.",
      };
    }
    return null;
  }

  private async detectConflicts(
    providerId: string,
    scheduledDate: Date,
    userId: string,
    slotDurationMinutes?: number | null,
  ): Promise<ValidationIssue | null> {
    const win = reservedWindow(scheduledDate, slotDurationMinutes);
    const providerConflict = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE provider_id = ${providerId}
        AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
        AND provider_slot_start < ${win.end}
        AND provider_slot_end > ${win.start}
      LIMIT 1
    `;
    if (providerConflict.length > 0) {
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "Provider is not available for this time — pick a slot after their current job ends.",
      };
    }

    return this.detectUserOverlap(userId, scheduledDate, slotDurationMinutes);
  }

  private async detectUserOverlap(
    userId: string,
    scheduledDate: Date,
    slotDurationMinutes?: number | null,
  ): Promise<ValidationIssue | null> {
    const win = reservedWindow(scheduledDate, slotDurationMinutes);
    const userConflict = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE user_id = ${userId}
        AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
        AND user_slot_start < ${win.end}
        AND user_slot_end > ${win.start}
      LIMIT 1
    `;
    if (userConflict.length > 0) {
      return { code: "OVERLAPPING_BOOKING", message: "You already have a booking at this time" };
    }
    return null;
  }

  private validateAmount(amount: number): string | null {
    if (!Number.isFinite(amount)) return "Amount is invalid";
    if (amount <= 0) return "Amount must be positive";
    if (amount > MAX_AMOUNT) return `Amount exceeds maximum limit of ${MAX_AMOUNT}`;
    return null;
  }

  private async checkDistance(providerId: string, addressId: string): Promise<string | null> {
    const [provider, address] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        include: { currentLocation: true },
      }),
      prisma.address.findUnique({ where: { id: addressId } }),
    ]);

    if (!provider?.currentLocation || !address) return null;

    const distance = distanceKm(
      provider.currentLocation.latitude,
      provider.currentLocation.longitude,
      address.latitude,
      address.longitude,
    );

    if (distance > FAR_DISTANCE_THRESHOLD_KM) {
      return `Provider is ${distance.toFixed(1)}km away. Service may take longer than usual.`;
    }
    return null;
  }
}

export const bookingValidationService = new BookingValidationService();
