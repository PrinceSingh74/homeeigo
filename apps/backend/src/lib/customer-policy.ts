/**
 * Phase D — customer age policy (pure).
 *
 * The ONE place a service's `catalogConfig.customerPolicy.age` is evaluated against a customer.
 *
 * Rules this module keeps:
 *  - No legal age is assumed anywhere. Every threshold comes from the service's own configuration
 *    (the catalogue schema refuses MINIMUM_AGE / ADULT_ONLY / GUARDIAN_REQUIRED without an explicit
 *    number); a policy that somehow arrives without its number is refused as POLICY_NOT_CONFIGURED,
 *    never filled in.
 *  - Age comes ONLY from the customer's recorded date of birth. Nothing else (name, audience,
 *    recipient `ageMin/ageMax`, account age) is ever used to infer it.
 *  - `ageMin/ageMax` on the catalogue describe the service RECIPIENT and are not this policy.
 *  - The decision's `inputs` carry whether an age was known, the whole-year age and whether a
 *    guardian attestation was given — never the date of birth itself.
 *  - A guardian attestation is a statement the customer makes, recorded as such; it is not proof.
 *
 * Date of birth is a civil date. It is stored as 00:00 UTC of that date (the same convention
 * partner onboarding uses), so its calendar components are read in UTC; "today" is the civil date
 * in the business time zone (Asia/Kolkata). Whole-year age = years elapsed, minus one if this
 * year's (month, day) has not yet been reached. A 29 February birthday is therefore reached on
 * 1 March in a non-leap year — plain calendar arithmetic, not a legal rule.
 */
import type { ServiceCatalogConfig } from "./service-catalog-config";

export const CUSTOMER_POLICY_TIMEZONE = "Asia/Kolkata";
/** Beyond this a recorded date of birth is treated as a data error, not an age. */
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

export type AgePolicyMode = "NONE" | "MINIMUM_AGE" | "ADULT_ONLY" | "GUARDIAN_REQUIRED";
export type AgePolicy = NonNullable<NonNullable<ServiceCatalogConfig["customerPolicy"]>["age"]>;
export type CustomerPolicyConfig = ServiceCatalogConfig["customerPolicy"];

export type AgePolicyOutcome = "ALLOWED" | "REFUSED" | "NOT_APPLICABLE";

export const AGE_REASON = {
  /** No age policy on the service, or mode NONE. */
  AGE_POLICY_NONE: "AGE_POLICY_NONE",
  /** The policy needs an age and the customer has not recorded a date of birth. */
  AGE_VERIFICATION_REQUIRED: "AGE_VERIFICATION_REQUIRED",
  /** The recorded date of birth is in the future or implies an age above MAX_PLAUSIBLE_AGE_YEARS. */
  AGE_INPUT_INVALID: "AGE_INPUT_INVALID",
  AGE_BELOW_MINIMUM: "AGE_BELOW_MINIMUM",
  ADULT_REQUIRED: "ADULT_REQUIRED",
  GUARDIAN_ATTESTATION_REQUIRED: "GUARDIAN_ATTESTATION_REQUIRED",
  /** The mode needs a threshold the configuration does not carry — never defaulted. */
  POLICY_NOT_CONFIGURED: "POLICY_NOT_CONFIGURED",
  AGE_ALLOWED: "AGE_ALLOWED",
} as const;
export type AgeReasonCode = (typeof AGE_REASON)[keyof typeof AGE_REASON];

/** The codes a booking can be refused with (route maps every one to a status + message). */
export const AGE_REFUSAL_CODES = [
  AGE_REASON.AGE_VERIFICATION_REQUIRED,
  AGE_REASON.AGE_INPUT_INVALID,
  AGE_REASON.AGE_BELOW_MINIMUM,
  AGE_REASON.ADULT_REQUIRED,
  AGE_REASON.GUARDIAN_ATTESTATION_REQUIRED,
  AGE_REASON.POLICY_NOT_CONFIGURED,
] as const;

export type AgePolicyDecision = {
  outcome: AgePolicyOutcome;
  reasonCode: AgeReasonCode;
  mode: AgePolicyMode | "NONE";
  inputs: { ageKnown: boolean; ageYears: number | null; guardianAttested: boolean };
  policyVersion: string;
};

