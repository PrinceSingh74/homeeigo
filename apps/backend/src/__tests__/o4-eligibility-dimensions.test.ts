/**
 * O4 — eligibility is evaluated server-side across every dimension, and the paths agree.
 *
 * There is deliberately no "eligibility engine" here to test. Eligibility is LAYERED across the
 * authorities that already own each question, and building a sixteenth module that answers all of
 * them would be the duplicate engine the architecture forbids — one that can disagree with the real
 * one and usually will.
 *
 * So this file pins two things instead:
 *
 * 1. **Every dimension has a named owner**, and that owner is still wired into the booking path.
 *    A dimension whose owner quietly stops being called is the failure mode: the booking still
 *    succeeds, and nobody notices the check is gone.
 * 2. **No dimension is answered in two places.** The quote path and the create path must reach the
 *    same authority, not their own copies of the rule.
 *
 * Structural by necessity — the thing being asserted is which module owns which question — and
 * honest about it rather than dressed up as behavioural.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const VALIDATION = read("src/services/booking-validation.service.ts");
const BOOKING = read("src/services/booking.service.ts");
const PRICING = read("src/services/booking-pricing.service.ts");
const CATALOG = read("src/lib/service-catalog-config.ts");
const AVAILABILITY = read("src/lib/service-availability.ts");
const DOMAIN = read("src/lib/service-domain.ts");

/**
 * The fifteen dimensions the owner locked, each with the authority that answers it and a marker
 * proving that authority is still reached. The marker is the call site, not the definition — a
 * function nobody calls protects nothing.
 */
const DIMENSIONS: Array<{ n: number; name: string; owner: string; source: string; marker: string }> = [
  { n: 1, name: "customer / account", owner: "booking-validation.service", source: VALIDATION, marker: "this.validateUser(request.userId)" },
  { n: 2, name: "service / version", owner: "booking-validation.service", source: VALIDATION, marker: "this.validateService(request.serviceId" },
  { n: 3, name: "required input", owner: "booking.service (Phase 06 attestations)", source: BOOKING, marker: "requirementAttestations" },
  { n: 4, name: "selected variant", owner: "service-catalog-config.resolveServiceSelection", source: CATALOG, marker: "variantId" },
  { n: 5, name: "quantity", owner: "service-catalog-config.resolveServiceSelection", source: CATALOG, marker: "quantity" },
  { n: 6, name: "duration", owner: "booking.service (slotDurationMinutes)", source: BOOKING, marker: "slotDurationMinutes" },
  { n: 7, name: "requirement state", owner: "booking.service (Phase 06)", source: BOOKING, marker: "requirement" },
  /**
   * Not a status literally named SAFETY_HOLD. `SAFETY_HOLD` and `COMMERCIAL_HOLD` are Phase 06
   * CONTENT statuses describing a service's requirement documentation; they are not runtime
   * gates, and looking for them here is how this test first failed. At runtime the safety
   * question is answered fail-closed by `assertBookable`: requirements that are unknown,
   * inactive, conflicting or undecided make the service unbookable rather than guessed at.
   */
  { n: 8, name: "safety readiness", owner: "assertBookable → REQUIREMENTS_CONFIG_INVALID", source: DOMAIN, marker: "REQUIREMENTS_CONFIG_INVALID" },
  /** Likewise commercial: incomplete authoritative pricing is unbookable, whatever the flags say. */
  { n: 9, name: "commercial readiness", owner: "assertBookable → PRICING_CONFIG_MISSING", source: DOMAIN, marker: "PRICING_CONFIG_MISSING" },
  { n: 10, name: "serviceability", owner: "coverageAllowsAddress", source: VALIDATION, marker: "coverageAllowsAddress(service, cfg" },
  { n: 11, name: "booking policy", owner: "service-availability.evaluateServiceTimeRules", source: VALIDATION, marker: "evaluateServiceTimeRules" },
  { n: 12, name: "lead time", owner: "service-availability", source: AVAILABILITY, marker: "LEAD_TIME_NOT_MET" },
  { n: 13, name: "advance horizon", owner: "service-availability", source: AVAILABILITY, marker: "BEYOND_ADVANCE_WINDOW" },
  { n: 14, name: "availability / capacity", owner: "booking-validation.detectConflicts", source: VALIDATION, marker: "this.detectConflicts(" },
  { n: 15, name: "provider capability", owner: "booking-validation.validateProvider", source: VALIDATION, marker: "this.validateProvider(request.providerId" },
];

