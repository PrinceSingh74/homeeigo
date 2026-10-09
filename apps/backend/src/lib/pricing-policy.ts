/**
 * THE money and pricing policy. Every rupee the quote engine produces goes through here.
 *
 * Money is computed in integer PAISE. Rupee floats exist only at the edges (catalogue columns,
 * stored booking columns, the legacy API fields) and are converted with toPaise / toRupees.
 * Nothing in the pricing path multiplies or adds rupee floats.
 *
 * Rounding policy (unchanged from the pre-paise engine, now in one place):
 *   - line items (service × quantity, add-on × units) are exact paise; no rounding;
 *   - surge, membership discount and tax are each rounded ONCE, half-up, to a whole rupee —
 *     the same points the previous engine used Math.round on rupees;
 *   - totals are sums of already-rounded amounts, so nothing is rounded twice.
 * Pinned by pricing-policy.test.ts, including byte-compatibility with the previous formula.
 */

/** The only currency the platform prices, charges and settles in (Razorpay account currency). */
export const PLATFORM_CURRENCY = "INR" as const;
export const SUPPORTED_CURRENCIES: readonly string[] = [PLATFORM_CURRENCY];

/** Largest single amount the engine accepts (₹1 crore) — far above any catalogue price. */
export const MAX_AMOUNT_PAISE = 1_000_000_000;

/**
 * Tax policy. Rate and mode are the ones the platform already charged (`TAX_RATE = 0.1`,
 * exclusive, on the discounted base) — owner-confirmed rule "finalAmount = base + 10% tax".
 * Not a new rate. `version` is written into every booking's pricing snapshot.
 *
 * D4 (2026-10-10): this 10% line is a pass-through, not platform GST. Partner is supplier of
 * record; HOMEEIGO is facilitator. Label must stay "Taxes" — never "GST". See
 * docs/phase-1-business-decisions.md.
 */
export const TAX_POLICY = {
  version: "tax.v1",
  mode: "EXCLUSIVE" as const,
  rateBps: 1000,
  label: "Taxes",
};

/** Version of the pricing formula, stored with every quote and booking snapshot. */
export const PRICING_VERSION = "pricing.v2";

export class MoneyError extends Error {
  constructor(
    readonly code: "MONEY_NOT_FINITE" | "MONEY_NEGATIVE" | "MONEY_PRECISION" | "MONEY_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}

/** True when a rupee amount is a finite, non-negative value with at most 2 decimal places. */
export function isValidRupeeAmount(v: unknown): v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  const scaled = v * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6 && Math.round(scaled) <= MAX_AMOUNT_PAISE;
}

/** Rupees (≤ 2 decimals) → integer paise. Throws rather than silently rounding a bad amount. */
export function toPaise(rupees: number): number {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) throw new MoneyError("MONEY_NOT_FINITE", `amount is not finite: ${rupees}`);
  if (rupees < 0) throw new MoneyError("MONEY_NEGATIVE", `amount is negative: ${rupees}`);
  const scaled = rupees * 100;
  const paise = Math.round(scaled);
  if (Math.abs(scaled - paise) >= 1e-6) throw new MoneyError("MONEY_PRECISION", `amount has sub-paise precision: ${rupees}`);
  if (paise > MAX_AMOUNT_PAISE) throw new MoneyError("MONEY_TOO_LARGE", `amount exceeds the maximum: ${rupees}`);
  return paise;
}

/** Integer paise → rupees for the legacy rupee fields. Exact for any value ≤ MAX_AMOUNT_PAISE. */
export function toRupees(paise: number): number {
  return paise / 100;
}

/** Half-up to a whole rupee, on non-negative integer numerators over `denominator` paise units. */
function roundToRupee(numerator: number, denominator: number): number {
  // value in paise = numerator / denominator; rupees = value / 100.
  const unit = denominator * 100;
  return Math.floor((numerator * 2 + unit) / (unit * 2)) * 100;
}

/** `amountPaise × bps / 10_000`, rounded once half-up to a whole rupee (returned in paise). */
export function percentToRupeePaise(amountPaise: number, bps: number): number {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new MoneyError("MONEY_NOT_FINITE", "amount must be non-negative paise");
  if (!Number.isInteger(bps) || bps < 0) throw new MoneyError("MONEY_NOT_FINITE", "bps must be a non-negative integer");
  return roundToRupee(amountPaise * bps, 10_000);
}

/** Multiplier (e.g. 1.15) → basis points (11500). Multipliers come from policy tables, never clients. */
export function multiplierToBps(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier < 0) throw new MoneyError("MONEY_NOT_FINITE", "multiplier must be finite");
  return Math.round(multiplier * 10_000);
}

/**
 * Surge on a base for a policy multiplier (e.g. weather 1.15), rounded once half-up to a rupee.
 * The previous engine computed `Math.round(baseRupees * (multiplier - 1))`; 1.15 - 1 is
 * 0.1499999999999999 in floating point, so ₹10 surged by ₹1 instead of ₹1.50 → ₹2.
 */
export function surgeAmountPaise(basePaise: number, multiplier: number): number {
  const bps = multiplierToBps(multiplier) - 10_000;
  return bps > 0 ? percentToRupeePaise(basePaise, bps) : 0;
}

/** Sum of integer paise amounts — never a sum of rupee floats (0.1 + 0.2 ≠ 0.3). */
export function sumPaise(amounts: readonly number[]): number {
  return amounts.reduce((s, a) => s + a, 0);
}

/** Tax on a (discounted) base under TAX_POLICY. */
export function taxOn(basePaise: number): number {
  return percentToRupeePaise(basePaise, TAX_POLICY.rateBps);
}

/** A priced line in the customer-visible breakdown. Only lines that actually apply are emitted. */
export type QuoteLine = {
  code: "SERVICE" | "ADDON" | "SURGE_WEATHER" | "FEE" | "DISCOUNT_MEMBERSHIP" | "DISCOUNT_COUPON" | "DISCOUNT_FEE_WAIVER" | "TAX";
  label: string;
  /** Signed: discounts are negative. */
  amountPaise: number;
  quantity?: number;
  unitPaise?: number;
};
