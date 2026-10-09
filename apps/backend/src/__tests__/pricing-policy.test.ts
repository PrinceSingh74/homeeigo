/**
 * Phase 05 — the one money / rounding policy (lib/pricing-policy.ts) and the signed quote
 * (lib/quote-token.ts). Pure; no database.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_AMOUNT_PAISE,
  MoneyError,
  TAX_POLICY,
  isValidRupeeAmount,
  multiplierToBps,
  percentToRupeePaise,
  sumPaise,
  surgeAmountPaise,
  taxOn,
  toPaise,
  toRupees,
} from "../lib/pricing-policy";
import { selectionFingerprint, signQuote, verifyQuote, QUOTE_TTL_SECONDS } from "../lib/quote-token";
import { resolveServiceSelection, serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import { PLATFORM_FEES } from "../services/booking-pricing.service";

describe("money boundaries: toPaise refuses what it cannot represent exactly", () => {
  test("valid amounts", () => {
    expect(toPaise(0)).toBe(0);
    expect(toPaise(199)).toBe(19900);
    expect(toPaise(0.29)).toBe(29); // 0.29 * 100 = 28.999999999999996 in floating point
    expect(toPaise(1.1)).toBe(110);
    expect(toPaise(999.99)).toBe(99999);
    expect(toPaise(MAX_AMOUNT_PAISE / 100)).toBe(MAX_AMOUNT_PAISE);
  });
  test("negative, NaN, Infinity, sub-paise and huge amounts throw — never silently rounded", () => {
    const code = (v: number) => {
      try {
        toPaise(v);
        return "ok";
      } catch (e) {
        return (e as MoneyError).code;
      }
    };
    expect(code(-1)).toBe("MONEY_NEGATIVE");
    expect(code(Number.NaN)).toBe("MONEY_NOT_FINITE");
    expect(code(Number.POSITIVE_INFINITY)).toBe("MONEY_NOT_FINITE");
    expect(code(999.999999)).toBe("MONEY_PRECISION");
    expect(code(0.001)).toBe("MONEY_PRECISION");
    expect(code(1e12)).toBe("MONEY_TOO_LARGE");
    expect(isValidRupeeAmount(10.5)).toBe(true);
    expect(isValidRupeeAmount(10.555)).toBe(false);
  });
  test("catalogue schema rejects sub-paise prices", () => {
    expect(serviceCatalogConfigSchema.safeParse({ variants: [{ id: "a", name: "A", price: 10.001 }] }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ addons: [{ id: "a", name: "A", price: 49.5 }] }).success).toBe(true);
  });
});

describe("rounding: once, half-up, to a whole rupee, in integer paise", () => {
  test("tax is 10% exclusive (the existing platform rule), rounded once", () => {
    expect(TAX_POLICY).toMatchObject({ mode: "EXCLUSIVE", rateBps: 1000, label: "Taxes" });
    expect(TAX_POLICY.label).not.toMatch(/GST/i);
    expect(taxOn(toPaise(199))).toBe(2000); // 19.9 → 20
    expect(taxOn(toPaise(1045))).toBe(10500); // 104.5 → 105 (half-up)
    expect(taxOn(toPaise(1044))).toBe(10400);
    expect(taxOn(0)).toBe(0);
  });
  test("the quote engine's surge: exact, not the legacy float formula", () => {
    // Legacy: Math.round(10 * (1.15 - 1)) = ₹1. Exact: ₹1.50 → half-up ₹2.
    expect(surgeAmountPaise(toPaise(10), 1.15)).toBe(200);
    expect(surgeAmountPaise(toPaise(100), 1.15)).toBe(1500);
    expect(surgeAmountPaise(toPaise(1000), 1.3)).toBe(30000);
    expect(surgeAmountPaise(toPaise(999), 1)).toBe(0);
  });
  test("money sums are integer paise: ₹0.10 + ₹0.20 is exactly ₹0.30", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const cfg = serviceCatalogConfigSchema.parse({
      addons: [
        { id: "a", name: "A", price: 0.1 },
        { id: "b", name: "B", price: 0.2 },
      ],
    });
    const r = resolveServiceSelection({ basePrice: 100, minPrice: 100, maxPrice: 100, estimatedDuration: 30, pricingModel: "fixed" }, cfg, { addonIds: ["a", "b"] });
    expect(r.ok && r.addonTotalPaise).toBe(30);
    expect(r.ok && r.addonTotal).toBe(0.3);
    expect(sumPaise([10, 20])).toBe(30);
  });
  test("surge multiplier applied in basis points; float artefacts cannot move a rupee", () => {
    // 10 × (1.15 − 1) = 1.4999999999999991 in floating point → Math.round gave ₹1; the exact
    // value is ₹1.50, which rounds half-up to ₹2.
    expect(Math.round(10 * (1.15 - 1))).toBe(1);
    expect(percentToRupeePaise(toPaise(10), multiplierToBps(1.15) - 10_000)).toBe(200);
    expect(percentToRupeePaise(toPaise(1000), multiplierToBps(1.3) - 10_000)).toBe(30000);
  });
  test("byte-compatible with the previous engine for every whole-rupee base up to ₹5000 (tax)", () => {
    for (let base = 0; base <= 5000; base++) {
      const legacy = Math.round(base * 0.1);
      const exact = Math.floor((base * 10 + 50) / 100) / 1; // half-up of base/10
      const got = taxOn(toPaise(base)) / 100;
      expect(got).toBe(exact);
      // The legacy float formula agreed on every value where float error did not bite.
      if (legacy !== exact) expect(Math.abs(base * 0.1 - Math.round(base * 0.1))).toBeCloseTo(0.5, 5);
    }
  });
  test("membership percent is exact", () => {
    expect(percentToRupeePaise(toPaise(333), 1000)).toBe(3300); // 33.3 → 33
    expect(percentToRupeePaise(toPaise(335), 1000)).toBe(3400); // 33.5 → 34
  });
  test("toRupees(toPaise(x)) round-trips", () => {
    for (const v of [0, 0.01, 0.29, 1.1, 199, 999.99, 123456.78]) expect(toRupees(toPaise(v))).toBe(v);
  });
});

describe("fees are never fabricated", () => {
  test("no platform fee is configured, so no waiver can be granted", () => {
    expect(PLATFORM_FEES).toEqual([]);
  });
});

describe("hourly semantics: duration is not billable by itself", () => {
  const H = serviceCatalogConfigSchema.parse({
    bookingMode: "HOURLY",
    quantity: { type: "HOUR", unitLabel: "hour", unitLabelPlural: "hours", min: 1, max: 4, unitPrice: 199 },
    duration: { preparationMin: 10, cleanupMin: 5 },
    addons: [{ id: "extra", name: "Extra", price: 50, durationMin: 45 }],
  });
  const svc = { basePrice: 199, minPrice: 199, maxPrice: 199, estimatedDuration: 60, pricingModel: "hourly" };
  test("billable unit = the hour quantity; prep, cleanup and add-on minutes never add money", () => {
    const r = resolveServiceSelection(svc, H, { quantity: 3, addonIds: ["extra"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servicePricePaise).toBe(3 * 19900);
    expect(r.addonTotalPaise).toBe(5000);
    expect(r.duration.totalMinutes).toBe(10 + 180 + 45 + 5);
  });
  test("an unpriced configuration is PRICING_CONFIG_MISSING, never ₹0 or an invented price", () => {
    const r = resolveServiceSelection({ ...svc, basePrice: 0, minPrice: 0, maxPrice: 0, pricingModel: "fixed" }, null, {});
    expect(!r.ok && r.error).toBe("PRICING_CONFIG_MISSING");
  });
});

describe("signed quote", () => {
  const base = { uid: "u1", sid: "s1", sv: 3, sel: "abc", fp: 21890, pv: "pricing.v2" };
  /** Change the MAC's first character — never to the character it already has (T-5). */
  const tamperMac = (mac: string) => `${mac[0] === "x" ? "y" : "x"}${mac.slice(1)}`;
  test("round-trips", () => {
    const { token, expiresAt } = signQuote(base);
    const v = verifyQuote(token);
    expect(v.ok && v.payload).toMatchObject(base);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
  test("tampered amount or signature → QUOTE_INVALID", () => {
    const { token } = signQuote(base);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), fp: 1 })).toString("base64url");
    expect(verifyQuote(`${forged}.${mac}`)).toEqual({ ok: false, error: "QUOTE_INVALID" });
    expect(verifyQuote(`${body}.${tamperMac(mac!)}`)).toEqual({ ok: false, error: "QUOTE_INVALID" });
    expect(verifyQuote("garbage")).toEqual({ ok: false, error: "QUOTE_INVALID" });
  });
  /**
   * T-5: the tamper above was `x${mac.slice(1)}`. The MAC is a base64url HMAC, so about one run in 64
   * it already starts with "x" — the "tampered" token was the real one and verified. Found as a
   * one-off failure in a full regression. Made deterministic here: search for a MAC that starts
   * with "x" and prove the tamper still changes it.
   */
  test("tampering the signature always changes it — even a MAC that already starts with 'x' (T-5)", () => {
    let token = "";
    for (let i = 0; i < 20_000 && !token; i++) {
      const t = signQuote(base, 1_790_000_000_000 + i * 1000).token;
      if (t.split(".")[1]!.startsWith("x")) token = t;
    }
    expect(token).not.toBe("");
    const [body, mac] = token.split(".");
    const tampered = tamperMac(mac!);
    expect(tampered).not.toBe(mac);
    expect(verifyQuote(`${body}.${tampered}`)).toEqual({ ok: false, error: "QUOTE_INVALID" });
  });
  test("expired → QUOTE_EXPIRED", () => {
    const { token } = signQuote(base, Date.now() - (QUOTE_TTL_SECONDS + 5) * 1000);
    expect(verifyQuote(token)).toEqual({ ok: false, error: "QUOTE_EXPIRED" });
  });
  test("fingerprint is order-insensitive for add-ons and changes with any priced input", () => {
    const a = selectionFingerprint({ serviceId: "s", addonIds: ["x", "y"], quantity: 2 });
    expect(selectionFingerprint({ serviceId: "s", addonIds: ["y", "x"], quantity: 2 })).toBe(a);
    expect(selectionFingerprint({ serviceId: "s", addonIds: ["x", "y"], quantity: 3 })).not.toBe(a);
    expect(selectionFingerprint({ serviceId: "s", addonIds: ["x", "y"], quantity: 2, couponCode: "SAVE" })).not.toBe(a);
  });
});
