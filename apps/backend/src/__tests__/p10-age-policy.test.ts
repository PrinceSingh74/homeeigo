/**
 * Phase D — customer age policy: pure rules + structural wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGE_REFUSAL_CODES, evaluateAgePolicy, parseDateOfBirth, wholeYearAge, type CustomerPolicyConfig } from "../lib/customer-policy";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import { bookingConfigSnapshot } from "../lib/service-domain";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const dob = (s: string) => new Date(`${s}T00:00:00Z`);
/** An instant at a given IST wall-clock time. */
const ist = (s: string) => new Date(`${s}+05:30`);
const NOW = ist("2026-09-24T12:00:00");

const pol = (age: NonNullable<CustomerPolicyConfig>["age"], version?: number): CustomerPolicyConfig => ({ age, ...(version ? { version } : {}) });
const ev = (policy: CustomerPolicyConfig | null, dateOfBirth: Date | null, guardianAttested = false, now = NOW) =>
  evaluateAgePolicy({ policy, dateOfBirth, guardianAttested, now, timeZone: "Asia/Kolkata" });

describe("whole-year age in IST", () => {
  test("birthday boundary: the day before is one year less; the day itself counts", () => {
    expect(wholeYearAge(dob("2008-09-25"), NOW)).toBe(17);
    expect(wholeYearAge(dob("2008-09-24"), NOW)).toBe(18);
    expect(wholeYearAge(dob("2008-09-23"), NOW)).toBe(18);
  });

  test("the date is IST: 00:30 IST on the birthday is already the birthday (still the day before in UTC)", () => {
    const now = new Date("2026-03-14T19:00:00Z"); // 2026-03-15 00:30 IST
    expect(wholeYearAge(dob("2008-03-15"), now)).toBe(18);
    expect(wholeYearAge(dob("2008-03-15"), now, "UTC")).toBe(17);
    // 23:59 IST the day before is not yet the birthday.
    expect(wholeYearAge(dob("2008-03-15"), ist("2026-03-14T23:59:00"))).toBe(17);
  });

  test("29 February: reached on 1 March in a non-leap year, on the day in a leap year", () => {
    expect(wholeYearAge(dob("2008-02-29"), ist("2026-02-28T12:00:00"))).toBe(17);
    expect(wholeYearAge(dob("2008-02-29"), ist("2026-03-01T00:05:00"))).toBe(18);
    expect(wholeYearAge(dob("2008-02-29"), ist("2028-02-28T23:00:00"))).toBe(19);
    expect(wholeYearAge(dob("2008-02-29"), ist("2028-02-29T00:01:00"))).toBe(20);
  });

  test("a future date of birth and an age above 120 are not ages", () => {
    expect(wholeYearAge(dob("2026-09-25"), NOW)).toBeNull();
    expect(wholeYearAge(dob("1905-01-01"), NOW)).toBeNull();
    expect(wholeYearAge(dob("1906-09-24"), NOW)).toBe(120);
    expect(wholeYearAge(new Date("nope"), NOW)).toBeNull();
  });
});

