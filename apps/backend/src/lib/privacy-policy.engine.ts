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
 * only. `owner`: the partner holds the job and is fulfilling it. `history`: the partner held the
 * job and it is over — they need to recognise it in their own records, not to keep the customer's
 * surname, photo and phone indefinitely.
 */
export type PartnerCustomerStage = "offer" | "owner" | "history";

/** The stage a partner is at with a booking. Holding the job is decided by the caller (current `providerId`). */
export function partnerCustomerStage(input: { isAssignee: boolean; status: string }): PartnerCustomerStage {
  if (!input.isAssignee) return "offer";
  return ACTIVE_FULFILMENT_STATUSES.has(String(input.status).toUpperCase()) ? "owner" : "history";
}

/**
 * The customer's free-text note for the visit. It can hold anything the customer typed (a gate
 * code, who is at home), so it reaches only the partner who holds the job, while they hold it.
 */
export function partnerJobNote(description: string | null | undefined, stage: PartnerCustomerStage): string | null {
  if (stage !== "owner") return null;
  return description?.trim() || null;
}

/**
 * Why a booking was cancelled, as a partner may read it. The status already says who cancelled.
 * The words are the customer's private reason or an admin's operational note (which can name a
 * fraud review or a ticket), so a partner reads them only when the partner wrote them.
 */
export function partnerCancellationReason(reason: string | null | undefined, cancelledBy: string | null | undefined): string | null {
  return cancelledBy === "provider" ? reason?.trim() || null : null;
}

/**
 * A safety hold as a partner may read it: the condition, its state and who raised it are what the
 * partner acts on. The admin's reason for releasing it and the incident id behind it are safety
 * operations' records (owner decision 2026-10-06, closing the 2026-09-28 exposure audit item).
 */
export function partnerHoldView<T extends { incidentId: unknown; releaseReason: unknown }>(
  hold: T,
): Omit<T, "incidentId" | "releaseReason"> & { incidentId: null; releaseReason: null } {
  return { ...hold, incidentId: null, releaseReason: null };
}

/**
 * Every field a partner booking payload (job list row or job detail) may carry. Nested objects
 * built by their own projections (job, requirements, execution, tracking, offer, followUp, addons)
 * are listed by name; `customer`, `address` and `service` are listed field by field because they
 * are read from user and catalogue rows, where a widened select would otherwise pass through.
 */
export const PARTNER_BOOKING_FIELDS = {
  top: [
    "id", "bookingNumber", "status", "scheduledDate", "completedAt", "enRouteAt", "arrivedAt", "startedAt", "eta",
    "amount", "finalAmount", "addons", "paymentStatus", "paymentExempt", "description", "cancelledAt", "cancellationReason",
    "tracking", "customer", "address", "service", "job", "requirements", "followUp", "execution", "ratingGiven", "rating", "offer",
  ],
  customer: ["firstName", "lastName", "profileImage", "phoneMasked"],
  address: [
    "label", "fullAddress", "addressLine1", "addressLine2", "buildingName", "flatNumber", "landmark", "specialInstructions",
    "city", "state", "zipCode", "latitude", "longitude",
  ],
  service: ["id", "name", "icon", "basePrice"],
} as const;

/** Paths of fields outside the allow-list. Empty means the payload is within the partner boundary. */
export function unknownPartnerBookingKeys(payload: Record<string, unknown>): string[] {
  const unknown: string[] = [];
  const top = PARTNER_BOOKING_FIELDS.top as readonly string[];
  for (const key of Object.keys(payload)) if (!top.includes(key)) unknown.push(key);
  for (const nested of ["customer", "address", "service"] as const) {
    const value = payload[nested];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const allowed = PARTNER_BOOKING_FIELDS[nested] as readonly string[];
    for (const key of Object.keys(value)) if (!allowed.includes(key)) unknown.push(`${nested}.${key}`);
  }
  return unknown;
}

export function toPartnerSafeCustomer(
  input: {
    firstName?: string | null;
    lastName?: string | null;
    profileImage?: string | null;
    phone?: string | null;
  },
  stage: PartnerCustomerStage = "owner",
): PartnerSafeCustomer {
  if (stage !== "owner") return { firstName: input.firstName ?? null, lastName: null, profileImage: null, phoneMasked: null };
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

/** Drop every partner-forbidden key, including nested objects, before a partner response is returned. */
export function stripForbiddenPartnerKeys<T>(value: T): T {
  const forbidden = new Set(partnerNeverSees());
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (node instanceof Date) return node;
    if (Array.isArray(node)) return node.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  };
  return walk(value) as T;
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