/** Civil Y/M/D of an instant in a time zone. */
function civilParts(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  const [y, m, d] = s.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/**
 * Whole years between a date of birth (civil date, UTC components) and "today" in `timeZone`.
 * Returns null for an invalid instant, a date of birth after today, or an implausible age.
 */
export function wholeYearAge(dateOfBirth: Date, now: Date, timeZone: string = CUSTOMER_POLICY_TIMEZONE): number | null {
  if (!(dateOfBirth instanceof Date) || Number.isNaN(dateOfBirth.getTime()) || Number.isNaN(now.getTime())) return null;
  const b = { y: dateOfBirth.getUTCFullYear(), m: dateOfBirth.getUTCMonth() + 1, d: dateOfBirth.getUTCDate() };
  const t = civilParts(now, timeZone);
  if (b.y > t.y || (b.y === t.y && (b.m > t.m || (b.m === t.m && b.d > t.d)))) return null; // future
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  if (age < 0 || age > MAX_PLAUSIBLE_AGE_YEARS) return null;
  return age;
}

export function agePolicyVersion(cfg: CustomerPolicyConfig | null | undefined): string {
  return cfg?.version != null ? `customer-policy.v${cfg.version}` : "customer-policy.unversioned";
}

export function evaluateAgePolicy(input: {
  policy: CustomerPolicyConfig | null | undefined;
  dateOfBirth: Date | null;
  guardianAttested: boolean;
  now: Date;
  timeZone?: string;
}): AgePolicyDecision {
  const policyVersion = agePolicyVersion(input.policy);
  const age = input.policy?.age;
  const guardianAttested = input.guardianAttested === true;
  const tz = input.timeZone ?? CUSTOMER_POLICY_TIMEZONE;

  const dobPresent = input.dateOfBirth != null;
  const ageYears = dobPresent ? wholeYearAge(input.dateOfBirth!, input.now, tz) : null;
  const inputs = { ageKnown: ageYears != null, ageYears, guardianAttested };
  const decide = (outcome: AgePolicyOutcome, reasonCode: AgeReasonCode): AgePolicyDecision => ({
    outcome,
    reasonCode,
    mode: age?.mode ?? "NONE",
    inputs,
    policyVersion,
  });

  if (!age || age.mode === "NONE") return decide("NOT_APPLICABLE", AGE_REASON.AGE_POLICY_NONE);

  // Threshold for the mode — only ever the configured number.
  const threshold =
    age.mode === "MINIMUM_AGE" ? age.minimumAge : age.mode === "ADULT_ONLY" ? age.adultAge : age.guardianMinimumAge;
  if (threshold == null || !Number.isInteger(threshold) || threshold < 1) return decide("REFUSED", AGE_REASON.POLICY_NOT_CONFIGURED);

  if (!dobPresent) return decide("REFUSED", AGE_REASON.AGE_VERIFICATION_REQUIRED);
  if (ageYears == null) return decide("REFUSED", AGE_REASON.AGE_INPUT_INVALID);

  if (age.mode === "MINIMUM_AGE") {
    return ageYears >= threshold ? decide("ALLOWED", AGE_REASON.AGE_ALLOWED) : decide("REFUSED", AGE_REASON.AGE_BELOW_MINIMUM);
  }
  if (age.mode === "ADULT_ONLY") {
    return ageYears >= threshold ? decide("ALLOWED", AGE_REASON.AGE_ALLOWED) : decide("REFUSED", AGE_REASON.ADULT_REQUIRED);
  }
  // GUARDIAN_REQUIRED: at or above guardianMinimumAge books alone; below it only with an attestation.
  if (ageYears >= threshold) return decide("ALLOWED", AGE_REASON.AGE_ALLOWED);
  return guardianAttested ? decide("ALLOWED", AGE_REASON.AGE_ALLOWED) : decide("REFUSED", AGE_REASON.GUARDIAN_ATTESTATION_REQUIRED);
}

/**
 * Validate a date of birth a person submits ("YYYY-MM-DD"). Returns the 00:00 UTC instant of that
 * civil date, or an error code. A future date or an age above MAX_PLAUSIBLE_AGE_YEARS is refused.
 */
export function parseDateOfBirth(raw: string, now: Date, timeZone: string = CUSTOMER_POLICY_TIMEZONE): { ok: true; date: Date } | { ok: false; error: "DOB_INVALID" | "DOB_IN_FUTURE" | "DOB_IMPLAUSIBLE" } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return { ok: false, error: "DOB_INVALID" };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { ok: false, error: "DOB_INVALID" };
  const t = civilParts(now, timeZone);
  if (y > t.y || (y === t.y && (mo > t.m || (mo === t.m && d > t.d)))) return { ok: false, error: "DOB_IN_FUTURE" };
  if (wholeYearAge(date, now, timeZone) == null) return { ok: false, error: "DOB_IMPLAUSIBLE" };
  return { ok: true, date };
}

/** Customer-facing copy, keyed by reason. Stable codes; the copy may change. */
export const AGE_POLICY_MESSAGES: Record<AgeReasonCode, string> = {
  AGE_POLICY_NONE: "This service has no age requirement",
  AGE_VERIFICATION_REQUIRED: "This service has an age requirement — please add your date of birth to your profile to continue",
  AGE_INPUT_INVALID: "The date of birth on your profile cannot be used — please contact support to correct it",
  AGE_BELOW_MINIMUM: "You do not meet the minimum age for this service",
  ADULT_REQUIRED: "This service can only be booked by an adult",
  GUARDIAN_ATTESTATION_REQUIRED: "A parent or guardian must confirm this booking",
  POLICY_NOT_CONFIGURED: "This service cannot be booked right now — its age policy is being updated",
  AGE_ALLOWED: "You meet the age requirement for this service",
};
