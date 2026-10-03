import { analyticsWhere } from "../lib/analytics-scope";
import { AssignmentAttemptStatus, AssignmentJobStatus, BookingStatus, Prisma } from "@prisma/client";
import { CUSTOMER_CATALOG_WHERE, PARTNER_OPERATIONAL_WHERE, partnerJobBrief } from "../lib/service-domain";
import { partnerRequirementsFromSnapshot } from "../lib/service-requirements";
import { partnerFollowUpFromSnapshot } from "../lib/booking-case-policy";
import { paymentExemptBookingIds } from "./booking-payment-gate";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";

/**
 * ── OWNER DECISION #7: public discovery reports distance to the kilometre ──
 *
 * `/api/providers/nearby` and `/search` are unauthenticated by design — customers browse before
 * signing in — and both returned distance rounded to 100 m from a caller-CHOSEN point. Three
 * anonymous queries from three different points therefore trilaterate a working partner's live
 * position to within about a hundred metres. The partner never consented to that and cannot see it
 * happening.
 *
 * Two options were on the table: require a session, or coarsen the number. Requiring a session
 * removes pre-login browsing, which is a deliberate product behaviour documented on the availability
 * route, so it trades a real feature for a fix that coarsening also achieves. At 1 km the answer a
 * customer actually needs — "is somebody near me?" — survives intact, while the residual position
 * inference collapses to roughly a square kilometre, which is no more than "this partner works in
 * this area" and is inherent to offering the service at all.
 *
 * Rounded rather than floored so a partner 200 m away does not read as 0 km, and applied in one
 * place so the two public surfaces cannot drift apart.
 */
export const PUBLIC_DISTANCE_PRECISION_KM = 1;

export function publicDistanceKm(exactKm: number): number {
  if (!Number.isFinite(exactKm) || exactKm < 0) return 0;
  return Math.max(
    PUBLIC_DISTANCE_PRECISION_KM,
    Math.round(exactKm / PUBLIC_DISTANCE_PRECISION_KM) * PUBLIC_DISTANCE_PRECISION_KM,
  );
}
import { parsePagination } from "../lib/pagination";
import { bookingStatusApi, paymentStatusApi } from "../lib/format";
import { commissionRateForVolume } from "./earnings.service";
import { addressPiiService } from "./address-pii.service";
import { encryptionService } from "./encryption.service";
import { partnerOperationsService } from "./partner-operations.service";
import { serviceOfferWhere } from "./provider-capability-loader";
import { DISPATCHABLE_PROVIDER_WHERE } from "../lib/partner-four-axis";
import {
  customerAvailableNow,
  loadPresenceEvidence,
} from "./dispatch-eligibility.service";
import { CREDITED_EARNING_WHERE } from "../lib/earning-settlement";

function startOfDayUtc(d = new Date()): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** First day of the current calendar month (matches earnings.service tier logic). */
function calendarMonthStart(d = new Date()): Date {
  const c = new Date(d);
  c.setDate(1);
  c.setHours(0, 0, 0, 0);
  return c;
}

function daysAgo(days: number, from = new Date()): Date {
  const c = startOfDayUtc(from);
  c.setDate(c.getDate() - days);
  return c;
}

/** Accepted jobs the partner is working on (excludes unaccepted dispatches). */
const ACCEPTED_TAB_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
];

/**
 * Partner job-list FILTERS (query `?status=`), not statuses. Each key is a named set:
 *   pending     offered / unclaimed
 *   accepted    claimed but work NOT started (ACCEPTED, ASSIGNED, EN_ROUTE) — "upcoming"
 *   in_progress work started
 *   active      ALL claimed work incl. IN_PROGRESS — what an "Active jobs" view means
 *   completed / cancelled
 * "accepted" is not "active": the partner mobile app used it for its Active tab and IN_PROGRESS
 * jobs disappeared (and their GPS publisher stopped). Clients import the same names from their
 * shared booking-status module; do not add another alias.
 */
