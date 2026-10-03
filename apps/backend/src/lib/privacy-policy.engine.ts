/**
 * Canonical privacy policy engine. All partner/customer PII shaping must go
 * through here instead of ad-hoc masking in endpoints.
 */
import { maskPhoneForPartner } from "./pii-normalize";

export const ACTIVE_FULFILMENT_STATUSES = new Set([
  "ACCEPTED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
]);

export type PrivacyAudience = "partner" | "customer" | "admin" | "ops_safety";
export type PrivacyPurpose = "booking_fulfilment" | "booking_history" | "directory" | "safety_ops";

export type PrivacyContext = {
  audience: PrivacyAudience;
  purpose: PrivacyPurpose;
  bookingId: string;
  bookingStatus: string;
  authorizedPartnerId?: string;
  authorizedCustomerId?: string;
};

export type PartnerSafeCustomer = {
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  phoneMasked: string | null;
};

export type CustomerSafePartner = {
  id: string;
  name: string;
  rating: number;
  profileImage: string | null;
  phoneMasked: string | null;
};

export type PartnerSafeAddress = {
  label: string | null;
  fullAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  buildingName: string | null;
  flatNumber: string | null;
  landmark: string | null;
  specialInstructions: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

function isFulfilment(ctx: PrivacyContext): boolean {
  return ctx.purpose === "booking_fulfilment" && ACTIVE_FULFILMENT_STATUSES.has(ctx.bookingStatus);
}

export function assertBookingAudience(ctx: PrivacyContext, actor: { partnerId?: string; customerId?: string }): boolean {
  if (ctx.audience === "partner") {
    return Boolean(actor.partnerId && ctx.authorizedPartnerId && actor.partnerId === ctx.authorizedPartnerId);
  }
  if (ctx.audience === "customer") {
    return Boolean(actor.customerId && ctx.authorizedCustomerId && actor.customerId === ctx.authorizedCustomerId);
  }
  return ctx.audience === "admin" || ctx.audience === "ops_safety";
}

/**
 * `offer`: the partner is one of several being offered the job and may never accept it — first name
 * only. `owner`: the partner holds the job (or held it, for their own history).
 */
export type PartnerCustomerStage = "offer" | "owner";

export function toPartnerSafeCustomer(
  input: {
    firstName?: string | null;
    lastName?: string | null;
    profileImage?: string | null;
    phone?: string | null;
  },
  stage: PartnerCustomerStage = "owner",
): PartnerSafeCustomer {
  if (stage === "offer") return { firstName: input.firstName ?? null, lastName: null, profileImage: null, phoneMasked: null };
  const phone = input.phone && /^\+?\d[\d\s-]{6,}$/.test(input.phone) ? input.phone : null;
  return {
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    profileImage: input.profileImage ?? null,
    phoneMasked: phone ? maskPhoneForPartner(phone) : null,
  };
}

export function toCustomerSafePartner(input: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  rating?: number | null;
  profileImage?: string | null;
  phone?: string | null;
}): CustomerSafePartner {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || "Partner";
  const phone = input.phone && /^\+?\d[\d\s-]{6,}$/.test(input.phone) ? input.phone : null;
  return {
    id: input.id,
    name,
    rating: input.rating ?? 0,
    profileImage: input.profileImage ?? null,
    phoneMasked: phone ? maskPhoneForPartner(phone) : null,
  };
}

export function toPartnerSafeAddress(
  address: PartnerSafeAddress | null,
  ctx: PrivacyContext,
): PartnerSafeAddress | null {
  if (!address) return null;
  if (isFulfilment(ctx)) {
    return {
      label: address.label,
      fullAddress: address.fullAddress,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      buildingName: address.buildingName,
      flatNumber: address.flatNumber,
      landmark: address.landmark,
      specialInstructions: address.specialInstructions,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      latitude: address.latitude,
      longitude: address.longitude,
    };
  }
  return {
    label: address.label,
    fullAddress: [address.city, address.state, address.zipCode].filter(Boolean).join(", ") || null,
    addressLine1: null,
    addressLine2: null,
    buildingName: null,
    flatNumber: null,
    landmark: null,
    specialInstructions: null,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    latitude: null,
    longitude: null,
  };
}

export function partnerNeverSees(): readonly string[] {
  return [
    "phoneNumber",
    "email",
    "kycDocumentNumber",
    "bankAccountNumber",
    "riskScore",
    "riskLevel",
    "fraudSignals",
    "incidentNotes",
    "alternateAddress",
    "privateNotes",
    // Catalogue internals: admin configuration, operational codes and notes are never partner data.
    "catalogConfig",
    "operationsNotes",
    "ownerTeam",
    "serviceCode",
    "internalServiceCode",
    "seoTitle",
    "seoDescription",
    "seoKeywords",
    "matchingWeights",
    // X-29: the customer's money on a booking (what was refunded, how, what the cancellation cost).
    ...CUSTOMER_MONEY_KEYS,
  ];
}

/**
 * X-29: the customer's side of a booking's money. A partner needs the payment GATE (`paymentStatus`,
 * `paymentExempt`) and its own earnings — never what the customer was refunded, by which tender, or
 * what their cancellation cost. No partner client reads any of these.
 */
export const CUSTOMER_MONEY_KEYS = [
  "refundAmount",
  "refundStatus",
  "refundedAmount",
  "refundMessage",
  "refundTender",
  "cancellationFee",
  "walletAmountUsed",
  "paymentMethod",
] as const;

/** A shallow copy without the customer-money keys (partner audience). */
export function withoutCustomerMoney<T extends Record<string, unknown>>(value: T): Omit<T, (typeof CUSTOMER_MONEY_KEYS)[number]> {
  const out: Record<string, unknown> = { ...value };
  for (const k of CUSTOMER_MONEY_KEYS) delete out[k];
  return out as Omit<T, (typeof CUSTOMER_MONEY_KEYS)[number]>;
}

/** Walk a serialized partner-facing payload and return forbidden key names that leaked. */
export function collectForbiddenPartnerKeys(value: unknown, found: string[] = []): string[] {
  const forbidden = new Set(partnerNeverSees());
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenPartnerKeys(item, found);
    return found;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(k) && !found.includes(k)) found.push(k);
    collectForbiddenPartnerKeys(v, found);
  }
  return found;
}
