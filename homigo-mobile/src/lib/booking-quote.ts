/**
 * Booking price quote — the ONLY source of a checkout total on mobile.
 *
 * The backend prices every booking itself (POST /api/bookings/price-quote →
 * bookingPricingService.quote, and the exact same function inside POST /api/bookings).
 * The app sends selections (service id, package tier OR quantity, add-on ids, coupon, and
 * the service address' coordinates for weather surge) and displays what the server returns.
 * Nothing in this file computes money — it only builds the selection, keys it, and turns the
 * server breakdown / error codes into display rows and messages.
 */
import { AuthApiError } from "@/lib/auth/errors";

/** Mirror of the backend BookingPriceBreakdown (apps/backend/src/services/booking-pricing.service.ts). */
export type BookingQuote = {
  serviceBasePrice: number;
  packagePrice: number;
  selection?: {
    variant: { id: string; name: string; price: number } | null;
    quantity: number;
    quantityType: string | null;
    unitLabel: string | null;
    unitPrice: number | null;
  } | null;
  addons?: { id: string; name: string; price: number }[];
  addonTotal: number;
  baseAmount: number;
  weatherSurgeMultiplier?: number;
  weatherSurgeAmount?: number;
  weatherCondition?: string;
  membershipDiscount: number;
  campaignDiscount: number;
  freeDeliveryDiscount: number;
  discount: number;
  discountedBase: number;
  taxes: number;
  finalAmount: number;
  couponCode?: string;
  couponError?: string;
  /** Phase 05 (additive): the tax the server applied, and a signed quote to send with the booking. */
  tax?: { mode: string; rateBps: number; label: string };
  finalAmountPaise?: number;
  quoteToken?: string;
  expiresAt?: string;
  /** Phase 06: customer-safe requirements of THIS selection, phrased by the server. */
  requirements?: CustomerRequirementsView;
};

/** Phase 06 mirror of backend CustomerRequirement / CustomerRequirementsView (lib/service-requirements.ts). */
export type CustomerRequirement = {
  /** Only used to confirm blocking requirements on booking; never rendered. */
  code: string;
  label: string;
  quantity: string | null;
  note: string | null;
  warning: string | null;
  chargeText: string | null;
  procurementText: string | null;
  timingText: string | null;
  mustConfirm: boolean;
};
export type CustomerRequirementsView = {
  weBring: CustomerRequirement[];
  youProvide: CustomerRequirement[];
  shared: CustomerRequirement[];
  beforeArrival: CustomerRequirement[];
  beforeBooking: CustomerRequirement[];
  optional: CustomerRequirement[];
  empty: boolean;
};

/** Minimal quantity rule the mobile catalogue carries (from service.catalogConfig.quantity). */
export type QuantityRuleLite = {
  min: number;
  max?: number;
  step?: number;
  default?: number;
};

/**
 * The selection that is quoted AND booked. `lat`/`lng` are only sent to the quote: the booking
 * endpoint derives them from `addressId`, and they must be the same address' coordinates so the
 * weather surge in the quote equals the one in the charge.
 */
export type BookingSelection = {
  serviceId: string;
  packagePrice?: number;
  quantity?: number;
  variantId?: string;
  audience?: string;
  addonIds: string[];
  couponCode?: string;
  /**
   * The saved address the quote is priced for. The server binds a signed quote to it; the booking is
   * created with the same address, so quoting without it would make every tokenized booking a
   * QUOTE_MISMATCH. With it, the server also derives lat/lng itself.
   */
  addressId?: string;
  lat?: number;
  lng?: number;
};

export function buildBookingSelection(input: {
  serviceId: string;
  /** Quantity-priced services never take a package tier (the server rejects INVALID_SELECTION). */
  quantityRule?: QuantityRuleLite | null;
  quantity?: number;
  packagePrice?: number;
  variantId?: string | null;
  audience?: string | null;
  addonIds: string[];
  couponCode?: string | null;
  addressId?: string | null;
  coords?: { latitude: number; longitude: number } | null;
}): BookingSelection {
  const sel: BookingSelection = {
    serviceId: input.serviceId,
    addonIds: [...new Set(input.addonIds)].sort(),
  };
  if (input.variantId) sel.variantId = input.variantId;
  if (input.audience) sel.audience = input.audience;
  if (input.quantityRule) {
    const min = input.quantityRule.min;
    const max = input.quantityRule.max ?? Number.POSITIVE_INFINITY;
    const step = input.quantityRule.step && input.quantityRule.step > 0 ? input.quantityRule.step : 1;
    const raw = input.quantity ?? input.quantityRule.default ?? min;
    const clamped = Math.min(max, Math.max(min, raw));
    sel.quantity = min + Math.round((clamped - min) / step) * step;
  } else if (!input.variantId && input.packagePrice != null && input.packagePrice > 0) {
    sel.packagePrice = input.packagePrice;
  }
  const code = input.couponCode?.trim();
  if (code) sel.couponCode = code.toUpperCase();
  if (input.addressId) sel.addressId = input.addressId;
  if (input.coords && Number.isFinite(input.coords.latitude) && Number.isFinite(input.coords.longitude)) {
    sel.lat = input.coords.latitude;
    sel.lng = input.coords.longitude;
  }
  return sel;
}

/** Stable identity of a selection — a quote is only valid for the key it was fetched with. */
export function selectionKey(sel: BookingSelection): string {
  return JSON.stringify([
    sel.serviceId,
    sel.packagePrice ?? null,
    sel.quantity ?? null,
    sel.variantId ?? null,
    sel.audience ?? null,
    sel.addonIds,
    sel.couponCode ?? null,
    sel.addressId ?? null,
    sel.lat ?? null,
    sel.lng ?? null,
  ]);
}

