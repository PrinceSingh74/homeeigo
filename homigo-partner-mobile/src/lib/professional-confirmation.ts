/**
 * Professional confirmation at completion — the pure half, beside `quality-checklist.ts`.
 *
 * Where the booking's FROZEN quality policy sets `professionalConfirmation`
 * (`GET /api/bookings/:id` → `booking.execution.quality.professionalConfirmation`), the server refuses
 * `POST /api/bookings/:id/complete` with 409 `QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED` unless the
 * body carries `professionalConfirmation: true`. The partner ticks one clearly worded row; this module
 * decides whether Complete may be pressed and what goes on the wire.
 *
 * The confirmation is never sent for the partner: `true` only exists because the partner tapped the
 * row. No react-native imports: this file runs under `node --test`.
 */

export const QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED = "QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED";

export const PROFESSIONAL_CONFIRMATION_LABEL = "I confirm the completion criteria were met";

export const CONFIRMATION_MISSING_HINT = "Confirm the completion criteria were met to complete this job";

type QualityPolicy = { professionalConfirmation?: boolean | null } | null | undefined;

/**
 * Whether the confirmation row must be shown and ticked. `serverDemanded` is set after the server
 * refused with `QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED` — the server is the authority, so its
 * refusal requires the row even when the booking copy on screen did not carry the flag.
 */
export function confirmationRequired(quality: QualityPolicy, serverDemanded = false): boolean {
  return quality?.professionalConfirmation === true || serverDemanded;
}

export type ConfirmationGate = {
  /** True when no confirmation is required, or it is required and ticked. */
  allowed: boolean;
  /** Short copy for the disabled Complete button; null when allowed. */
  hint: string | null;
};

export function canCompleteConfirmation(required: boolean, confirmed: boolean): ConfirmationGate {
  if (!required || confirmed) return { allowed: true, hint: null };
  return { allowed: false, hint: CONFIRMATION_MISSING_HINT };
}

/**
 * The `professionalConfirmation` value for the wire: `true` only when the row is required AND the
 * partner ticked it; otherwise `undefined` (key omitted), so a booking without the policy sends the
 * same body it always did and an unticked row is never reported as confirmed.
 */
export function professionalConfirmationFor(required: boolean, confirmed: boolean): true | undefined {
  return required && confirmed ? true : undefined;
}

export type ConfirmationRefusal = {
  /** True only for `QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED`; every other failure is left to the generic handler. */
  confirmationRefused: boolean;
  /** What to show the partner. */
  message: string;
};

/** Map a `/complete` failure onto the confirmation row. */
export function describeConfirmationRefusal(code: string | null | undefined, message: string | null | undefined): ConfirmationRefusal {
  if (code !== QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED) {
    return { confirmationRefused: false, message: message || "Complete failed" };
  }
  return {
    confirmationRefused: true,
    message: `The server refused completion — tick “${PROFESSIONAL_CONFIRMATION_LABEL}” and try again.`,
  };
}
