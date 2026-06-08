import { NotFoundError } from "../lib/app-error";
import { ErrorCode } from "../types/error";

/**
 * 404 convenience factories + null-guards (Part 7B, additive).
 *
 * These throw the existing `NotFoundError` (from app-error.ts), which the
 * global error middleware renders as the standard envelope (404 + requestId +
 * timestamp + suggestion). Opt-in: handlers MAY `throw bookingNotFoundError()`
 * instead of manually returning a NOT_FOUND body.
 */

export const userNotFoundError = () =>
  new NotFoundError("User", { code: ErrorCode.USER_NOT_FOUND });

export const bookingNotFoundError = () =>
  new NotFoundError("Booking", { code: ErrorCode.BOOKING_NOT_FOUND });

export const serviceNotFoundError = () => new NotFoundError("Service");

export const providerNotFoundError = () => new NotFoundError("Provider");

export const paymentNotFoundError = () => new NotFoundError("Payment");

export const addressNotFoundError = () => new NotFoundError("Address");

export const ratingNotFoundError = () => new NotFoundError("Rating");

export const resourceNotFoundError = (resourceName: string) =>
  new NotFoundError(resourceName);

/**
 * Throw a 404 if the resource is null/undefined; otherwise narrow & return it.
 * Lets handlers write: `const booking = checkResourceExists(found, "Booking");`
 */
export function checkResourceExists<T>(
  resource: T | null | undefined,
  resourceName: string,
): T {
  if (resource === null || resource === undefined) {
    throw resourceNotFoundError(resourceName);
  }
  return resource;
}

/** Same as above but includes the id in the message for support/debugging. */
export function checkResourceExistsById<T>(
  resource: T | null | undefined,
  resourceName: string,
  resourceId: string,
): T {
  if (resource === null || resource === undefined) {
    throw new NotFoundError(`${resourceName} with id ${resourceId}`, {
      code: ErrorCode.NOT_FOUND,
    });
  }
  return resource;
}