describe("evaluateAgePolicy — every mode", () => {
  test("no policy / NONE → NOT_APPLICABLE, DOB not needed", () => {
    for (const p of [null, undefined, {}, pol({ mode: "NONE" })] as Array<CustomerPolicyConfig | null>) {
      const d = ev(p ?? null, null);
      expect(d.outcome).toBe("NOT_APPLICABLE");
      expect(d.reasonCode).toBe("AGE_POLICY_NONE");
    }
  });

  test("MINIMUM_AGE: unknown DOB → AGE_VERIFICATION_REQUIRED; below → AGE_BELOW_MINIMUM; at/above → ALLOWED", () => {
    const p = pol({ mode: "MINIMUM_AGE", minimumAge: 16 }, 3);
    expect(ev(p, null)).toMatchObject({ outcome: "REFUSED", reasonCode: "AGE_VERIFICATION_REQUIRED", inputs: { ageKnown: false, ageYears: null }, policyVersion: "customer-policy.v3" });
    expect(ev(p, dob("2010-09-25"))).toMatchObject({ outcome: "REFUSED", reasonCode: "AGE_BELOW_MINIMUM", inputs: { ageKnown: true, ageYears: 15 } });
    expect(ev(p, dob("2010-09-24"))).toMatchObject({ outcome: "ALLOWED", reasonCode: "AGE_ALLOWED", inputs: { ageYears: 16 } });
  });

  test("ADULT_ONLY uses the configured adultAge only", () => {
    const p = pol({ mode: "ADULT_ONLY", adultAge: 21 });
    expect(ev(p, dob("2006-01-01"))).toMatchObject({ outcome: "REFUSED", reasonCode: "ADULT_REQUIRED", inputs: { ageYears: 20 } });
    expect(ev(p, dob("2005-09-24"))).toMatchObject({ outcome: "ALLOWED", reasonCode: "AGE_ALLOWED" });
    expect(ev(p, null).reasonCode).toBe("AGE_VERIFICATION_REQUIRED");
    expect(ev(pol({ mode: "ADULT_ONLY", adultAge: 25 }), dob("2004-01-01")).reasonCode).toBe("ADULT_REQUIRED");
  });

  test("GUARDIAN_REQUIRED: below the threshold only with an attestation; at/above alone", () => {
    const p = pol({ mode: "GUARDIAN_REQUIRED", guardianMinimumAge: 18 });
    expect(ev(p, dob("2012-01-01"))).toMatchObject({ outcome: "REFUSED", reasonCode: "GUARDIAN_ATTESTATION_REQUIRED", inputs: { guardianAttested: false } });
    expect(ev(p, dob("2012-01-01"), true)).toMatchObject({ outcome: "ALLOWED", reasonCode: "AGE_ALLOWED", inputs: { guardianAttested: true, ageYears: 14 } });
    expect(ev(p, dob("2000-01-01"))).toMatchObject({ outcome: "ALLOWED" });
    // An attestation does not stand in for an age: unknown DOB is still refused.
    expect(ev(p, null, true).reasonCode).toBe("AGE_VERIFICATION_REQUIRED");
  });

  test("a stored future / implausible DOB is invalid input, never an age", () => {
    const p = pol({ mode: "MINIMUM_AGE", minimumAge: 10 });
    expect(ev(p, dob("2027-01-01"))).toMatchObject({ outcome: "REFUSED", reasonCode: "AGE_INPUT_INVALID", inputs: { ageKnown: false, ageYears: null } });
    expect(ev(p, dob("1800-01-01")).reasonCode).toBe("AGE_INPUT_INVALID");
  });

  test("no legal age is ever assumed: a mode without its number is refused, not defaulted", () => {
    for (const age of [{ mode: "MINIMUM_AGE" }, { mode: "ADULT_ONLY" }, { mode: "GUARDIAN_REQUIRED" }] as const) {
      const d = ev({ age } as CustomerPolicyConfig, dob("1990-01-01"), true);
      expect(d).toMatchObject({ outcome: "REFUSED", reasonCode: "POLICY_NOT_CONFIGURED" });
    }
    const src = read("src/lib/customer-policy.ts");
    expect(src).not.toMatch(/\b(18|21)\b/);
  });

  test("inputs carry only ageKnown / ageYears / guardianAttested — never the date of birth", () => {
    const d = ev(pol({ mode: "MINIMUM_AGE", minimumAge: 10 }), dob("2001-05-06"), true);
    expect(Object.keys(d.inputs).sort()).toEqual(["ageKnown", "ageYears", "guardianAttested"]);
    expect(JSON.stringify(d)).not.toContain("2001");
    expect(d.policyVersion).toBe("customer-policy.unversioned");
  });
});