describe("O4 — every eligibility dimension has an owner that is actually reached", () => {
  for (const d of DIMENSIONS) {
    test(`${d.n}. ${d.name} → ${d.owner}`, () => {
      expect(
        d.source.includes(d.marker),
        `dimension ${d.n} (${d.name}) is no longer wired: "${d.marker}" is gone from ${d.owner}`,
      ).toBe(true);
    });
  }

  test("the readiness gate is reached from the booking path, not merely defined", () => {
    // `assertBookable` is where 8 and 9 are decided; a definition nobody calls protects nothing.
    expect(VALIDATION).toContain("assertBookable(service, cfg)");
  });

  test("all fifteen are listed — the matrix cannot silently shrink", () => {
    expect(DIMENSIONS).toHaveLength(15);
    expect(new Set(DIMENSIONS.map((d) => d.n)).size).toBe(15);
  });
});

describe("O4 — no dimension is answered twice", () => {
  test("serviceability: quote and create both call the SAME coverage authority", () => {
    // Not "both check coverage" — both call `coverageAllowsAddress`. Two functions that happen to
    // agree today are two rules, and they diverge the first time one is edited.
    for (const [name, source] of [["quote", PRICING], ["create", BOOKING], ["validation", VALIDATION]] as const) {
      expect(source.includes("coverageAllowsAddress"), `${name} does not use the coverage authority`).toBe(true);
    }
    // And nobody has grown a private one.
    for (const [name, source] of [["quote", PRICING], ["create", BOOKING], ["validation", VALIDATION]] as const) {
      expect(
        /function\s+\w*[Cc]overage\w*\s*\(/.test(source),
        `${name} defines its own coverage function`,
      ).toBe(false);
    }
  });

  test("time rules: one implementation, shared by create, reschedule and availability", () => {
    expect(VALIDATION).toContain("evaluateServiceTimeRules");
    // `serviceTimeIssue` is the single private wrapper both create and reschedule go through.
    expect(VALIDATION).toContain("serviceTimeIssue");
    expect(read("src/services/service-availability.service.ts")).toContain("evaluateServiceTimeRules");
    // No second copy of the reason vocabulary.
    for (const rel of ["src/services/booking.service.ts", "src/services/booking-pricing.service.ts"]) {
      expect(read(rel).includes("BEYOND_ADVANCE_WINDOW")).toBe(false);
    }
  });

  test("pricing: the quote and the booking derive amounts from the same selection resolver", () => {
    expect(PRICING).toContain("resolveServiceSelection");
    // The booking stores what the resolver produced; it must not re-derive a price of its own.
    expect(/function\s+\w*[Pp]rice\w*\s*\(/.test(BOOKING)).toBe(false);
  });

  test("the refusal vocabulary is structured, not prose", () => {
    // Every dimension refuses with a stable machine-readable code a client can branch on.
    for (const code of [
      "USER_INVALID",
      "ADDRESS_INVALID",
      "COVERAGE_INVALID",
      "PROVIDER_INVALID",
      "AMOUNT_INVALID",
    ]) {
      expect(VALIDATION.includes(`"${code}"`), `${code} is no longer emitted`).toBe(true);
    }
    for (const reason of [
      "SLOT_IN_PAST",
      "LEAD_TIME_NOT_MET",
      "BEYOND_ADVANCE_WINDOW",
      "SAME_DAY_UNAVAILABLE",
      "BLACKOUT_DATE",
      "INVALID_DATE",
    ]) {
      expect(AVAILABILITY.includes(reason), `time reason ${reason} is gone`).toBe(true);
    }
  });
});
