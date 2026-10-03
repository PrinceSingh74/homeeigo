import prisma from "../lib/prisma";
import { incCounter } from "../lib/metrics";
import { assertBookable } from "../lib/service-domain";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { coverageAllowsAddress } from "../lib/service-catalog-config";
import { resolveServiceDuration } from "../lib/service-catalog-config";
import { isAppointmentWithinWorkingWindow } from "../lib/partner-ops-clock";
import {
  BUSINESS_TIMEZONE,
  evaluateServiceTimeRules,
  type ServiceTimeConfig,
  type ServiceTimeReason,
} from "../lib/service-availability";
import { buildSlotGrid, OPERATING_WINDOW, SLOT_GRID_MINUTES, type OperatingWindow } from "../lib/slot-grid";
import { BOOKING_BUFFER_MINUTES, slotDurationFor } from "./booking-validation.service";
import { matchingService } from "./matching.service";
import { evaluateDispatchEligibility } from "./dispatch-eligibility.service";
import { offerRequiresLivePresence } from "../lib/scheduled-offer-presence";

/**
 * Wave 4 — the availability projection.
 *
 * The customer's booking step offered six hardcoded times (`BOOKING_TIMES` in the web app) that no
 * server had ever agreed to. This answers the question properly: for a service and a day, which
 * 30-minute starts can the platform actually accept?
 *
 * Every rule it applies is one the BOOKING PATH already owns:
 *   * the service's time rules — `evaluateServiceTimeRules`, the Phase 07/08 authority;
 *   * the partner's working window over the WHOLE appointment — `isAppointmentWithinWorkingWindow`;
 *   * occupancy — the D1 reserved window `[start − 30m, end + duration + 30m)`, the same predicate the
 *     GiST exclusion constraints enforce;
 *   * who may perform the service — `matchingService.qualifiedProvidersForService`, the population
 *     dispatch itself matches against.
 *
 * Nothing here decides anything on its own. If this file and booking create ever disagree, that is a
 * bug in this file: create is the authority, and this is a projection of it.
 */

export type SlotUnavailableReason =
  | ServiceTimeReason
  | "OUTSIDE_OPERATING_WINDOW"
  | "NO_QUALIFIED_PROVIDER"
  | "PROVIDER_BUSY"
  | "OUTSIDE_WORKING_HOURS"
  /** The customer already holds an active booking whose window overlaps this one (create: OVERLAPPING_BOOKING). */
  | "CUSTOMER_HAS_BOOKING"
  /**
   * Only for a customer-CHOSEN partner: they are toggled offline, or the slot is inside the 24 h
   * live-presence horizon and their app has no fresh heartbeat/location (create: DIRECT_ASSIGN_BLOCKED).
   */
  | "PARTNER_OFFLINE";

export type AvailabilitySlot = {
  /** Canonical instant. Clients render it in the business timezone. */
  start: string;
  available: boolean;
  reason?: SlotUnavailableReason;
};

