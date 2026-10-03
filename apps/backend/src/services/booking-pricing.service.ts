import prisma from "../lib/prisma";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { campaignService } from "./campaign.service";
import { membershipCouponService } from "./membership-coupon.service";
import { weatherService } from "./weather.service";
import {
  BOOKING_ADDONS,
  coverageAllowsAddress,
  resolveServiceSelection,
  type SelectedAddon,
  type SelectionError,
  type SelectionIssue,
  type ServiceSelectionSnapshot,
} from "../lib/service-catalog-config";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { customerRequirementsView, resolveServiceRequirements, type CustomerRequirementsView, type ResolvedRequirement } from "../lib/service-requirements";
import { resolveExecutionPlan, type ResolvedStep } from "../lib/service-execution";
import { assertBookable, assertCustomerSellable } from "../lib/service-domain";
import { paymentCapabilities } from "../lib/service-runtime-policy";
import { incCounter, observeHist } from "../lib/metrics";
import {
  PLATFORM_CURRENCY,
  PRICING_VERSION,
  SUPPORTED_CURRENCIES,
  TAX_POLICY,
  percentToRupeePaise,
  surgeAmountPaise,
  taxOn,
  toPaise,
  toRupees,
  type QuoteLine,
} from "../lib/pricing-policy";
import { selectionFingerprint, signQuote } from "../lib/quote-token";
import { consumeRateLimitSmart, peekRateLimitSmart } from "../middleware/rate-limit.middleware";

/** Re-exported for existing importers; the catalogue lives in lib/service-catalog-config. */
export { BOOKING_ADDONS };
export type BookingAddonId = (typeof BOOKING_ADDONS)[number]["id"];

/**
 * Fees the platform charges on top of the service. None is configured today: the old
 * PLATFORM_VISIT_FEE_INR (₹49) was never charged, only "waived" as a member discount against a fee
 * that did not exist. Owner decision 2026-09-21: a fee waiver applies only to a fee actually on the
 * quote. With no fee configured the waiver is ₹0 and the benefit is neither applied nor consumed.
 */
export const PLATFORM_FEES: ReadonlyArray<{ code: string; label: string; amountPaise: number; waivedBy?: string }> = [];

/** Failed coupon attempts per user before coupon checks pause (brute-force guard). */
export const COUPON_FAILURE_LIMIT = 10;
export const COUPON_FAILURE_WINDOW_MS = 15 * 60_000;

export type BookingPriceInput = {
  userId: string;
  serviceId: string;
  couponCode?: string;
  /** Legacy package tier price — validated against service min/base/max. */
  packagePrice?: number;
  /** Variant id from the service's catalog config. */
  variantId?: string;
  /** Hours / units / seats / area — validated against the service's quantity rule. */
  quantity?: number;
  audience?: string;
  professionalPreference?: string;
  /** Add-on ids from the service's add-on catalogue (or the shared one). */
  addonIds?: string[];
  /** Units per add-on id (only add-ons configured with maxQuantity > 1 accept more than one). */
  addonQuantities?: Record<string, number>;
  /** Selection-config version the client priced against; a mismatch is SERVICE_VERSION_CHANGED. */
  serviceVersion?: number;
  /** The address the quote is for — part of the quote fingerprint. */
  addressId?: string;
  /** Service location — enables weather-based dynamic surge when provided. */
  lat?: number;
  lng?: number;
};

export type BookingPriceBreakdown = {
  serviceBasePrice: number;
  packagePrice: number;
  /** Server-priced selection (variant, quantity, unit price, audience, duration). */
  selection: ServiceSelectionSnapshot;
  /** `price` is the line total; `unitPrice` × `quantity` = `price`. */
  addons: SelectedAddon[];
  addonTotal: number;
  baseAmount: number;
  weatherSurgeMultiplier: number;
  weatherSurgeAmount: number;
  weatherCondition?: string;
  membershipDiscount: number;
  campaignDiscount: number;
  /** Fee waiver actually applied. 0 while no fee is configured (see PLATFORM_FEES). */
  freeDeliveryDiscount: number;
  discount: number;
  discountedBase: number;
  taxes: number;
  finalAmount: number;
  couponCode?: string;
  campaignId?: string;
  membershipCouponId?: string;
  couponError?: string;
  paymentCapabilities: {
    walletAvailable: boolean;
    couponAvailable: boolean;
    membershipAvailable: boolean;
    splitPaymentAvailable: boolean;
  };
  // ---- Phase 05 (additive) ----
  currency: typeof PLATFORM_CURRENCY;
  pricingVersion: string;
  tax: { mode: typeof TAX_POLICY.mode; rateBps: number; version: string; label: string };
  /** Only the lines that actually apply, in order. Sum of amountPaise = finalAmountPaise. */
  lines: QuoteLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxesPaise: number;
  finalAmountPaise: number;
  /** Signed quote for exactly this selection; send it to POST /api/bookings to detect price changes. */
  quoteToken: string;
  /** Phase 06: customer-safe view of this selection's requirements (never partner or internal notes). */
  requirements: CustomerRequirementsView;
  expiresAt: string;
  /** Canonical selection fingerprint (the booking compares its own re-quote against the token). */
  selectionFingerprint: string;
  serviceVersion: number;
};

