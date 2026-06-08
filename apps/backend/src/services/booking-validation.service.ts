import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { distanceKm } from "../lib/geo";

export interface ValidationRequest {
  userId: string;
  providerId?: string | null;
  serviceId: string;
  addressId: string;
  scheduledDate: Date;
  amount: number;
}

export interface BookingValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  message: string;
}

const MAX_AMOUNT = 100_000;
const MAX_DAYS_AHEAD = 30;
const PROVIDER_BUFFER_MIN = 30;
const USER_BUFFER_MIN = 30;
const FAR_DISTANCE_THRESHOLD_KM = 15;

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
];

const DAY_NAMES_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES_LONG = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

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

    push(errors, "USER_INVALID", await this.validateUser(request.userId));
    push(errors, "SERVICE_INVALID", await this.validateService(request.serviceId));
    push(errors, "ADDRESS_INVALID", await this.validateAddress(request.userId, request.addressId));

    if (request.providerId) {
      push(errors, "PROVIDER_INVALID", await this.validateProvider(request.providerId, request.serviceId));
      push(
        errors,
        "BOOKING_DETAILS_INVALID",
        await this.validateBookingDetails(request.providerId, request.scheduledDate),
      );
      const conflict = await this.detectConflicts(request.providerId, request.scheduledDate, request.userId);
      if (conflict) errors.push(conflict);
      push(
        warnings,
        "PROVIDER_FAR",
        await this.checkDistance(request.providerId, request.addressId),
      );
    } else {
      push(errors, "SCHEDULE_INVALID", this.validateScheduledDate(request.scheduledDate));
      const userOverlap = await this.detectUserOverlap(request.userId, request.scheduledDate);
      if (userOverlap) errors.push(userOverlap);
    }

    push(errors, "AMOUNT_INVALID", this.validateAmount(request.amount));

    return { isValid: errors.length === 0, errors, warnings };
  }

  /** Convenience formatter that joins error messages for legacy throw-based call sites. */
  formatErrors(result: BookingValidationResult): string {
    return result.errors.map((e) => e.message).join("; ");
  }

  // ── individual checks ──────────────────────────────────────────────────────

  private async validateUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "User not found";
    if (user.isBanned) return "User account is banned";
    if (!user.isActive) return "User account is inactive";
    return null;
  }

  private async validateProvider(providerId: string, serviceId: string): Promise<string | null> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { isBanned: true } } },
    });
    if (!provider) return "Provider not found";
    if (!provider.isActive) return "Provider is not active";
    if (!provider.isApproved) return "Provider is not approved";
    if (provider.isBanned) return "Provider is banned";
    if (provider.user.isBanned) return "Provider account is banned";
    if (!provider.serviceCategories.includes(serviceId)) {
      return "Provider does not offer this service";
    }
    return null;
  }

  private async validateService(serviceId: string): Promise<string | null> {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return "Service not found";
    if (!service.isActive) return "Service is not available";
    return null;
  }

  private async validateAddress(userId: string, addressId: string): Promise<string | null> {
    const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) return "Address not found";
    return null;
  }

  private validateScheduledDate(scheduledDate: Date): string | null {
    if (Number.isNaN(scheduledDate.getTime())) return "Invalid scheduled date";
    if (scheduledDate.getTime() < Date.now()) return "Booking date must be in the future";
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);
    if (scheduledDate > maxDate) {
      return `Booking can only be made up to ${MAX_DAYS_AHEAD} days in advance`;
    }
    return null;
  }

  private async validateBookingDetails(
    providerId: string,
    scheduledDate: Date,
  ): Promise<string | null> {
    const baseError = this.validateScheduledDate(scheduledDate);
    if (baseError) return baseError;

    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return null;

    if (provider.workingDays.length > 0) {
      const dow = scheduledDate.getDay();
      const matches = provider.workingDays.some((d) => {
        const norm = d.trim().toLowerCase();
        return (
          norm === String(dow) ||
          norm === DAY_NAMES_SHORT[dow] ||
          norm === DAY_NAMES_LONG[dow]
        );
      });
      if (!matches) return `Provider does not work on ${DAY_NAMES_SHORT[dow]}`;
    }

    const startHour = parseHour(provider.workingHoursStart);
    const endHour = parseHour(provider.workingHoursEnd);
    if (startHour !== null && endHour !== null) {
      const hour = scheduledDate.getHours();
      if (hour < startHour || hour > endHour) {
        return `Provider is not available at this time. Working hours: ${startHour}:00 - ${endHour}:00`;
      }
    }
    return null;
  }

  private async detectConflicts(
    providerId: string,
    scheduledDate: Date,
    userId: string,
  ): Promise<ValidationIssue | null> {
    const providerBuffer = bufferWindow(scheduledDate, PROVIDER_BUFFER_MIN);
    const providerConflict = await prisma.booking.findFirst({
      where: {
        providerId,
        status: { in: ACTIVE_STATUSES },
        scheduledDate: providerBuffer,
      },
      select: { id: true },
    });
    if (providerConflict) {
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: `Provider is not available at this time. Try ${PROVIDER_BUFFER_MIN} minutes earlier or later.`,
      };
    }

    return this.detectUserOverlap(userId, scheduledDate);
  }

  private async detectUserOverlap(
    userId: string,
    scheduledDate: Date,
  ): Promise<ValidationIssue | null> {
    const userBuffer = bufferWindow(scheduledDate, USER_BUFFER_MIN);
    const userConflict = await prisma.booking.findFirst({
      where: {
        userId,
        status: { in: ACTIVE_STATUSES },
        scheduledDate: userBuffer,
      },
      select: { id: true },
    });
    if (userConflict) {
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

function parseHour(value: string | null): number | null {
  if (!value) return null;
  const [h] = value.split(":");
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

function bufferWindow(scheduledDate: Date, minutes: number) {
  const ms = minutes * 60 * 1000;
  return {
    gte: new Date(scheduledDate.getTime() - ms),
    lte: new Date(scheduledDate.getTime() + ms),
  };
}

export const bookingValidationService = new BookingValidationService();