export type AvailabilityResult =
  | {
      ok: true;
      date: string;
      timeZone: string;
      slotMinutes: number;
      /** Minutes the appointment occupies, from the ONE duration resolver. */
      durationMinutes: number;
      operatingWindow: OperatingWindow;
      slots: AvailabilitySlot[];
      /** How many slots a customer could actually take — the number the UI leads with. */
      availableCount: number;
    }
  | { ok: false; error: "SERVICE_NOT_FOUND" | "SERVICE_NOT_AVAILABLE" | "ADDRESS_NOT_FOUND" | "INVALID_DATE" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type ProviderWindow = {
  id: string;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  timezone: string | null;
};

class ServiceAvailabilityService {
  async getDaySlots(input: {
    serviceId: string;
    /** YYYY-MM-DD in the business timezone. */
    date: string;
    userId?: string;
    addressId?: string;
    /** Restrict to one partner (the customer chose them). */
    providerId?: string;
    /**
     * Rescheduling: the customer's own booking that is being moved does not block its new time
     * (create excludes it the same way — booking-validation `excludeId`). Only ever one of the
     * caller's own bookings: customerWindows is scoped to `userId`.
     */
    excludeBookingId?: string;
    now?: Date;
  }): Promise<AvailabilityResult> {
    if (!YMD.test(input.date)) return { ok: false, error: "INVALID_DATE" };
    const now = input.now ?? new Date();

    const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
    if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };
    const cfg = await loadHydratedCatalog(service);
    if (!assertBookable(service, cfg).ok) {
      incCounter("availability_requests_total", { outcome: "not_bookable" });
      return { ok: false, error: "SERVICE_NOT_AVAILABLE" };
    }

    // Serviceability: the same coverage rule booking create applies, when an address is given.
    let jobPoint: { lat: number; lng: number } | null = null;
    if (input.addressId) {
      const address = await prisma.address.findFirst({
        where: { id: input.addressId, ...(input.userId ? { userId: input.userId } : {}) },
        select: { city: true, zipCode: true, latitude: true, longitude: true },
      });
      if (!address) return { ok: false, error: "ADDRESS_NOT_FOUND" };
      if (!coverageAllowsAddress(service, cfg, { city: address.city, zipCode: address.zipCode }).ok) {
        incCounter("availability_requests_total", { outcome: "not_covered" });
        return { ok: false, error: "SERVICE_NOT_AVAILABLE" };
      }
      if (address.latitude != null && address.longitude != null && Number.isFinite(address.latitude) && Number.isFinite(address.longitude)) {
        jobPoint = { lat: address.latitude, lng: address.longitude };
      }
    }

    // One duration calculator, one occupancy rule (owner decision D1).
    const durationMinutes = resolveServiceDuration(service, cfg, {}).totalMinutes;
    const occupancyMinutes = slotDurationFor(service.partnerSlotPolicy, durationMinutes);

    const allDay = cfg?.availability?.allDay === true;
    const window: OperatingWindow = cfg?.availability?.operatingWindow ?? OPERATING_WINDOW;
    const grid = buildSlotGrid({
      date: input.date,
      timeZone: BUSINESS_TIMEZONE,
      window,
      stepMinutes: SLOT_GRID_MINUTES,
      allDay,
      durationMinutes: occupancyMinutes,
    });

    const providers = await this.providerWindows(input.serviceId, input.providerId, input.userId, jobPoint);
    const busy = providers.length > 0 ? await this.reservedWindows(providers.map((p) => p.id), grid, occupancyMinutes) : new Map();
    // Create refuses a booking that overlaps one the customer already holds (OVERLAPPING_BOOKING,
    // bookings_user_slot_excl). This projection used to offer those times anyway, so the customer
    // picked a "free" slot and was refused at Confirm (seen: signoff E2E, 409).
    const mine = input.userId
      ? await this.customerWindows(input.userId, grid, occupancyMinutes, input.excludeBookingId)
      : [];
    // A chosen partner is held to what create will check for THEM (assertOfferEligible): the online
    // toggle always, live presence inside the horizon. A broadcast booking has no chosen partner and
    // is dispatched when a partner is live — nothing to project here.
    const chosen = input.providerId && providers.length > 0 ? await this.chosenPartnerPresence(input.providerId, now) : null;

    const slots: AvailabilitySlot[] = grid.map((start): AvailabilitySlot => {
      const verdict = evaluateServiceTimeRules({
        scheduledDate: start,
        now,
        availability: (cfg?.availability ?? null) as ServiceTimeConfig | null,
        sameDayAvailable: cfg?.sameDayAvailable ?? null,
      });
      if (!verdict.ok) return { start: start.toISOString(), available: false, reason: verdict.reason };

      const win = this.reservation(start, occupancyMinutes);
      if (mine.some((b) => b.start < win.end && b.end > win.start)) {
        return { start: start.toISOString(), available: false, reason: "CUSTOMER_HAS_BOOKING" };
      }

      if (providers.length === 0) {
        return { start: start.toISOString(), available: false, reason: "NO_QUALIFIED_PROVIDER" };
      }

      if (chosen && (!chosen.online || (offerRequiresLivePresence(start, now) && !chosen.live))) {
        return { start: start.toISOString(), available: false, reason: "PARTNER_OFFLINE" };
      }

      let sawWorkingProvider = false;
      for (const p of providers) {
        if (!isAppointmentWithinWorkingWindow(
          { workingDays: p.workingDays, workingHoursStart: p.workingHoursStart, workingHoursEnd: p.workingHoursEnd, timezone: p.timezone },
          start,
          occupancyMinutes,
        )) continue;
        sawWorkingProvider = true;
        const taken = (busy.get(p.id) ?? []).some((b: { start: Date; end: Date }) => b.start < win.end && b.end > win.start);
        if (!taken) return { start: start.toISOString(), available: true };
      }
      // Distinguishing these two is the difference between "nobody works then" and "everyone is
      // booked then" — the UI can say something true either way.
      return {
        start: start.toISOString(),
        available: false,
        reason: sawWorkingProvider ? "PROVIDER_BUSY" : "OUTSIDE_WORKING_HOURS",
      };
    });

    const availableCount = slots.filter((s) => s.available).length;
    incCounter("availability_requests_total", { outcome: availableCount > 0 ? "has_slots" : "no_slots" });
    return {
      ok: true,
      date: input.date,
      timeZone: BUSINESS_TIMEZONE,
      slotMinutes: SLOT_GRID_MINUTES,
      durationMinutes,
      operatingWindow: allDay ? { start: "00:00", end: "24:00" } : window,
      slots,
      availableCount,
    };
  }

  /** The chosen partner's online toggle and live presence, read the way assertOfferEligible reads them. */
  private async chosenPartnerPresence(providerId: string, now: Date): Promise<{ online: boolean; live: boolean }> {
    const [p, presence] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: {
          isOnline: true,
          pausedAt: true,
          lifecycleState: true,
          isActive: true,
          isApproved: true,
          isBanned: true,
          complianceRestricted: true,
        },
      }),
      prisma.partnerPresence.findUnique({
        where: { providerId },
        select: { lastHeartbeatAt: true, lastLocationAt: true, lastLocationLat: true, lastLocationLng: true },
      }),
    ]);
    if (!p) return { online: false, live: false };
    const gate = evaluateDispatchEligibility(
      {
        providerId,
        lifecycleState: p.lifecycleState,
        isActive: p.isActive,
        isApproved: p.isApproved,
        isBanned: p.isBanned,
        complianceRestricted: p.complianceRestricted,
        isOnline: p.isOnline,
        pausedAt: p.pausedAt,
        lastHeartbeatAt: presence?.lastHeartbeatAt ?? null,
        lastLocationAt: presence?.lastLocationAt ?? null,
        lastLocationLat: presence?.lastLocationLat ?? null,
        lastLocationLng: presence?.lastLocationLng ?? null,
      },
      now,
    );
    return { online: p.isOnline, live: gate.checks.presence && gate.checks.location };
  }

  /** The D1 reserved window, identical to `reservedWindow` in the booking validator. */
  private reservation(start: Date, occupancyMinutes: number): { start: Date; end: Date } {
    return {
      start: new Date(start.getTime() - BOOKING_BUFFER_MINUTES * 60_000),
      end: new Date(start.getTime() + (occupancyMinutes + BOOKING_BUFFER_MINUTES) * 60_000),
    };
  }

  private async providerWindows(
    serviceId: string,
    providerId?: string,
    customerId?: string,
    jobPoint?: { lat: number; lng: number } | null,
  ): Promise<ProviderWindow[]> {
    /**
     * Phase 11: a customer-chosen partner goes through the SAME filter as the general projection —
     * population, compliance restriction, dispatch lifecycle, pause, service offering and the
     * provenance/capability gates. The old branch checked only active/approved/banned, so it could
     * show slots for a fixture partner to a real customer, or for a compliance-restricted, suspended
     * or paused partner that booking would then refuse.
     */
    // W2-D4: the same partner population matching would use for this customer.
    // No address: the strict population, same as dispatch's candidate query. With an address,
    // a partner in another city must not keep a slot open that nobody near the customer can work.
    const candidates = jobPoint
      ? await matchingService.providersReachableForAddress(serviceId, customerId, jobPoint, providerId ? [providerId] : undefined)
      : await matchingService.qualifiedProvidersForService(serviceId, customerId, providerId ? [providerId] : undefined);
    return candidates.map((p) => ({
      id: p.id,
      workingDays: p.workingDays,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      timezone: p.timezone,
    }));
  }

  /**
   * Existing reservations that could overlap any slot in the grid, read once.
   *
   * Reads the stored `provider_slot_*` columns — the windows the trigger maintains and the exclusion
   * constraints police — rather than recomputing them from scheduled dates, so this projection and
   * the database cannot disagree about what is occupied.
   */
  private async reservedWindows(
    providerIds: string[],
    grid: Date[],
    occupancyMinutes: number,
  ): Promise<Map<string, Array<{ start: Date; end: Date }>>> {
    const out = new Map<string, Array<{ start: Date; end: Date }>>();
    if (grid.length === 0) return out;
    const from = this.reservation(grid[0]!, occupancyMinutes).start;
    const to = this.reservation(grid[grid.length - 1]!, occupancyMinutes).end;

    const rows = await prisma.$queryRaw<Array<{ provider_id: string; s: Date; e: Date }>>`
      SELECT provider_id, provider_slot_start AS s, provider_slot_end AS e
      FROM bookings
      WHERE provider_id = ANY(${providerIds})
        AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
        AND provider_slot_start IS NOT NULL
        AND provider_slot_start < ${to}
        AND provider_slot_end > ${from}
    `;
    for (const r of rows) {
      const list = out.get(r.provider_id) ?? [];
      list.push({ start: r.s, end: r.e });
      out.set(r.provider_id, list);
    }
    return out;
  }

  /**
   * The customer's own active reservations that could overlap any slot in the grid — the stored
   * `user_slot_*` columns with the same status set as the create-time check
   * (booking-validation.service: OVERLAPPING_BOOKING) and the exclusion `bookings_user_slot_excl`.
   */
  private async customerWindows(
    userId: string,
    grid: Date[],
    occupancyMinutes: number,
    excludeBookingId?: string,
  ): Promise<Array<{ start: Date; end: Date }>> {
    if (grid.length === 0) return [];
    const from = this.reservation(grid[0]!, occupancyMinutes).start;
    const to = this.reservation(grid[grid.length - 1]!, occupancyMinutes).end;
    const exclude = excludeBookingId ?? null;
    const rows = await prisma.$queryRaw<Array<{ s: Date; e: Date }>>`
      SELECT user_slot_start AS s, user_slot_end AS e
      FROM bookings
      WHERE user_id = ${userId}
        AND (${exclude}::text IS NULL OR id <> ${exclude})
        AND status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
        AND user_slot_start IS NOT NULL
        AND user_slot_start < ${to}
        AND user_slot_end > ${from}
    `;
    return rows.map((r) => ({ start: r.s, end: r.e }));
  }
}

export const serviceAvailabilityService = new ServiceAvailabilityService();