/** Booking POST body fields for a selection — ids and tier only, never an amount. */
export function selectionToBookingFields(sel: BookingSelection): Record<string, unknown> {
  return {
    serviceId: sel.serviceId,
    ...(sel.packagePrice != null ? { packagePrice: sel.packagePrice } : {}),
    ...(sel.quantity != null ? { quantity: sel.quantity } : {}),
    ...(sel.variantId ? { variantId: sel.variantId } : {}),
    ...(sel.audience ? { audience: sel.audience } : {}),
    addonIds: sel.addonIds,
    ...(sel.couponCode ? { couponCode: sel.couponCode } : {}),
  };
}

const COUPON_ERROR_COPY: Record<string, string> = {
  INVALID_CODE: "This coupon code isn't valid.",
  CAMPAIGN_INACTIVE: "This offer is no longer active.",
  NOT_STARTED: "This offer hasn't started yet.",
  EXPIRED: "This coupon has expired.",
  MAX_REDEMPTIONS: "This coupon has reached its usage limit.",
  MIN_ORDER_NOT_MET: "Your order doesn't meet this coupon's minimum amount.",
  PREMIUM_REQUIRED: "This coupon is for premium members only.",
  NO_DISCOUNT: "This coupon gives no discount on this booking.",
};

export function couponErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return COUPON_ERROR_COPY[code] ?? "This coupon can't be applied to this booking.";
}

const QUOTE_ERROR_COPY: Record<string, string> = {
  REQUIREMENTS_NOT_CONFIRMED: "Please confirm the requirements marked as needed before booking.",
  REQUIREMENTS_CONFIG_INVALID: "This service can't be booked right now — its preparation requirements are being updated.",
  REQUIREMENT_CONFLICT: "This combination of options can't be booked right now.",
  UPGRADE_REQUIRED: "This is a premium-only service. Upgrade your membership to book it.",
  INVALID_PACKAGE_PRICE: "That package is no longer available — please pick a package again.",
  INVALID_VARIANT: "That option is not available for this service.",
  INVALID_QUANTITY: "That quantity is not available for this service.",
  INVALID_ADDON: "One of the selected add-ons is not available for this service.",
  INVALID_AUDIENCE: "This option is not available for the selected person.",
  INVALID_PREFERENCE: "That professional preference is not available for this service.",
  INVALID_SELECTION: "This combination of options cannot be booked.",
  VALIDATION_ERROR: "This service can't be booked right now.",
  COUPON_NOT_ALLOWED: "Coupons are not available for this service.",
  PRICING_CONFIG_MISSING: "Pricing unavailable for this configuration.",
  SERVICE_UNAVAILABLE: "This service is not available.",
  PRICE_CHANGED: "The price changed since your quote — please review the new total.",
  QUOTE_EXPIRED: "Your price expired — please review the current total.",
  QUOTE_MISMATCH: "Your selection changed — please review the total.",
};

export function isCouponErrorCode(code: string | undefined | null): boolean {
  return !!code && code in COUPON_ERROR_COPY;
}

/** Human message for a failed quote / booking request, keyed on the server's `code`. */
export function quoteErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.status === 0) return "You're offline — reconnect to see the final price.";
    if (error.code && QUOTE_ERROR_COPY[error.code]) return QUOTE_ERROR_COPY[error.code]!;
    if (error.code && COUPON_ERROR_COPY[error.code]) return COUPON_ERROR_COPY[error.code]!;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't calculate the price. Please try again.";
}

export type QuoteLine = { key: string; label: string; amount: number; kind: "charge" | "discount" };

/** Display rows, straight from the server breakdown (zero rows are omitted). */
export function quoteLines(q: BookingQuote): QuoteLine[] {
  const lines: QuoteLine[] = [];
  const qty = q.selection?.quantity ?? 1;
  const unit = q.selection?.unitLabel;
  lines.push({
    key: "service",
    label: qty > 1 && unit ? `Service (${qty} ${unit})` : "Service price",
    amount: q.packagePrice,
    kind: "charge",
  });
  for (const a of q.addons ?? []) {
    lines.push({ key: `addon:${a.id}`, label: a.name, amount: a.price, kind: "charge" });
  }
  if ((q.weatherSurgeAmount ?? 0) > 0) {
    lines.push({
      key: "surge",
      label: q.weatherCondition ? `Weather surge (${q.weatherCondition})` : "Weather surge",
      amount: q.weatherSurgeAmount!,
      kind: "charge",
    });
  }
  if (q.membershipDiscount > 0) {
    lines.push({ key: "membership", label: "Membership discount", amount: q.membershipDiscount, kind: "discount" });
  }
  if (q.freeDeliveryDiscount > 0) {
    lines.push({ key: "visit", label: "Free visit (membership)", amount: q.freeDeliveryDiscount, kind: "discount" });
  }
  if (q.campaignDiscount > 0) {
    lines.push({
      key: "coupon",
      label: q.couponCode ? `Coupon ${q.couponCode}` : "Coupon",
      amount: q.campaignDiscount,
      kind: "discount",
    });
  }
  lines.push({
    key: "tax",
    label: q.tax ? `${q.tax.label} (${q.tax.rateBps / 100}%)` : "Taxes",
    amount: q.taxes,
    kind: "charge",
  });
  return lines;
}

export function formatInr(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
