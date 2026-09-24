import type { Addon, PriceInfo, PricingModel, ServiceView, Variant } from "@/lib/catalog/types";
import type { QuantityRule, ResponsibilityPolicy, SparePartsPolicy } from "@/types/backend";

export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  hourly: "Hourly",
  fixed: "Fixed price",
  "per-unit": "Per unit",
  "per-seat": "Per seat",
  area: "Area based",
  package: "Package",
  inspection: "Inspection",
  quote: "Custom quote",
};

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatInr(amount: number): string {
  return `₹${inr.format(Math.round(amount))}`;
}

/** Screen-reader friendly amount ("399 rupees"). */
export function spokenInr(amount: number): string {
  return `${inr.format(Math.round(amount))} rupees`;
}

type PriceText = { label: string; spoken: string };

/**
 * The one place a card/detail price string is produced. Live services use the
 * backend price; coming-soon services never show an amount.
 */
export function priceText(
  svc: Pick<ServiceView, "pricingModel" | "unit" | "price" | "status"> & Partial<Pick<ServiceView, "quantity" | "variants">>,
): PriceText {
  const { pricingModel: model, price } = svc;
  // Not bookable yet: never an amount; the pricing model is shown separately.
  if (svc.status !== "live" || !price) {
    return { label: "Pricing at launch", spoken: "Pricing will be announced at launch" };
  }
  if (model === "quote") return { label: "Custom quote", spoken: "Priced by custom quote" };
  // Unit labels only exist when a configured quantity rule makes them true.
  const rule = svc.quantity;
  if (rule) {
    const unitPrice = rule.unitPrice ?? price.base;
    if (rule.minimumCharge && rule.minimumCharge > unitPrice * rule.min) {
      return {
        label: `From ${formatInr(rule.minimumCharge)}`,
        spoken: `from ${spokenInr(rule.minimumCharge)}, then ${spokenInr(unitPrice)} per ${rule.unitLabel}`,
      };
    }
    return { label: `${formatInr(unitPrice)} / ${rule.unitLabel}`, spoken: `${spokenInr(unitPrice)} per ${rule.unitLabel}` };
  }
  if (svc.variants?.length) {
    const min = Math.min(...svc.variants.map((v) => v.price));
    return svc.variants.length > 1
      ? { label: `From ${formatInr(min)}`, spoken: `from ${spokenInr(min)}` }
      : { label: formatInr(min), spoken: spokenInr(min) };
  }
  const unit = undefined as string | undefined;
  const base = price.base;
  const from = price.max > price.base;
  switch (model) {
    case "hourly":
      return { label: `${formatInr(base)} / hour`, spoken: `${spokenInr(base)} per hour` };
    case "per-unit":
    case "per-seat": {
      const u = model === "per-seat" ? "seat" : (unit ?? "unit");
      return { label: `${formatInr(base)} / ${u}`, spoken: `${spokenInr(base)} per ${u}` };
    }
    case "area":
      return {
        label: `From ${formatInr(base)} / ${unit ?? "sq. ft."}`,
        spoken: `from ${spokenInr(base)} per ${unit ?? "square foot"}`,
      };
    case "package":
      return { label: `Package from ${formatInr(base)}`, spoken: `packages from ${spokenInr(base)}` };
    case "inspection":
      return { label: `Inspection ${formatInr(base)}`, spoken: `inspection visit ${spokenInr(base)}` };
    default:
      return from
        ? { label: `From ${formatInr(base)}`, spoken: `from ${spokenInr(base)}` }
        : { label: formatInr(base), spoken: spokenInr(base) };
  }
}

export function formatDuration(minutes: number | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 600) {
    const h = minutes / 60;
    const txt = Number.isInteger(h) ? String(h) : h.toFixed(1);
    return `${txt} ${h === 1 ? "hr" : "hrs"}`;
  }
  return `${Math.round(minutes / 60)} hrs`;
}

/* ------------------------------------------------------------------ */
/* Tier options — mirrors the /book package model exactly.             */
/* ------------------------------------------------------------------ */

/**
 * The booking API prices a service at one of three tiers: min, base, max
 * (see apps/backend booking-pricing.service resolvePackagePrice). /book shows
 * them as Basic / Standard / Premium at package indexes 0 / 1 / 2. Keep these
 * names and indexes in lockstep with BookPageClient's packagesFromApi.
 */
export const PACKAGE_TIERS = [
  { index: 0, name: "Basic", tag: "Essentials" },
  { index: 1, name: "Standard", tag: "Most popular" },
  { index: 2, name: "Premium", tag: "Full service" },
] as const;

export type TierOption = { index: number; name: string; tag: string; price: number };

export function tierOptions(price: PriceInfo): TierOption[] {
  const prices = [price.min, price.base, price.max];
  const seen = new Set<number>();
  const out: TierOption[] = [];
  // Standard first claims its price, so a min==base service shows "Standard", not "Basic".
  for (const i of [1, 0, 2]) {
    const p = prices[i]!;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ ...PACKAGE_TIERS[i]!, price: p });
  }
  return out.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ */
