import prisma from "../lib/prisma";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { campaignService } from "./campaign.service";
import { membershipCouponService } from "./membership-coupon.service";
import { PLATFORM_VISIT_FEE_INR } from "../lib/membership-tiers";
import { weatherService } from "./weather.service";

const TAX_RATE = 0.1;

/** Server-authoritative add-on catalog (must match customer checkout IDs). */
export const BOOKING_ADDONS = [
  { id: "fridge", name: "Fridge Cleaning", price: 99 },
  { id: "sofa", name: "Sofa Cleaning", price: 149 },
  { id: "microwave", name: "Microwave Cleaning", price: 79 },
] as const;

export type BookingAddonId = (typeof BOOKING_ADDONS)[number]["id"];

export type BookingPriceInput = {
  userId: string;
  serviceId: string;
  couponCode?: string;
  /** Selected package tier price — validated against service min/max. */
  packagePrice?: number;
  /** Add-on IDs from BOOKING_ADDONS. */
  addonIds?: string[];
  /** Service location — enables weather-based dynamic surge when provided. */
  lat?: number;
  lng?: number;
};

export type BookingPriceBreakdown = {
  serviceBasePrice: number;
  packagePrice: number;
  addonTotal: number;
  baseAmount: number;
  weatherSurgeMultiplier: number;
  weatherSurgeAmount: number;
  weatherCondition?: string;
  membershipDiscount: number;
  campaignDiscount: number;
  freeDeliveryDiscount: number;
  discount: number;
  discountedBase: number;
  taxes: number;
  finalAmount: number;
  couponCode?: string;
  campaignId?: string;
  membershipCouponId?: string;
  couponError?: string;
};

function addonTotalFor(ids: string[] | undefined): number {
  if (!ids?.length) return 0;
  const allowed = new Map(BOOKING_ADDONS.map((a) => [a.id, a.price]));
  let total = 0;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const price = allowed.get(id as BookingAddonId);
    if (price == null) continue;
    seen.add(id);
    total += price;
  }
  return total;
}

function resolvePackagePrice(
  service: { basePrice: number; minPrice: number | null; maxPrice: number | null },
  requested?: number,
): { ok: true; price: number } | { ok: false; error: "INVALID_PACKAGE_PRICE" } {
  const min = service.minPrice ?? service.basePrice;
  const max = service.maxPrice ?? Math.max(service.basePrice, min);
  const tiers = [...new Set([min, service.basePrice, max])].sort((a, b) => a - b);

  if (requested == null || requested === service.basePrice) {
    return { ok: true, price: service.basePrice };
  }

  const match = tiers.find((t) => t === requested);
  if (match != null) return { ok: true, price: match };

  if (requested >= min && requested <= max) {
    return { ok: true, price: requested };
  }

  return { ok: false, error: "INVALID_PACKAGE_PRICE" };
}

export class BookingPricingService {
  async quote(input: BookingPriceInput): Promise<
    | { ok: true; breakdown: BookingPriceBreakdown }
    | { ok: false; error: string }
  > {
    const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
    if (!service || !service.isActive) {
      return { ok: false, error: "VALIDATION_ERROR" };
    }

    const entitlements = await entitlementService.resolve(input.userId);
    if (service.premiumOnly && !entitlements.premiumAccess) {
      return { ok: false, error: "UPGRADE_REQUIRED" };
    }

    const pkg = resolvePackagePrice(service, input.packagePrice);
    if (!pkg.ok) return { ok: false, error: pkg.error };

    const addonTotal = addonTotalFor(input.addonIds);
    const baseAmount = pkg.price + addonTotal;

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
    const weatherSurgeAmount = Math.round(baseAmount * (weatherSurgeMultiplier - 1));
    const chargeableBase = baseAmount + weatherSurgeAmount;

    const discountAllowed =
      entitlements.discountPct > 0
        ? await entitlementService.canUseBenefit(input.userId, BENEFIT.DISCOUNT_PCT)
        : false;
    const membershipDiscount = discountAllowed
      ? Math.round((chargeableBase * entitlements.discountPct) / 100)
      : 0;
    const freeDeliveryDiscount =
      entitlements.freeDelivery &&
      (await entitlementService.canUseBenefit(input.userId, BENEFIT.FREE_DELIVERY))
        ? PLATFORM_VISIT_FEE_INR
        : 0;

    let campaignDiscount = 0;
    let campaignId: string | undefined;
    let membershipCouponId: string | undefined;
    let couponCode: string | undefined;
    let couponError: string | undefined;

    if (input.couponCode?.trim()) {
      const afterMembership = Math.max(0, chargeableBase - membershipDiscount);
      const membershipCoupon = await membershipCouponService.validateForUser(
        input.userId,
        input.couponCode,
        afterMembership,
        { serviceCategory: service.category },
      );
      if (membershipCoupon.ok) {
        campaignDiscount = membershipCoupon.discount;
        couponCode = membershipCoupon.code;
        membershipCouponId = membershipCoupon.couponId;
      } else {
        const campaignResult = await campaignService.validateForUser(
          input.userId,
          input.couponCode,
          afterMembership,
        );
        if (!campaignResult.ok) {
          const err =
            membershipCoupon.error !== "INVALID_CODE"
              ? membershipCoupon.error
              : campaignResult.error;
          couponError = err;
        } else {
          campaignDiscount = campaignResult.discount;
          campaignId = campaignResult.campaignId;
          couponCode = campaignResult.code;
        }
      }
    }

    const discount = membershipDiscount + campaignDiscount + freeDeliveryDiscount;
    const discountedBase = Math.max(0, chargeableBase - discount);
    const taxes = Math.round(discountedBase * TAX_RATE);
    const finalAmount = discountedBase + taxes;

    return {
      ok: true,
      breakdown: {
        serviceBasePrice: service.basePrice,
        packagePrice: pkg.price,
        addonTotal,
        baseAmount,
        weatherSurgeMultiplier,
        weatherSurgeAmount,
        weatherCondition,
        membershipDiscount,
        campaignDiscount,
        freeDeliveryDiscount,
        discount,
        discountedBase,
        taxes,
        finalAmount,
        couponCode,
        campaignId,
        membershipCouponId,
        couponError,
      },
    };
  }
}

export const bookingPricingService = new BookingPricingService();
