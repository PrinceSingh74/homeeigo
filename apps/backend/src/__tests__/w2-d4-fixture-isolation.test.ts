/**
 * W2-D4 — provider fixture isolation: the rules, and where they are enforced.
 *
 * Measured on homigo_db before this change, read-only: all 324 providers had UNKNOWN provenance,
 * 37 of the 84 dispatchable ones on RFC 2606 reserved domains that cannot receive mail, 9 real
 * customers' bookings assigned to such partners (4 still live), and 4 certification bookings on
 * real partners' calendars.
 *
 * The isolation machinery (`analytics-scope`) was already sound. It was switched off in data — no
 * creation path ever set provenance — and bypassed in code at every place a partner is chosen other
 * than matching's candidate query. This file pins both halves.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyUserEmail, provenanceForNewUser } from "../lib/data-provenance";
import { analyticsSqlPredicate, analyticsWhere, isBusinessRow } from "../lib/analytics-scope";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

describe("new rows are born classified — by evidence, never by assumption", () => {
  test("a reserved-domain address is classified at creation", () => {
    expect(provenanceForNewUser("someone@example.com")).toEqual({ dataOrigin: "INFERRED_SYNTHETIC" });
    expect(provenanceForNewUser("fixture@adv.test")).toEqual({ dataOrigin: "INFERRED_SYNTHETIC" });
  });

  test("a suite plus-tag is classified at creation", () => {
    expect(provenanceForNewUser("ops+e2e-run@gmail.com").dataOrigin).toBe("INFERRED_TEST");
  });

  test("an ordinary address stays UNKNOWN — nothing is ever declared REAL", () => {
    // Declaring REAL for "no rule fired" would be inventing a classification.
    expect(provenanceForNewUser("customer@gmail.com")).toEqual({});
    expect(provenanceForNewUser(null)).toEqual({});
  });

  test("the app's own phone-signup placeholder is NOT mistaken for a synthetic account", () => {
    // `.invalid` is reserved, but these are real customers who signed up by phone.
    const placeholder = "p0123456789abcdef0123@phone.homeeigo.invalid";
    expect(classifyUserEmail(placeholder)).toBeNull();
    expect(provenanceForNewUser(placeholder)).toEqual({});
  });

  test("every runtime creation path classifies", () => {
    for (const rel of [
      "src/services/apple-oauth.service.ts",
      "src/services/google-oauth.service.ts",
      "src/services/partner-registration.service.ts",
      "src/routes/auth.ts",
    ]) {
      expect(read(rel).includes("...provenanceForNewUser("), `${rel} creates users without provenance`).toBe(true);
    }
    // auth.ts has two creation paths — both are covered.
    expect((read("src/routes/auth.ts").match(/\.\.\.provenanceForNewUser\(/g) ?? []).length).toBe(2);
  });

  test("the test harness classifies its users the same way production does", () => {
    const fixtures = read("src/__tests__/helpers/adversarial-fixtures.ts");
    expect((fixtures.match(/\.\.\.provenanceForNewUser\(/g) ?? []).length).toBe(7);
  });
});

describe("one source of truth: a provider inherits provenance from its user", () => {
  test("Provider carries no provenance column of its own", () => {
    const schema = read("prisma/schema.prisma");
    const provider = schema.slice(schema.indexOf("model Provider {"), schema.indexOf("model Provider {") + 12_000);
    const body = provider.slice(0, provider.indexOf("\n}"));
    // A second column could disagree with the user's — the exact duplication the architecture forbids.
    expect(body.includes("dataOrigin")).toBe(false);
  });

  test("the SQL predicate and the Prisma predicate state the same policy", () => {
    expect(analyticsSqlPredicate("x")).toBe("(x.data_origin IS NULL OR x.data_origin = 'REAL')");
    expect(analyticsWhere()).toEqual({ OR: [{ dataOrigin: null }, { dataOrigin: "REAL" }] });
    expect(isBusinessRow(null)).toBe(true);
    expect(isBusinessRow("REAL")).toBe(true);
    expect(isBusinessRow("INFERRED_SYNTHETIC")).toBe(false);
  });
});

describe("every place a partner is chosen enforces the population", () => {
  test("matching: symmetric — a non-business customer sees ONLY non-business partners", () => {
    const m = read("src/services/matching.service.ts");
    expect(m).toContain('return analyticsWhere("NON_BUSINESS") as Prisma.UserWhereInput;');
    // The old asymmetric version returned no filter at all for a fixture customer.
    expect(m.includes("if (c && !isBusinessRow(c.dataOrigin)) return undefined;")).toBe(false);
  });

  test("availability: scoped to the same population as matching", () => {
    const m = read("src/services/matching.service.ts");
    // Phase 11: the projection loads the SAME population (and the same capability gate context) as
    // dispatch, then applies the provenance + capability gates before a partner can back a slot.
    const q = m.slice(m.indexOf("async qualifiedProvidersForService("), m.indexOf("private async loadCandidates("));
    expect(q).toContain("this.candidatePopulation(customerId),");
    expect(q).toContain("this.loadCandidates(serviceId, { population, gate, matchTokens, only })");
    expect(q).toContain("isBusinessRow(p.user.dataOrigin) === gate.bookingIsBusiness");
    // Phase 11: the providerId branch (a customer-chosen partner) goes through the SAME call.
    expect(read("src/services/service-availability.service.ts")).toContain(
      "matchingService.qualifiedProvidersForService(serviceId, customerId, providerId ? [providerId] : undefined)",
    );
  });

  test("direct selection: a customer naming a partner by id meets the same gates", () => {
    const v = read("src/services/booking-validation.service.ts");
    expect(v).toContain("isBusinessRow(customer.dataOrigin) !== isBusinessRow(provider.user.dataOrigin)");
    // …and the two hard gates it used to skip that matching applies.
    expect(v).toContain("if (provider.complianceRestricted) {");
    expect(v).toContain("provider.lifecycleState !== DISPATCH_LIFECYCLE_WHERE.lifecycleState");
  });

  test("admin reassign: population enforced, and NOT covered by the emergency override", () => {
    const a = read("src/services/admin-booking-operations.service.ts");
    expect(a).toContain('throw new Error("REASSIGN_BLOCKED:POPULATION_MISMATCH");');
    const guard = a.indexOf('throw new Error("REASSIGN_BLOCKED:POPULATION_MISMATCH");');
    const override = a.indexOf("emergencyOverride != null &&");
    // The population check runs before, and outside, the override branch.
    expect(guard).toBeLessThan(override);
  });
});

describe("a partner's metrics are computed over its own population", () => {
  test("rating aggregation filters ratings by the partner's population", () => {
    const r = read("src/services/rating.service.ts");
    expect(r).toContain('...analyticsWhereVia("rating", population)');
    expect((r.match(/analyticsWhereVia\("rating", population\)/g) ?? []).length).toBe(2);
  });

  test("completion/response evidence counts only same-population bookings", () => {
    const m = read("src/services/matching.service.ts");
    expect(m).toContain('analyticsSqlPredicate("cu")');
    expect(m).toContain('analyticsSqlPredicate("pu")');
    expect(m).toContain("AND ${sameWorld}");
  });
});