const STATUS_MAP: Record<string, BookingStatus[]> = {
  pending: [BookingStatus.PENDING],
  accepted: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE],
  in_progress: [BookingStatus.IN_PROGRESS],
  completed: [BookingStatus.COMPLETED],
  cancelled: [
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    BookingStatus.REJECTED,
  ],
  active: ACCEPTED_TAB_STATUSES,
};

/** Upper bound on rows hydrated for a geo search before the exact-radius filter. */
const PROVIDER_SCAN_CAP = 500;

/** Lat/lng box that contains every point within `radiusKm` (1° lat ≈ 111 km; lng shrinks with cos φ). */
function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const cos = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusKm / (111 * cos);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export class ProviderService {
  private providerName(p: { user: { firstName: string; lastName: string }; businessName: string | null }) {
    return p.businessName || `${p.user.firstName} ${p.user.lastName}`.trim();
  }

  async search(body: {
    serviceId: string;
    latitude: number;
    longitude: number;
    radius?: number;
    minRating?: number;
    minCompletionRate?: number;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = parsePagination({ page: body.page, limit: body.limit });
    const radius = Math.min(50, Math.max(1, body.radius ?? 10));
    // Radius is the most selective predicate; pushing a bounding box into SQL means the DB returns
    // the neighbourhood instead of every approved provider in the system (which was then
    // haversine-filtered and paginated in JS, hydrating the full user row per provider).
    const box = boundingBox(body.latitude, body.longitude, radius);
    // Phase 11: the SAME "offers this service" predicate and account gates matching applies, so a
    // partner listed here is one dispatch could offer. `null` = unknown service: nobody offers it.
    const offersWhere = await serviceOfferWhere(body.serviceId);
    if (!offersWhere) return { providers: [], total: 0, page };
    const providers = await prisma.provider.findMany({
      where: {
        ...offersWhere,
        ...DISPATCHABLE_PROVIDER_WHERE,
        rating: body.minRating ? { gte: body.minRating } : undefined,
        completionRate: body.minCompletionRate ? { gte: body.minCompletionRate } : undefined,
        currentLocation: { is: { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } } },
        // Customer-facing listing: business partners only (see matchingService.candidatePopulation).
        user: analyticsWhere() as Prisma.UserWhereInput,
      },
      include: { user: { select: { firstName: true, lastName: true, profileImage: true } }, currentLocation: true },
      // Bounded even in a dense box: the exact-radius filter and sort below act on at most this many.
      take: PROVIDER_SCAN_CAP,
    });

    // Customer-visible commercial services only: a fixture id must not echo a price to anonymous callers.
    const service = await prisma.service.findFirst({ where: { id: body.serviceId, ...CUSTOMER_CATALOG_WHERE } });
    const filtered = providers
      .map((p) => {
        const loc = p.currentLocation;
        const dist = loc
          ? distanceKm(body.latitude, body.longitude, loc.latitude, loc.longitude)
          : 99;
        return { p, dist };
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);

    const slice = filtered.slice(skip, skip + limit);
    const now = new Date();
    const presenceMap = await loadPresenceEvidence(slice.map(({ p }) => p.id));
    return {
      providers: slice.map(({ p, dist }) => {
        const evidence = presenceMap.get(p.id) ?? null;
        const customer = customerAvailableNow({
          providerId: p.id,
          lifecycleState: p.lifecycleState,
          isActive: p.isActive,
          isApproved: p.isApproved,
          isBanned: p.isBanned,
          complianceRestricted: p.complianceRestricted,
          isOnline: p.isOnline,
          pausedAt: p.pausedAt,
          lastHeartbeatAt: evidence?.lastHeartbeatAt ?? null,
          lastLocationAt: evidence?.lastLocationAt ?? null,
          lastLocationLat: evidence?.lastLocationLat ?? null,
          lastLocationLng: evidence?.lastLocationLng ?? null,
        }, now);
        return {
          id: p.id,
          name: this.providerName(p),
          rating: p.rating,
          reviewCount: p.totalReviews,
          profileImage: p.profileImage ?? p.user.profileImage,
          completionRate: p.completionRate,
          responseRate: p.responseRate,
          availableNow: customer.availableNow,
          availabilityLabel: customer.availabilityLabel,
          distance: publicDistanceKm(dist),
          eta: etaMinutes(dist),
          basePrice: service?.basePrice ?? 0,
        };
      }),
      total: filtered.length,
      page,
    };
  }

  async byId(id: string) {
    const p = await prisma.provider.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!p) return null;
    const services = await prisma.service.findMany({
      where: { id: { in: p.serviceCategories }, ...CUSTOMER_CATALOG_WHERE },
      select: { id: true, name: true },
    });
    const evidence = (await loadPresenceEvidence([p.id])).get(p.id) ?? null;
    const customer = customerAvailableNow({
      providerId: p.id,
      lifecycleState: p.lifecycleState,
      isActive: p.isActive,
      isApproved: p.isApproved,
      isBanned: p.isBanned,
      complianceRestricted: p.complianceRestricted,
      isOnline: p.isOnline,
      pausedAt: p.pausedAt,
      lastHeartbeatAt: evidence?.lastHeartbeatAt ?? null,
      lastLocationAt: evidence?.lastLocationAt ?? null,
      lastLocationLat: evidence?.lastLocationLat ?? null,
      lastLocationLng: evidence?.lastLocationLng ?? null,
    });
    return {
      id: p.id,
      name: this.providerName(p),
      bio: p.bio,
      profileImage: p.profileImage ?? p.user.profileImage,
      rating: p.rating,
      totalReviews: p.totalReviews,
      totalBookings: p.totalBookings,
      completedBookings: p.completedBookings,
      completionRate: p.completionRate,
      responseRate: p.responseRate,
      onTimeRate: p.onTimeRate,
      avgResponseTime: p.avgResponseTime,
      availableNow: customer.availableNow,
      availabilityLabel: customer.availabilityLabel,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      workingDays: p.workingDays,
      services,
      certifications: p.certifications,
      badges: p.badges,
      isVerified: p.isVerified,
      verificationDate: p.verificationDate?.toISOString().slice(0, 10),
    };
  }

  async reviews(providerId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: { providerId: string; stars?: number } = { providerId };
    if (query.rating) where.stars = Number(query.rating);

    const [rows, total, breakdown] = await Promise.all([
      prisma.rating.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { firstName: true, profileImage: true } } },
      }),
      prisma.rating.count({ where }),
      prisma.rating.groupBy({
        by: ["stars"],
        where: { providerId },
        _count: true,
      }),
    ]);

    const ratingBreakdown: Record<string, number> = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
    for (const b of breakdown) ratingBreakdown[String(b.stars)] = b._count;

    return {
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.stars,
        reviewText: r.reviewText,
        user: { firstName: r.user.firstName, profileImage: r.user.profileImage },
        photos: r.photos,
        tipAmount: r.tipAmount,
        helpfulCount: r.helpfulCount,
        providerResponse: r.providerResponse,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      ratingBreakdown,
    };
  }

  async availability(providerId: string, date: string, serviceId: string) {
    const dayStart = new Date(`${date}T00:00:00`);
    const cap = await partnerOperationsService.loadCapacityFor(providerId, dayStart);
    const snap = await partnerOperationsService.snapshot(providerId);
    const isAvailable = cap.availableSlots > 0 && !snap.isSuspended && !snap.isPaused;
    const start = snap.workingHoursStart ?? "09:00";
    const end = snap.workingHoursEnd ?? "18:00";
    const slots =
      isAvailable && snap.breakWindows.length === 0
        ? [{ startTime: start, endTime: end }]
        : isAvailable
          ? [
              { startTime: start, endTime: snap.breakWindows[0]!.start },
              { startTime: snap.breakWindows[0]!.end, endTime: end },
            ]
          : [];
    return {
      isAvailable,
      availableSlots: slots.filter((s) => s.startTime < s.endTime),
      nextAvailableDate: date,
      // Field-picked: the raw capacity snapshot carries live job counts, reserved offers and
      // per-day limits — operational data about a partner that an anonymous caller has no use for.
      capacity: { remainingSlots: Math.max(0, cap.availableSlots) },
      serviceId,
    };
  }

  async nearby(query: {
    latitude: number;
    longitude: number;
    radius?: number;
    serviceId?: string;
    limit?: number;
  }) {
    const limit = Math.min(50, Number(query.limit) || 10);
    const radius = Math.min(50, Math.max(1, query.radius ?? 10));
    const box = boundingBox(query.latitude, query.longitude, radius);
    // Phase 11: shared account gates (compliance, lifecycle, pause, ban) — a public map pin is a
    // partner dispatch could actually offer work to.
    const where: Prisma.ProviderWhereInput = {
      ...DISPATCHABLE_PROVIDER_WHERE,
      isOnline: true,
      // Map screens poll this; without the box every online provider in the system was loaded per poll.
      currentLocation: { is: { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } } },
      // Public and anonymous, so the viewer is the business population. The only partner this
      // returned for central Bangalore on 2026-09-21 was a certification fixture left online by
      // whole-project-integration-cert.ts. Inert until the provenance backfill runs.
      user: analyticsWhere() as Prisma.UserWhereInput,
    };
    if (query.serviceId) {
      const offersWhere = await serviceOfferWhere(query.serviceId);
      if (!offersWhere) return { providers: [], total: 0 };
      Object.assign(where, offersWhere);
    }

    const providers = await prisma.provider.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true, profileImage: true } }, currentLocation: true },
      take: PROVIDER_SCAN_CAP,
    });

    const list = providers
      .map((p) => {
        const loc = p.currentLocation;
        const dist = loc
          ? distanceKm(query.latitude, query.longitude, loc.latitude, loc.longitude)
          : 99;
        return { p, dist };
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit);

    const now = new Date();
    const presenceMap = await loadPresenceEvidence(list.map(({ p }) => p.id));
    return {
      providers: list.map(({ p, dist }) => {
        const evidence = presenceMap.get(p.id) ?? null;
        const customer = customerAvailableNow({
          providerId: p.id,
          lifecycleState: p.lifecycleState,
          isActive: p.isActive,
          isApproved: p.isApproved,
          isBanned: p.isBanned,
          complianceRestricted: p.complianceRestricted,
          isOnline: p.isOnline,
          pausedAt: p.pausedAt,
          lastHeartbeatAt: evidence?.lastHeartbeatAt ?? null,
          lastLocationAt: evidence?.lastLocationAt ?? null,
          lastLocationLat: evidence?.lastLocationLat ?? null,
          lastLocationLng: evidence?.lastLocationLng ?? null,
        }, now);
        return {
          id: p.id,
          name: this.providerName(p),
          distance: publicDistanceKm(dist),
          rating: p.rating,
          availableNow: customer.availableNow,
          availabilityLabel: customer.availabilityLabel,
          eta: etaMinutes(dist),
        };
      }),
      total: list.length,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Partner-self ("me") read endpoints                                  */
  /* ------------------------------------------------------------------ */

  async me(providerId: string) {
    const p = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!p) return null;
    const services = await prisma.service.findMany({
      where: { id: { in: p.serviceCategories }, ...PARTNER_OPERATIONAL_WHERE },
      select: { id: true, name: true },
    });
    return {
      id: p.id,
      name: this.providerName(p),
      firstName: p.user.firstName,
      lastName: p.user.lastName,
      email: p.user.email,
      phoneNumber: p.user.phoneNumber,
      profileImage: p.profileImage ?? p.user.profileImage,
      businessName: p.businessName,
      bio: p.bio,
      city: p.city || p.user.preferredCity,
      rating: p.rating,
      totalReviews: p.totalReviews,
      totalBookings: p.totalBookings,
      completedBookings: p.completedBookings,
      completionRate: p.completionRate,
      responseRate: p.responseRate,
      onTimeRate: p.onTimeRate,
      avgResponseTime: p.avgResponseTime,
      cancellationRate: p.cancellationRate,
      acceptanceRate: p.acceptanceRate,
      walletBalance: p.walletBalance,
      totalEarnings: p.totalEarnings,
      isOnline: p.isOnline,
      onlineSince: p.onlineSince,
      currentStatus: p.currentStatus,
      pausedAt: p.pausedAt,
      pauseReason: p.pauseReason,
      timezone: p.timezone,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      workingDays: p.workingDays,
      maxJobsPerDay: p.maxJobsPerDay,
      maxConcurrentJobs: p.maxConcurrentJobs,
      breakWindows: p.breakWindows,
      serviceRadiusKm: p.serviceRadiusKm,
      baseLatitude: p.baseLatitude,
      baseLongitude: p.baseLongitude,
      services,
      serviceCategories: p.serviceCategories,
      certifications: p.certifications,
      serviceRegions: p.serviceRegions,
      paymentMethodPreference: p.paymentMethodPreference,
      upiId: p.upiId,
      bankName: p.bankName,
      isApproved: p.isApproved,
      isVerified: p.isVerified,
      isActive: p.isActive,
      isBanned: p.isBanned,
      kycStatus: p.user.kycStatus,
      badges: p.badges,
      backgroundCheckStatus: p.backgroundCheckStatus,
    };
  }

  async updateSettings(
    providerId: string,
    patch: {
      workingHoursStart?: string;
      workingHoursEnd?: string;
      workingDays?: string[];
      breakWindows?: Array<{ start: string; end: string }>;
      maxJobsPerDay?: number | null;
      maxConcurrentJobs?: number;
      paymentMethodPreference?: string;
      upiId?: string;
      bio?: string;
    },
  ) {
    const opsPatch = {
      workingHoursStart: patch.workingHoursStart,
      workingHoursEnd: patch.workingHoursEnd,
      workingDays: patch.workingDays,
      breakWindows: patch.breakWindows,
      maxJobsPerDay: patch.maxJobsPerDay,
      maxConcurrentJobs: patch.maxConcurrentJobs,
    };
    const hasOps = Object.values(opsPatch).some((v) => v !== undefined);
    if (hasOps) {
      await partnerOperationsService.updateAvailabilityConfig(providerId, opsPatch);
    }

    const data: Prisma.ProviderUpdateInput = {};
    if (patch.paymentMethodPreference !== undefined) {
      data.paymentMethodPreference = patch.paymentMethodPreference;
    }
    if (patch.upiId !== undefined) data.upiId = patch.upiId;
    if (patch.bio !== undefined) data.bio = patch.bio;

    if (Object.keys(data).length > 0) {
      await prisma.provider.update({ where: { id: providerId }, data });
    }

    return prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        workingDays: true,
        breakWindows: true,
        maxJobsPerDay: true,
        maxConcurrentJobs: true,
        paymentMethodPreference: true,
        upiId: true,
        bio: true,
      },
    });
  }

  async setOnline(providerId: string, online: boolean) {
    const snap = await partnerOperationsService.setOnline(providerId, online);
    return {
      id: providerId,
      isOnline: snap.isOnline,
      onlineSince: snap.onlineSince,
      operationalStatus: snap.operationalStatus,
      operations: snap,
    };
  }

  async myBookings(
    providerId: string,
    query: { status?: string; page?: string | number; limit?: string | number; sortBy?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);
    let where: Prisma.BookingWhereInput = { providerId };
    /** Populated for the pending tab only — the live offer window behind each card. */
    let offerByBookingId = new Map<string, { dispatchedAt: Date; expiresAt: Date }>();

    if (query.status === "pending") {
      /**
       * Only offers the partner can still ACT on.
       *
       * `status: SENT` alone was not that. An attempt stays SENT until something closes it, and two
       * things stop closing it: `timeoutAt` is cleared when a job leaves the dispatch states, and a
       * job that exhausts its attempts used to abandon its open offers outright. The result was a
       * feed of offers that could never be accepted — measured on live data, one partner was holding
       * four, dispatched 24 to 41 days earlier against a five-minute window.
       *
       * The partner cannot tell those apart from a real offer, so they tap Accept and get an error.
       * That is the defect behind "accept doesn't work": the Accept button was real, the card was
       * not.
       *
       * Liveness is now three conditions, all of which must hold: the job is still DISPATCHED, its
       * window has not closed, and the booking is still unclaimed. The sweeper remains the authority
       * that closes the attempt row — this is the read-side guarantee that a lagging sweep can never
       * show the partner work that is already gone.
       */
      const offers = await prisma.assignmentAttempt.findMany({
        where: {
          providerId,
          status: AssignmentAttemptStatus.SENT,
          job: {
            status: AssignmentJobStatus.DISPATCHED,
            timeoutAt: { gt: new Date() },
            booking: { status: BookingStatus.PENDING },
          },
        },
        select: { dispatchedAt: true, job: { select: { bookingId: true, timeoutAt: true } } },
      });
      /**
       * Carried to the client so the card can show the deadline it is counting down to.
       *
       * Nothing in the response used to mention that an offer expires at all, which is why the UI
       * could not warn anyone: a five-minute window rendered as a card with no clock on it.
       */
      offerByBookingId = new Map(
        offers.map((o) => [
          o.job.bookingId,
          { dispatchedAt: o.dispatchedAt, expiresAt: o.job.timeoutAt! },
        ]),
      );
      where = { id: { in: [...offerByBookingId.keys()] }, status: BookingStatus.PENDING };
    } else if (query.status && query.status !== "all") {
      where = {
        providerId,
        status: {
          in: STATUS_MAP[query.status] ?? [query.status.toUpperCase() as BookingStatus],
        },
      };
    }
    const orderBy =
      query.sortBy === "upcoming"
        ? { scheduledDate: "asc" as const }
        : { createdAt: "desc" as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          user: { select: { firstName: true, lastName: true, profileImage: true, phoneNumber: true, phoneEncrypted: true } },
          service: { select: { id: true, name: true, icon: true, basePrice: true } },
          address: {
            select: {
              label: true,
              addressLine1: true,
              addressLine1Encrypted: true,
              addressLine2: true,
              addressLine2Encrypted: true,
              fullAddress: true,
              fullAddressEncrypted: true,
              buildingName: true,
              flatNumber: true,
              landmark: true,
              landmarkEncrypted: true,
              specialInstructions: true,
              specialInstructionsEncrypted: true,
              city: true,
              state: true,
              zipCode: true,
              latitude: true,
              longitude: true,
            },
          },
          rating: { select: { stars: true } },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    // What start()/accept() will actually allow without money: the partner apps' action mirrors read it.
    const exempt = await paymentExemptBookingIds(rows);

    return {
      bookings: await Promise.all(
        rows.map(async (b) => {
          // The provider is assigned to this booking, so they are authorized to see the
          // customer's full address + contact to deliver the service. Address PII is stored
          // encrypted (plaintext columns are blank) — decrypt it here.
          const addressRaw = b.address ? await addressPiiService.viewForFulfilment(b.address) : null;
          const rawPhone =
            b.user.phoneNumber ||
            (b.user.phoneEncrypted ? await encryptionService.decrypt(b.user.phoneEncrypted, "PHONE") : null);
          const { toPartnerSafeAddress, toPartnerSafeCustomer } = await import("../lib/privacy-policy.engine");
          const privacyCtx = {
            audience: "partner" as const,
            purpose: (["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as string[]).includes(String(b.status))
              ? ("booking_fulfilment" as const)
              : ("booking_history" as const),
            bookingId: b.id,
            bookingStatus: String(b.status),
            authorizedPartnerId: providerId,
          };
          return {
            id: b.id,
            bookingNumber: b.bookingNumber,
            status: bookingStatusApi(b.status),
            scheduledDate: b.scheduledDate,
            completedAt: b.completedAt,
            enRouteAt: b.enRouteAt,
            arrivedAt: b.arrivedAt,
            startedAt: b.startedAt,
            amount: b.baseAmount,
            finalAmount: b.finalAmount,
            addons: b.addons ?? undefined,
            paymentStatus: paymentStatusApi(b.paymentStatus),
            /** Audited override or a fee-waived rework / revisit — the same exemption the job gates apply. */
            paymentExempt: exempt.has(b.id),
            description: b.description,
            eta: b.eta,
            customer: toPartnerSafeCustomer(
              {
                firstName: b.user.firstName,
                lastName: b.user.lastName,
                profileImage: b.user.profileImage,
                phone: rawPhone,
              },
              b.providerId === providerId ? "owner" : "offer",
            ),
            // Explicit whitelist — never pass the selected row through, so widening the select
            // cannot leak catalogue internals (codes, config, notes) to partners.
            service: { id: b.service.id, name: b.service.name, icon: b.service.icon, basePrice: b.service.basePrice },
            /** What was booked (variant, quantity, add-ons, duration) from the immutable snapshot. */
            job: partnerJobBrief(b.serviceSelection, b.addons, b.estimatedDuration),
            // Phase 06: the job detail page reads bookings from this list — the preparation brief must ride here too,
            // from the booking's own snapshot (never the service's current configuration).
            requirements: partnerRequirementsFromSnapshot(b.serviceConfigSnapshot),
            /** §11: a case-created rework / revisit visit says so (null for an ordinary booking). */
            followUp: partnerFollowUpFromSnapshot(b.serviceConfigSnapshot),
            address: toPartnerSafeAddress(addressRaw, privacyCtx),
            ratingGiven: !!b.rating,
            rating: b.rating?.stars ?? null,
            /**
             * Present only while this is a live offer. `null` is not "no deadline" — it means this
             * row is not an offer at all (an accepted or finished job), so the card must not render
             * a countdown for it.
             */
            offer: offerByBookingId.get(b.id)
              ? {
                  dispatchedAt: offerByBookingId.get(b.id)!.dispatchedAt,
                  expiresAt: offerByBookingId.get(b.id)!.expiresAt,
                }
              : null,
          };
        }),
      ),
      total,
      page,
      limit,
    };
  }

  async myDashboard(providerId: string) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return null;

    const todayStart = startOfDayUtc();
    const weekStart = daysAgo(6);
    const monthStart = daysAgo(29);
    const yesterdayStart = daysAgo(1);

    const [
      todayEarningAgg,
      yesterdayEarningAgg,
      weekEarningAgg,
      monthEarningAgg,
      completedToday,
      completedYesterday,
      pendingRequests,
      activeBookings,
      weekdayEarnings,
      monthlyCompletedForTier,
    ] = await Promise.all([
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: todayStart }, ...CREDITED_EARNING_WHERE },
        _sum: { netEarning: true, commission: true },
      }),
      prisma.earning.aggregate({
        where: {
          providerId,
          createdAt: { gte: yesterdayStart, lt: todayStart },
          ...CREDITED_EARNING_WHERE,
        },
        _sum: { netEarning: true },
      }),
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: weekStart }, ...CREDITED_EARNING_WHERE },
        _sum: { netEarning: true, commission: true, grossAmount: true },
      }),
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: monthStart }, ...CREDITED_EARNING_WHERE },
        _sum: { netEarning: true },
      }),
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: todayStart },
        },
      }),
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      prisma.assignmentAttempt.count({
        where: {
          providerId,
          status: AssignmentAttemptStatus.SENT,
          job: { booking: { status: BookingStatus.PENDING } },
        },
      }),
      prisma.booking.count({
        where: { providerId, status: { in: ACCEPTED_TAB_STATUSES } },
      }),
      prisma.earning.findMany({
        where: { providerId, createdAt: { gte: weekStart }, ...CREDITED_EARNING_WHERE },
        select: { createdAt: true, netEarning: true },
        orderBy: { createdAt: "asc" },
      }),
      // Calendar-month completed bookings — drives the commission tier
      // (same definition earnings.service uses when charging commission).
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: calendarMonthStart() },
        },
      }),
    ]);

    // Bucket weekday earnings into the last 7 days
    const sparkline: { date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgo(i);
      const next = daysAgo(i - 1);
      const amount = weekdayEarnings
        .filter((e) => e.createdAt >= d && e.createdAt < next)
        .reduce((sum, e) => sum + e.netEarning, 0);
      sparkline.push({ date: d.toISOString().slice(0, 10), amount: Math.round(amount) });
    }

    const todayEarnings = Math.round(todayEarningAgg._sum.netEarning ?? 0);
    const yesterdayEarnings = Math.round(yesterdayEarningAgg._sum.netEarning ?? 0);
    const todayEarningsChange =
      yesterdayEarnings > 0
        ? Math.round(((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100)
        : todayEarnings > 0
          ? 100
          : 0;

    return {
      earnings: {
        today: todayEarnings,
        todayChange: todayEarningsChange,
        yesterday: yesterdayEarnings,
        thisWeek: Math.round(weekEarningAgg._sum.netEarning ?? 0),
        thisMonth: Math.round(monthEarningAgg._sum.netEarning ?? 0),
        lifetime: Math.round(provider.totalEarnings),
        sparkline,
        weeklyCommission: Math.round(weekEarningAgg._sum.commission ?? 0),
        weeklyGross: Math.round(weekEarningAgg._sum.grossAmount ?? 0),
        // Net take-home % of gross this week — computed server-side so the UI
        // never derives commission percentages itself.
        weeklyTakeHomePct:
          (weekEarningAgg._sum.grossAmount ?? 0) > 0
            ? Math.round(
                ((weekEarningAgg._sum.netEarning ?? 0) /
                  (weekEarningAgg._sum.grossAmount ?? 1)) *
                  100,
              )
            : 0,
        // The provider's CURRENT commission tier (20/18/15/12), as a percentage.
        commissionRate: Math.round(commissionRateForVolume(monthlyCompletedForTier) * 100),
      },
      counts: {
        completedToday,
        completedTodayDelta: completedToday - completedYesterday,
        pendingRequests,
        activeBookings,
        completedLifetime: provider.completedBookings,
        totalBookings: provider.totalBookings,
        totalReviews: provider.totalReviews,
      },
      rates: {
        acceptanceRate: provider.acceptanceRate,
        completionRate: provider.completionRate,
        responseRate: provider.responseRate,
        onTimeRate: provider.onTimeRate,
        cancellationRate: provider.cancellationRate,
      },
      rating: provider.rating,
      walletBalance: provider.walletBalance,
      isOnline: provider.isOnline,
      onlineSince: provider.onlineSince,
    };
  }

  async myEarningsSummary(providerId: string, days = 30) {
    const start = daysAgo(days - 1);
    const earnings = await prisma.earning.findMany({
      where: { providerId, createdAt: { gte: start }, ...CREDITED_EARNING_WHERE },
      select: {
        grossAmount: true,
        commission: true,
        netEarning: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const totalGross = earnings.reduce((s, e) => s + e.grossAmount, 0);
    const totalCommission = earnings.reduce((s, e) => s + e.commission, 0);
    const totalNet = earnings.reduce((s, e) => s + e.netEarning, 0);

    // Daily series
    const byDay = new Map<string, number>();
    for (const e of earnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + e.netEarning);
    }
    const series: { date: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, amount: Math.round(byDay.get(key) ?? 0) });
    }

    return {
      period: `Last ${days} days`,
      totalJobs: earnings.length,
      totalGross: Math.round(totalGross),
      totalCommission: Math.round(totalCommission),
      totalNet: Math.round(totalNet),
      /** GROSS per job — the customer-facing job value. Unchanged; existing consumers rely on it. */
      averagePerJob:
        earnings.length > 0 ? Math.round(totalGross / earnings.length) : 0,
      /**
       * NET per job — what the partner actually receives after commission.
       *
       * Added because the two are ~19% apart on live data (gross 562 vs net 458) and every
       * REALISED figure in this service is net (`_sum.netEarning`). Any calculation that divides a
       * net amount by a per-job value must use this one; using the gross average understates the
       * jobs required to reach a target.
       */
      averageNetPerJob:
        earnings.length > 0 ? Math.round(totalNet / earnings.length) : 0,
      series,
    };
  }
}


export const providerService = new ProviderService();