/* Add-ons — server-authoritative catalogue.                           */
/* ------------------------------------------------------------------ */

/**
 * Must match apps/backend booking-pricing.service BOOKING_ADDONS (ids and
 * prices). The server ignores unknown ids and re-prices known ones, so a
 * mismatch can never overcharge — but the displayed total would be wrong.
 */
export const BOOKING_ADDONS = [
  { id: "fridge", name: "Fridge Cleaning", desc: "Deep cleaning & sanitization", price: 99 },
  { id: "sofa", name: "Sofa Cleaning", desc: "Vacuum & stain removal", price: 149 },
  { id: "microwave", name: "Microwave Cleaning", desc: "Interior cleaning", price: 79 },
] as const;

export type BookingAddon = (typeof BOOKING_ADDONS)[number];

/**
 * Add-ons offered on a service: its own configured catalogue when the backend
 * has one (the server then accepts only those), else the shared catalogue for
 * services the taxonomy marks as add-on friendly.
 */
export function addonsFor(svc: ServiceView): Addon[] {
  if (svc.status !== "live") return [];
  if (svc.config?.addons) return svc.config.addons.filter((a) => a.active).map(({ active: _a, ...a }) => a);
  if (!svc.def.addons) return [];
  const skip = new Set(svc.def.excludeAddons ?? []);
  return BOOKING_ADDONS.filter((a) => !skip.has(a.id)).map((a) => ({ ...a }));
}

/* ------------------------------------------------------------------ */
/* Selection pricing lives on the server (POST /api/services/:id/resolve-selection and the  */
/* price quote). The former client estimateSelection() re-implemented the backend formula   */
/* and was removed in Phase 05 — the browser never computes money.                         */
/* ------------------------------------------------------------------ */

/** Server service-line price for a quantity, from the list/detail `quantityPrices` table. */
export function serverQuantityPrice(svc: Pick<ServiceView, "quantityPrices">, quantity: number): number | null {
  return svc.quantityPrices?.find((p) => p.quantity === quantity)?.servicePrice ?? null;
}

export function quantityBounds(rule: QuantityRule, variant?: Variant | null) {
  return {
    min: variant?.quantity?.min ?? rule.min,
    max: variant?.quantity?.max ?? rule.max,
    step: rule.step || 1,
  };
}

export function quantityOptions(rule: QuantityRule, variant?: Variant | null): number[] {
  const { min, max, step } = quantityBounds(rule, variant);
  const out: number[] = [];
  for (let q = min; q <= max && out.length < 50; q += step) out.push(q);
  return out;
}

export function unitWord(rule: Pick<QuantityRule, "unitLabel" | "unitLabelPlural">, n: number): string {
  return n === 1 ? rule.unitLabel : (rule.unitLabelPlural ?? rule.unitLabel);
}

/* ------------------------------------------------------------------ */
/* Materials / equipment / spare parts — customer labels for backend enums */
/* ------------------------------------------------------------------ */

export const RESPONSIBILITY_LABELS: Record<ResponsibilityPolicy, string | null> = {
  CUSTOMER_PROVIDED: "Provided by you",
  PROFESSIONAL_PROVIDED: "Provided by your HOMEEIGO professional",
  PACKAGE_INCLUDED: "Included in the package you choose",
  MIXED: "Some provided by you, some by your professional",
  NOT_REQUIRED: "Not needed for this service",
  NOT_SPECIFIED: null,
};

export const SPARE_PARTS_LABELS: Record<SparePartsPolicy, string | null> = {
  NOT_APPLICABLE: null,
  INCLUDED: "Included in the price",
  CUSTOMER_PAYS: "Charged separately",
  APPROVAL_REQUIRED: "Charged separately, only with your approval",
};

/* ------------------------------------------------------------------ */
/* Hourly mode                                                         */
/* ------------------------------------------------------------------ */

export const HOURLY_OPTIONS = [1, 2, 3, 4] as const;

export const HOURLY_TASKS = [
  "Dusting",
  "Wiping",
  "Sweeping",
  "Mopping",
  "Utensils",
  "Laundry",
  "Folding",
  "Kitchen Prep",
  "Organization",
  "Other household assistance",
] as const;

export type HourlyQuote =
  | { bookable: true; hours: number; amount: number; packageIndex: number }
  | { bookable: false; hours: number; amount: number };

/**
 * Hours × hourly rate, bookable only when the amount is a tier the booking API
 * will charge. Today the API has no hours quantity, so an hour count is only
 * bookable when rate × hours equals the service's min/base/max price. Raising
 * maxPrice in admin unlocks longer bookings automatically.
 */
export function hourlyQuote(price: PriceInfo, hours: number): HourlyQuote {
  const amount = price.base * hours;
  const tiers = [price.min, price.base, price.max];
  // Prefer Standard (1) so 1 hour maps to the same package /book pre-selects.
  const idx = [1, 0, 2].find((i) => tiers[i] === amount);
  return idx == null ? { bookable: false, hours, amount } : { bookable: true, hours, amount, packageIndex: idx };
}