export class BookingPricingService {
  async quote(input: BookingPriceInput): Promise<
    | { ok: true; breakdown: BookingPriceBreakdown; resolvedRequirements: ResolvedRequirement[]; resolvedExecution: ResolvedStep[] }
    | { ok: false; error: string | SelectionError; issues?: SelectionIssue[]; currentVersion?: number }
  > {
    const started = Date.now();
    incCounter("quote_requests_total");
    const fail = (reason: string) => incCounter("quote_failures_total", { reason });
    const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
    if (!service) {
      fail("service_not_found");
      return { ok: false, error: "VALIDATION_ERROR" };
    }
    if (input.serviceVersion != null && input.serviceVersion !== service.version) {
      incCounter("service_quote_failures_total", { reason: "stale_version" });
      fail("stale_version");
      return { ok: false, error: "SERVICE_VERSION_CHANGED", currentVersion: service.version };
    }
    const cfg = await loadHydratedCatalog(service);
    // A customer is only ever quoted for something the customer catalogue would show — never a
    // fixture, test, internal or hidden service.
    if (!assertCustomerSellable(service, cfg).ok) {
      fail("service_unavailable");
      return { ok: false, error: "SERVICE_UNAVAILABLE" };
    }
    const bookable = assertBookable(service, cfg);
    if (!bookable.ok) {
      incCounter("service_quote_failures_total", { reason: "not_bookable" });
      fail(bookable.error === "PRICING_CONFIG_MISSING" ? "pricing_config_missing" : "not_bookable");
      if (bookable.error === "PRICING_CONFIG_MISSING") incCounter("quote_pricing_config_missing");
      return { ok: false, error: bookable.error };
    }
    if (!SUPPORTED_CURRENCIES.includes(service.currency)) {
      fail("currency_unsupported");
      incCounter("quote_pricing_config_missing");
      return { ok: false, error: "PRICING_CONFIG_MISSING" };
    }

    // Serviceability, at the point the customer asks the price. The same coverage rule runs again at
    // booking create (that is the authority); quoting it here means a customer is no longer given a
    // full priced quote for an address the service cannot be delivered to, only to be refused at the
    // last step. Quotes without an address are location-agnostic and skip it.
    if (input.addressId) {
      const address = await prisma.address.findFirst({
        where: { id: input.addressId, userId: input.userId },
        select: { city: true, zipCode: true },
      });
      if (address) {
        const cov = coverageAllowsAddress(service, cfg, { city: address.city, zipCode: address.zipCode });
        if (!cov.ok) {
          incCounter("service_availability_failures_total", { reason: "coverage" });
          fail("coverage");
          return { ok: false, error: "SERVICE_NOT_AVAILABLE" };
        }
      }
    }

    const entitlements = await entitlementService.resolve(input.userId);
    if (service.premiumOnly && !entitlements.premiumAccess) {
      fail("upgrade_required");
      return { ok: false, error: "UPGRADE_REQUIRED" };
    }

    // Every amount below is derived from server data; the client sends only ids + quantity.
    const sel = resolveServiceSelection(service, cfg, {
      variantId: input.variantId,
      quantity: input.quantity,
      packagePrice: input.packagePrice,
      audience: input.audience,
      professionalPreference: input.professionalPreference,
      addonIds: input.addonIds,
      addonQuantities: input.addonQuantities,
    });
    if (!sel.ok) {
      incCounter("service_quote_failures_total", { reason: sel.error });
      fail(sel.error);
      if (sel.error === "PRICING_CONFIG_MISSING") incCounter("quote_pricing_config_missing");
      else incCounter("quote_invalid_selection");
      for (const i of sel.issues) incCounter("service_selection_issue_total", { code: i.code });
      return { ok: false, error: sel.error, issues: sel.issues };
    }

    // Phase 06: requirements of exactly this selection. An invalid or conflicting configuration refuses
    // the quote (fail closed) rather than selling a job whose preparation is undefined.
    const reqs = resolveServiceRequirements(cfg, {
      variantId: sel.normalized.variantId,
      addonIds: sel.normalized.addonIds,
      quantity: sel.normalized.quantity,
    });
    incCounter("service_requirement_resolution_total", { outcome: reqs.ok ? "ok" : "failed" });
    if (!reqs.ok) {
      incCounter("requirement_resolution_failure_total", { reason: reqs.error });
      fail(reqs.error === "REQUIREMENT_CONFLICT" ? "requirement_conflict" : "requirements_invalid");
      return { ok: false, error: reqs.error === "REQUIREMENT_CONFLICT" ? "REQUIREMENT_CONFLICT" : "REQUIREMENTS_CONFIG_INVALID" };
    }
    // Phase 10 §7: the work plan of exactly this selection, same conditional rule as requirements.
    const plan = resolveExecutionPlan(cfg, {
      variantId: sel.normalized.variantId,
      addonIds: sel.normalized.addonIds,
      quantity: sel.normalized.quantity,
    });
    if (!plan.ok) {
      incCounter("execution_plan_resolution_failure_total");
      fail("execution_invalid");
      return { ok: false, error: "EXECUTION_CONFIG_INVALID" };
    }
    const addonNames = Object.fromEntries((cfg?.addons ?? []).map((a) => [a.id, a.name]));

    // ---- integer paise from here on (lib/pricing-policy.ts) ----
    const lines: QuoteLine[] = [];
    const serviceLabel = sel.snapshot.variant?.name ?? service.displayName ?? service.name;
    lines.push({
      code: "SERVICE",
      label: serviceLabel,
      amountPaise: sel.servicePricePaise,
      ...(sel.snapshot.quantityType ? { quantity: sel.snapshot.quantity } : {}),
      ...(sel.snapshot.unitPrice != null ? { unitPaise: toPaise(sel.snapshot.unitPrice) } : {}),
    });
    for (const a of sel.addons) {
      lines.push({ code: "ADDON", label: a.name, amountPaise: a.pricePaise, quantity: a.quantity, unitPaise: a.unitPaise });
    }
    const basePaise = sel.servicePricePaise + sel.addonTotalPaise;

    // Weather-based dynamic surge (fail-safe: no location or no weather → multiplier 1).
    let weatherSurgeMultiplier = 1;
    let weatherCondition: string | undefined;
    if (input.lat != null && input.lng != null) {
      const snap = await weatherService.getByCoords(input.lat, input.lng);
      if (snap) {
        weatherSurgeMultiplier = weatherService.surgeMultiplier(snap);
        weatherCondition = snap.description;
      }
    }
    const surgePaise = surgeAmountPaise(basePaise, weatherSurgeMultiplier);
    if (surgePaise > 0) lines.push({ code: "SURGE_WEATHER", label: "Weather demand adjustment", amountPaise: surgePaise });
    const chargeablePaise = basePaise + surgePaise;

    // Fees actually charged (none configured today).
    let feesPaise = 0;
    for (const f of PLATFORM_FEES) {
      feesPaise += f.amountPaise;
      lines.push({ code: "FEE", label: f.label, amountPaise: f.amountPaise });
    }

    const pay = paymentCapabilities(cfg);
    const discountAllowed =
      pay.membershipAvailable && entitlements.discountPct > 0
        ? await entitlementService.canUseBenefit(input.userId, BENEFIT.DISCOUNT_PCT)
        : false;
    const membershipPaise = discountAllowed ? percentToRupeePaise(chargeablePaise, Math.round(entitlements.discountPct * 100)) : 0;
    if (membershipPaise > 0) lines.push({ code: "DISCOUNT_MEMBERSHIP", label: "Membership discount", amountPaise: -membershipPaise });

    // A fee waiver only ever waives a fee that is on this quote.
    const waivableFeePaise = PLATFORM_FEES.filter((f) => f.waivedBy === BENEFIT.FREE_DELIVERY).reduce((s, f) => s + f.amountPaise, 0);
    const feeWaiverPaise =
      waivableFeePaise > 0 &&
      pay.membershipAvailable &&
      entitlements.freeDelivery &&
      (await entitlementService.canUseBenefit(input.userId, BENEFIT.FREE_DELIVERY))
        ? waivableFeePaise
        : 0;
    if (feeWaiverPaise > 0) lines.push({ code: "DISCOUNT_FEE_WAIVER", label: "Fee waived (membership)", amountPaise: -feeWaiverPaise });

    let campaignPaise = 0;
    let campaignId: string | undefined;
    let membershipCouponId: string | undefined;
    let couponCode: string | undefined;
    let couponError: string | undefined;

    if (input.couponCode?.trim()) {
      const failKey = `coupon-fail:${input.userId}`;
      if (!pay.couponAvailable) {
        couponError = "COUPON_NOT_ALLOWED";
        incCounter("service_payment_policy_rejected_total", { reason: "coupon" });
      } else if (!(await peekRateLimitSmart(failKey, COUPON_FAILURE_LIMIT, COUPON_FAILURE_WINDOW_MS)).allowed) {
        // Too many wrong codes: stop checking codes for a while. The quote itself still works.
        couponError = "COUPON_RATE_LIMITED";
        incCounter("rate_limit_triggered_total", { scope: "coupon_failures" });
      } else {
        const afterMembership = toRupees(Math.max(0, chargeablePaise - membershipPaise));
        const membershipCoupon = await membershipCouponService.validateForUser(input.userId, input.couponCode, afterMembership, {
          serviceCategory: service.category,
        });
        if (membershipCoupon.ok) {
          campaignPaise = Math.round(membershipCoupon.discount * 100);
          couponCode = membershipCoupon.code;
          membershipCouponId = membershipCoupon.couponId;
        } else {
          const campaignResult = await campaignService.validateForUser(input.userId, input.couponCode, afterMembership);
          if (!campaignResult.ok) {
            couponError = membershipCoupon.error !== "INVALID_CODE" ? membershipCoupon.error : campaignResult.error;
            if (couponError === "INVALID_CODE") await consumeRateLimitSmart(failKey, COUPON_FAILURE_LIMIT, COUPON_FAILURE_WINDOW_MS);
          } else {
            campaignPaise = Math.round(campaignResult.discount * 100);
            campaignId = campaignResult.campaignId;
            couponCode = campaignResult.code;
          }
        }
      }
    }
    if (campaignPaise > 0) lines.push({ code: "DISCOUNT_COUPON", label: `Coupon ${couponCode}`, amountPaise: -campaignPaise });

    const grossPaise = chargeablePaise + feesPaise;
    const discountPaise = Math.min(grossPaise, membershipPaise + campaignPaise + feeWaiverPaise);
    const discountedPaise = grossPaise - discountPaise;
    const taxesPaise = taxOn(discountedPaise);
    if (taxesPaise > 0) lines.push({ code: "TAX", label: TAX_POLICY.label, amountPaise: taxesPaise });
    const finalAmountPaise = discountedPaise + taxesPaise;

    // One canonical fingerprint, from the resolver's normalized selection (see selectionFingerprint).
    const fingerprint = selectionFingerprint({
      serviceId: service.id,
      variantId: sel.normalized.variantId,
      quantity: sel.normalized.quantity,
      audience: sel.normalized.audience,
      professionalPreference: sel.normalized.professionalPreference,
      addonIds: sel.normalized.addonIds,
      addonQuantities: sel.normalized.addonQuantities,
      packagePrice: sel.normalized.packagePrice,
      couponCode: input.couponCode,
      addressId: input.addressId,
    });
    const { token, expiresAt } = signQuote({
      uid: input.userId,
      sid: service.id,
      sv: service.version,
      sel: fingerprint,
      fp: finalAmountPaise,
      pv: PRICING_VERSION,
    });

    const latency = (Date.now() - started) / 1000;
    observeHist("service_price_quote_latency", latency);
    observeHist("quote_calculation_duration", latency);
    incCounter("service_quote_generated_total");
    return {
      ok: true,
      resolvedRequirements: reqs.items,
      resolvedExecution: plan.steps,
      breakdown: {
        requirements: customerRequirementsView(reqs.items, addonNames),
        serviceBasePrice: service.basePrice,
        packagePrice: sel.servicePrice,
        selection: sel.snapshot,
        addons: sel.addons,
        addonTotal: sel.addonTotal,
        baseAmount: toRupees(basePaise),
        weatherSurgeMultiplier,
        weatherSurgeAmount: toRupees(surgePaise),
        weatherCondition,
        membershipDiscount: toRupees(membershipPaise),
        campaignDiscount: toRupees(campaignPaise),
        freeDeliveryDiscount: toRupees(feeWaiverPaise),
        discount: toRupees(discountPaise),
        discountedBase: toRupees(discountedPaise),
        taxes: toRupees(taxesPaise),
        finalAmount: toRupees(finalAmountPaise),
        couponCode,
        campaignId,
        membershipCouponId,
        couponError,
        paymentCapabilities: pay,
        currency: PLATFORM_CURRENCY,
        pricingVersion: PRICING_VERSION,
        tax: { mode: TAX_POLICY.mode, rateBps: TAX_POLICY.rateBps, version: TAX_POLICY.version, label: TAX_POLICY.label },
        lines,
        subtotalPaise: grossPaise,
        discountPaise,
        taxesPaise,
        finalAmountPaise,
        quoteToken: token,
        expiresAt,
        selectionFingerprint: fingerprint,
        serviceVersion: service.version,
      },
    };
  }
}

export const bookingPricingService = new BookingPricingService();
