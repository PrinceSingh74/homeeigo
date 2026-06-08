import { BookingStatus } from "@prisma/client";
import { ConflictError } from "../lib/app-error";
import { ErrorCode } from "../types/error";

/**
 * 409 Conflict factories (Part 7C, additive, opt-in).
 *
 * Return the existing `ConflictError` (app-error.ts) → rendered by the global
 * error middleware as the standard envelope. Aligned to the real
 * `ConflictError(message, { code, details, suggestion })` signature.
 */

export const duplicateEmailError = (email: string) =>
  new ConflictError(`Email ${email} is already registered`, {
    code: ErrorCode.DUPLICATE_EMAIL,
    details: [{ field: "email", message: "This email is already in use" }],
    suggestion: "Try logging in, or register with a different email address.",
  });

export const duplicatePhoneError = (phone: string) =>
  new ConflictError(`Phone number ${phone} is already registered`, {
    code: ErrorCode.DUPLICATE_PHONE,
    details: [{ field: "phoneNumber", message: "This phone number is already in use" }],
    suggestion: "Try logging in, or register with a different phone number.",
  });

export const duplicateRecordError = (field: string) =>
  new ConflictError(`This ${field} is already in use`, {
    code: ErrorCode.CONFLICT,
    details: [{ field, message: `A record with this ${field} already exists` }],
    suggestion: `Please use a different ${field} or update the existing record.`,
  });

export const invalidStateTransitionError = (
  currentState: string,
  attemptedState: string,
) =>
  new ConflictError(`Cannot change status from ${currentState} to ${attemptedState}`, {
    code: ErrorCode.INVALID_STATUS,
    suggestion: `The booking is "${currentState}" and cannot move to "${attemptedState}". Check the valid booking workflow.`,
  });

export const resourceAlreadyExistsError = (resourceName: string, identifier?: string) =>
  new ConflictError(
    `${resourceName} already exists${identifier ? ` (${identifier})` : ""}`,
    {
      code: ErrorCode.CONFLICT,
      suggestion: `Please use a different value or update the existing ${resourceName.toLowerCase()}.`,
    },
  );

/**
 * Valid booking status transitions, keyed by the canonical Prisma
 * `BookingStatus` enum (UPPERCASE). Terminal states map to an empty array.
 */
const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: [
    BookingStatus.ACCEPTED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED_BY_USER,
  ],
  ACCEPTED: [
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
  ],
  ASSIGNED: [
    BookingStatus.EN_ROUTE,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
  ],
  EN_ROUTE: [
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
  ],
  IN_PROGRESS: [BookingStatus.COMPLETED],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED_BY_USER: [],
  CANCELLED_BY_PROVIDER: [],
};

/**
 * Throw 409 if the booking cannot transition to `next`. Opt-in guard for
 * handlers that mutate booking status.
 */
export function checkBookingStateTransition(
  current: BookingStatus,
  next: BookingStatus,
): void {
  const allowed = VALID_BOOKING_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw invalidStateTransitionError(current, next);
  }
}