describe("date-of-birth input", () => {
  test("valid civil date → 00:00 UTC of that date", () => {
    const r = parseDateOfBirth("2000-02-29", NOW);
    expect(r.ok && r.date.toISOString()).toBe("2000-02-29T00:00:00.000Z");
  });
  test("malformed, impossible, future and implausible dates are refused", () => {
    expect(parseDateOfBirth("2001-02-29", NOW)).toEqual({ ok: false, error: "DOB_INVALID" });
    expect(parseDateOfBirth("24/09/2000", NOW)).toEqual({ ok: false, error: "DOB_INVALID" });
    expect(parseDateOfBirth("2026-09-25", NOW)).toEqual({ ok: false, error: "DOB_IN_FUTURE" });
    expect(parseDateOfBirth("1850-01-01", NOW)).toEqual({ ok: false, error: "DOB_IMPLAUSIBLE" });
    expect(parseDateOfBirth("2026-09-24", NOW).ok).toBe(true);
  });
});

describe("catalogue schema — thresholds are explicit", () => {
  const issuesAt = (cfg: unknown, path: string) => {
    const r = serviceCatalogConfigSchema.safeParse(cfg);
    return r.success ? [] : r.error.issues.filter((i) => i.path.join(".") === path);
  };
  test("ADULT_ONLY without adultAge, MINIMUM_AGE without minimumAge, GUARDIAN_REQUIRED without guardianMinimumAge are rejected", () => {
    expect(issuesAt({ customerPolicy: { age: { mode: "ADULT_ONLY" } } }, "customerPolicy.age.adultAge")).toHaveLength(1);
    expect(issuesAt({ customerPolicy: { age: { mode: "MINIMUM_AGE" } } }, "customerPolicy.age.minimumAge")).toHaveLength(1);
    expect(issuesAt({ customerPolicy: { age: { mode: "GUARDIAN_REQUIRED" } } }, "customerPolicy.age.guardianMinimumAge")).toHaveLength(1);
  });
  test("with the explicit number there is no age-policy issue", () => {
    expect(issuesAt({ customerPolicy: { age: { mode: "ADULT_ONLY", adultAge: 19 } } }, "customerPolicy.age.adultAge")).toHaveLength(0);
  });
});

describe("wiring", () => {
  test("the booking snapshot freezes the policy that applied (and nothing when none is configured)", () => {
    const core = { id: "s1", slug: "s", name: "S", version: 4, pricingModel: "fixed", includedServices: [], excludedServices: [] } as any;
    const sel = { durationMinutes: 60, variant: null, quantity: 1 };
    const cfg = serviceCatalogConfigSchema.parse({ customerPolicy: { age: { mode: "MINIMUM_AGE", minimumAge: 16 }, version: 2 } });
    expect(bookingConfigSnapshot(core, cfg, sel).customerPolicy).toEqual({ age: { mode: "MINIMUM_AGE", minimumAge: 16 }, version: 2 });
    expect(bookingConfigSnapshot(core, null, sel).customerPolicy).toBeNull();
  });

  test("booking create evaluates before the transaction and records the admitting decision inside it", () => {
    const src = read("src/services/booking.service.ts");
    const pre = src.indexOf("customerPolicyService.evaluateForBooking(");
    const tx = src.indexOf("booking = await prisma.$transaction(");
    const rec = src.indexOf("customerPolicyService.recordInTransaction(tx,");
    expect(pre).toBeGreaterThan(0);
    expect(pre).toBeLessThan(tx);
    expect(rec).toBeGreaterThan(tx);
  });

  test("every refusal code is mapped by the booking route (none can fall through to 201)", () => {
    const route = read("src/routes/bookings.ts");
    const table = route.slice(route.indexOf("const AGE_POLICY_ERRORS"), route.indexOf("const QUOTE_ERRORS"));
    for (const code of AGE_REFUSAL_CODES) expect(table).toContain(`${code}:`);
    expect(route).toContain("guardianAttested: t.Optional(t.Boolean())");
  });

  test("admin routes have permission rules", () => {
    const perms = read("src/lib/admin-route-permissions.ts");
    expect(perms).toContain("date-of-birth$/, resource: \"USERS\", action: \"UPDATE\"");
    expect(perms).toContain("customer-policy\\/decisions$/, resource: \"USERS\", action: \"READ\"");
  });
});
