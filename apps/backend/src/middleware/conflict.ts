import { BookingStatus } from "@prisma/client";
import { ConflictError } from "../lib/app-error";
import { isBookingTransitionAllowed } from "../lib/booking-state-machine";
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

/** The transition table lives in lib/booking-state-machine.ts; re-exported for existing callers. */
export { isBookingTransitionAllowed };

/**
 * Throw 409 if the booking cannot transition to `next`. Opt-in guard for
 * handlers that mutate booking status.
 */
export function checkBookingStateTransition(
  current: BookingStatus,
  next: BookingStatus,
): void {
  if (!isBookingTransitionAllowed(current, next)) {
    throw invalidStateTransitionError(current, next);
  }
}
