/**
 * The authority invariants — the ones that decide who is allowed to say what a thing costs,
 * where it may be sold, and when it may be stopped.
 *
 * Each of these has a cheap wrong version that looks identical in the happy path, so every test
 * here is written to fail loudly when that wrong version is reinstated:
 *
 *   O3b  a started job cannot be cancelled by the customer alone
 *   O5   reference geography never decides sellability — commercial coverage does
 *   O6   the late-reschedule fee is CONFIGURATION_REQUIRED, and null must never read as 0
 *   O8   a price comes from the approved catalog, never from the caller
 *   §52  the two no-show enum values are actually declared, not just referenced
 *
 * Pure and structural: no database, no clock of its own.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BookingStatus } from "@prisma/client";
import {
  CANCELLATION_POLICY,
  CANCELLATION_POLICY_V1,
  cancellationPolicyService,
} from "../services/cancellation-policy.service";
import {
  coverageAllowsAddress,
  resolvePackagePrice,
  resolveServiceSelection,
} from "../lib/service-catalog-config";
import {
  LATE_FEE_BPS,
  RESCHEDULE_FREE_MIN_HOURS,
  RESCHEDULE_POLICY,
  RESCHEDULE_POLICY_VERSION,
  evaluateReschedule,
  rescheduleFeeIsChargeable,
  reschedulePolicyFromSnapshot,
} from "../lib/reschedule-policy";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

/* ── §52: the enum values exist, not merely referenced ──────────────────────────────────────── */

describe("the no-show statuses are declared, not assumed", () => {
  test("the generated client carries both values", () => {
    // A stale client is the failure this catches: the code references CUSTOMER_NO_SHOW everywhere,
    // and referencing a value that the enum does not define fails only at the database, at runtime,
    // on a real booking.
    expect(String(BookingStatus.CUSTOMER_NO_SHOW)).toBe("CUSTOMER_NO_SHOW");
    expect(String(BookingStatus.PROVIDER_NO_SHOW)).toBe("PROVIDER_NO_SHOW");
  });

  test("the migration that adds them is additive and complete", () => {
    const sql = read("prisma/migrations/20260923120000_no_show_states/migration.sql");
    expect(sql).toContain(`ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_NO_SHOW'`);
    expect(sql).toContain(`ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_NO_SHOW'`);
    // Additive only: nothing in this migration may touch a table, a row or an index.
    const body = sql.replace(/^\s*--.*$/gm, "");
    for (const forbidden of ["DROP", "TRUNCATE", "DELETE", "UPDATE ", "INSERT", "ALTER TABLE"]) {
      expect(body.toUpperCase().includes(forbidden)).toBe(false);
    }
  });

  test("the schema declares them too, or the client above is lying", () => {
    const schema = read("prisma/schema.prisma");
    const block = schema.slice(schema.indexOf("enum BookingStatus"));
    const body = block.slice(0, block.indexOf("}"));
    expect(body).toContain("CUSTOMER_NO_SHOW");
    expect(body).toContain("PROVIDER_NO_SHOW");
  });
});

/* ── O3b: a started job is not the customer's to cancel ─────────────────────────────────────── */

describe("O3b — the in-progress tier is not self-serve", () => {
  test("both policy versions mark it so", () => {
    for (const policy of [CANCELLATION_POLICY, CANCELLATION_POLICY_V1]) {
      const tier = policy.tiers.find((t) => t.id === "in_progress");
      expect(tier).toBeDefined();
      expect(tier!.selfServe).toBe(false);
    }
  });

  test("every OTHER tier stays self-serve — this did not quietly disable cancellation", () => {
    for (const tier of CANCELLATION_POLICY.tiers) {
      if (tier.id === "in_progress") continue;
      expect(tier.selfServe !== false).toBe(true);
    }
  });

  test("a quote for a started job says it cannot be acted on, while still stating the money", () => {
    const q = cancellationPolicyService.calculate({
      paidAmount: 1000,
      scheduledDate: new Date(Date.now() - 60_000),
      bookingStatus: "IN_PROGRESS",
      cancelledBy: "user",
    });
    expect(q.tier).toBe("in_progress");
    expect(q.selfServe).toBe(false);
    // The numbers are still true — a controlled stop settles at them.
    expect(q.refundAmount).toBeGreaterThan(0);
  });

  test("a quote the customer CAN act on still says so", () => {
    const q = cancellationPolicyService.calculate({
      paidAmount: 1000,
      scheduledDate: new Date(Date.now() + 5 * 3_600_000),
      bookingStatus: "ACCEPTED",
      cancelledBy: "user",
    });
    expect(q.selfServe).toBe(true);
  });

  test("the service refuses it, and the route does not fall through to success", () => {
    const service = read("src/services/booking.service.ts");
    expect(service).toContain('return { error: "SERVICE_IN_PROGRESS" as const };');
    const routes = read("src/routes/bookings.ts");
    expect(routes).toContain('code: "SERVICE_IN_PROGRESS"');
    // The fail-closed arm: without it a new error code becomes "Booking cancelled successfully".
    expect(routes).toContain('error: "This booking cannot be cancelled"');
  });
});

/* ── O5: reference geography never decides sellability ──────────────────────────────────────── */

describe("O5 — commercial coverage is the only sellability authority", () => {
  const addressInSeededCity = { city: "Mumbai", zipCode: "400001" };

  test("a city in the reference geography is NOT sellable unless commercial coverage says so", () => {
    // Mumbai exists in the hyperlocal seeds. That must buy it nothing.
    const verdict = coverageAllowsAddress({ availableCities: ["Pune"] }, null, addressInSeededCity);
    expect(verdict.ok).toBe(false);
  });

  test("a city commercial coverage names IS sellable, whatever the reference geography knows", () => {
    const verdict = coverageAllowsAddress(
      { availableCities: ["Nowhere-On-Sea"] },
      null,
      { city: "Nowhere-On-Sea", zipCode: "999999" },
    );
    // Reference geography has never heard of it; it must not get a veto.
    expect(verdict.ok).toBe(true);
  });

  test("an empty commercial coverage means unrestricted, not 'ask the seeds'", () => {
    expect(coverageAllowsAddress({ availableCities: [] }, null, addressInSeededCity).ok).toBe(true);
  });

  test("pincode coverage is commercial too", () => {
    const cfg = { coverage: { pincodes: ["400002"] } } as never;
    expect(coverageAllowsAddress({ availableCities: [] }, cfg, addressInSeededCity).ok).toBe(false);
    expect(
      coverageAllowsAddress({ availableCities: [] }, cfg, { city: "Mumbai", zipCode: "400002" }).ok,
    ).toBe(true);
  });

  test("no sellability path imports the reference-geography module", () => {
    // The structural half. `hyperlocal-coverage` is presentation and planning data; the day a
    // sellability module imports it, two sources of truth exist and the cheaper one usually wins.
    for (const rel of [
      "src/lib/service-catalog-config.ts",
      "src/services/booking-validation.service.ts",
      "src/services/booking-pricing.service.ts",
      "src/services/booking.service.ts",
    ]) {
      expect(read(rel).includes("hyperlocal-coverage"), `${rel} imports the reference geography`).toBe(false);
    }
  });
});

/* ── O6: the late-reschedule fee — a real number, computed once, capped twice ───────────────── */

describe("O6 — the late-reschedule fee", () => {
  /**
   * `now` is pinned. Building the date from `Date.now()` and letting the function read its own
   * clock puts a few milliseconds between them, so "exactly two hours" arrives as 1.9999h and the
   * test measures scheduling jitter instead of the inclusive boundary it means to pin.
   */
  const NOW = new Date("2026-12-24T06:00:00.000Z");
  const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
  const late = (over: Partial<Parameters<typeof evaluateReschedule>[0]> = {}) =>
    evaluateReschedule({
      scheduledDate: inHours(1),
      bookingStatus: "ACCEPTED",
      subtotal: 1000,
      capturedAmount: 1000,
      now: NOW,
      ...over,
    });

  test("the policy carries the owner's number once, in basis points", () => {
    expect(RESCHEDULE_POLICY).toMatchObject({
      version: RESCHEDULE_POLICY_VERSION,
      freeMinHours: RESCHEDULE_FREE_MIN_HOURS,
      lateFeeBps: LATE_FEE_BPS,
    });
    expect(LATE_FEE_BPS).toBe(2_500); // 25%
  });

  test("two hours or more out is free, at the boundary itself", () => {
    const at = evaluateReschedule({
      scheduledDate: inHours(RESCHEDULE_FREE_MIN_HOURS),
      bookingStatus: "ACCEPTED",
      subtotal: 1000,
      capturedAmount: 1000,
      now: NOW,
    });
    expect(at.disposition).toBe("FREE");
    expect(at.feeAmountPaise).toBe(0);
    expect(at.feeBps).toBe(0);

    // One second inside the window is the other side of the same boundary.
    const inside = late({ scheduledDate: new Date(inHours(RESCHEDULE_FREE_MIN_HOURS).getTime() - 1_000) });
    expect(inside.disposition).toBe("LATE_FEE");
  });

  test("under two hours is 25% of the subtotal, in integer paise", () => {
    const d = late();
    expect(d.disposition).toBe("LATE_FEE");
    expect(d.feeBps).toBe(2_500);
    expect(d.feeAmountPaise).toBe(25_000); // 25% of 1000 rupees
    expect(Number.isInteger(d.feeAmountPaise)).toBe(true);
    expect(d.feeAmount).toBe(250);
    expect(rescheduleFeeIsChargeable(d)).toBe(true);
  });

  test("the fee never exceeds what was captured", () => {
    // 25% of 1000 is 250, but only 100 was ever taken.
    const d = late({ capturedAmount: 100 });
    expect(d.chargeableSubtotalPaise).toBe(10_000);
    expect(d.feeAmountPaise).toBe(2_500);
    expect(d.feeAmountPaise).toBeLessThanOrEqual(10_000);
  });

  test("captured nothing, owe nothing — a fee is not a debt", () => {
    const d = late({ capturedAmount: 0 });
    expect(d.disposition).toBe("LATE_FEE");
    expect(d.feeAmountPaise).toBe(0);
    expect(rescheduleFeeIsChargeable(d)).toBe(false);
    // and it says so rather than implying a charge happened
    expect(d.message.toLowerCase()).toContain("nothing has been captured");
  });

  test("the fee never exceeds the subtotal either, however much is held", () => {
    const d = late({ subtotal: 100, capturedAmount: 100_000 });
    expect(d.feeAmountPaise).toBe(2_500); // 25% of 100, not of the balance
  });

  test("no input can produce a negative fee", () => {
    for (const [subtotal, captured] of [
      [-500, 1000],
      [1000, -500],
      [-1, -1],
      [0, 0],
    ]) {
      const d = late({ subtotal: subtotal!, capturedAmount: captured! });
      expect(d.feeAmountPaise).toBeGreaterThanOrEqual(0);
      expect(d.chargeableSubtotalPaise).toBeGreaterThanOrEqual(0);
    }
  });

  test("rounding is half-up to the rupee, once — not per component", () => {
    // 25% of 333.33 = 83.3325 -> 83 rupees. The platform rounds to whole rupees everywhere.
    const d = late({ subtotal: 333.33, capturedAmount: 333.33 });
    expect(d.feeAmountPaise % 100).toBe(0);
    expect(d.feeAmount).toBe(83);
  });

  test("a started job is not a reschedule at all", () => {
    const d = late({ bookingStatus: "IN_PROGRESS" });
    expect(d.disposition).toBe("NOT_PERMITTED");
    expect(d.feeAmountPaise).toBe(0);
  });

  test("a FROZEN policy wins over the published one — history is not re-priced", () => {
    const frozen = reschedulePolicyFromSnapshot({
      policy: { reschedule: { version: "reschedule.v0", freeMinHours: 2, lateFeeBps: 1_000 } },
    });
    expect(frozen).not.toBeNull();
    const d = late({ policy: frozen });
    expect(d.version).toBe("reschedule.v0");
    expect(d.feeBps).toBe(1_000);
    expect(d.feeAmountPaise).toBe(10_000); // 10% of 1000, the terms it was sold under
  });

  test("a malformed snapshot is refused rather than half-applied", () => {
    for (const bad of [
      null,
      {},
      { policy: {} },
      { policy: { reschedule: {} } },
      { policy: { reschedule: { version: "x", freeMinHours: 2 } } },
      { policy: { reschedule: { version: "x", freeMinHours: 2, lateFeeBps: 10_001 } } },
      { policy: { reschedule: { version: "x", freeMinHours: 2, lateFeeBps: -1 } } },
      { policy: { reschedule: { version: "", freeMinHours: 2, lateFeeBps: 2500 } } },
    ]) {
      expect(reschedulePolicyFromSnapshot(bad)).toBeNull();
    }
  });

  test("booking create freezes the policy, so a later change cannot reach back", () => {
    expect(read("src/services/booking.service.ts")).toContain(
      "reschedule: RESCHEDULE_POLICY as unknown as Prisma.JsonObject,",
    );
  });

  test("the decision comes from the booking, never from the caller", () => {
    const source = read("src/services/booking.service.ts");
    // `existing.scheduledDate` is the row; `scheduled` is what the client asked for. Using the
    // latter would let a client dodge the late tier by choosing a distant new slot.
    expect(source).toContain("scheduledDate: existing.scheduledDate,");
    // and the subtotal / captured come from the row and the refund authority, not the payload
    expect(source).toContain("subtotal: existing.baseAmount,");
    expect(source).toContain("capturedAmount: capturedForFee,");
  });
});

/* ── O8: the catalog prices, not the caller ─────────────────────────────────────────────────── */

describe("O8 — a price is approved before it is charged", () => {
  const service = { basePrice: 799, minPrice: 499, maxPrice: 999 };

  test("an approved tier is accepted", () => {
    for (const tier of [499, 799, 999]) {
      const r = resolvePackagePrice(service, tier);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.price).toBe(tier);
    }
  });

  test("an arbitrary price inside the range is REFUSED — a range is not a price list", () => {
    for (const made_up of [650, 500, 998, 800]) {
      expect(resolvePackagePrice(service, made_up).ok).toBe(false);
    }
  });

  test("an arbitrary price outside the range is refused too", () => {
    expect(resolvePackagePrice(service, 1).ok).toBe(false);
    expect(resolvePackagePrice(service, 99999).ok).toBe(false);
  });

  test("asking for nothing gets the catalog's own price", () => {
    const r = resolvePackagePrice(service, undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(799);
  });

  test("the booking schema accepts add-on IDS and QUANTITIES — never add-on prices", () => {
    const schema = read("src/schemas/booking.schema.ts");
    expect(schema).toContain("addonIds");
    expect(schema).toContain("addonQuantities");
    // Any of these would be a caller naming its own price.
    for (const forbidden of ["addonPrices", "addonPrice", "unitPrice", "amountPaise:"]) {
      expect(schema.includes(forbidden), `booking schema accepts ${forbidden}`).toBe(false);
    }
  });
});

/* ── O7: the tender branch a fixture cannot reach ───────────────────────────────────────────── */

describe("O7 — wallet money is routed to the wallet, on every shape of payment row", () => {
  /**
   * The behavioural half of O7 lives in `phase09-controlled-stop.integration.test.ts`, which covers
   * the common shape: a wallet-paid booking has NO `payments` row at all, because the wallet
   * checkout writes `paymentMethod` onto the BOOKING.
   *
   * This is the other shape — a `payments` row whose own method is "wallet". `homigo_db` holds two
   * such rows, so the branch is reachable and not dead code, but no current code path produces one,
   * and hand-writing the row into a fixture would be exactly the "shape production cannot produce"
   * that `payWithRealWallet` exists to stop.
   *
   * So this assertion is structural, and says so rather than pretending to be behavioural: it holds
   * the branch in place until a fixture can reach it honestly. A reintroduction that deletes the
   * check (`const isWallet = false`) fails here.
   */
  /**
   * 2026-09-27: the branch is now reachable honestly — a booking the client labelled "wallet" and
   * then paid through the gateway produces exactly this row — and reaching it showed the old rule
   * broke O7 itself: gateway money was refunded as wallet credit. The behavioural proof is
   * `refund-tender-evidence.integration.test.ts`. What stays structural here is that the wallet
   * branch still EXISTS and is still decided by the one rule in `lib/refund-tender`, at both the
   * cancellation and the admin-refund site.
   */
  test("the payment-row wallet branch is decided by evidence, at both refund sites", () => {
    const source = read("src/services/booking-refund.service.ts");
    expect(source).toContain("const isWallet = isWalletTender(payment);");
    expect(source).toContain("if (isWalletTender(payment)) {");
    // The label alone must never decide again.
    expect(source).not.toContain('payment.paymentMethod.toLowerCase() === "wallet"');
    // and it must route to the wallet credit, not to the gateway
    const after = source.slice(source.indexOf("const isWallet ="));
    expect(after.slice(0, 400)).toContain("creditWalletRefund");

    const rule = read("src/lib/refund-tender.ts");
    expect(rule).toContain('payment.paymentMethod.toLowerCase() === "wallet" && !arrivedThroughGateway(payment)');
    // Pure on purpose: the live-closure dry run imports it and must not load a money service.
    expect(rule).not.toMatch(/^import /m);
  });

  test("the no-payment-row branch checks the booking really was wallet funded", () => {
    const source = read("src/services/booking-refund.service.ts");
    // Removing this guard is how a wallet-funded cancel once refunded zero.
    expect(source).toContain("if (!(await this.isWalletFundedBooking(opts.bookingId, opts.userId))) return { amount: 0, status: \"none\" };");
  });
});

/* ── O8: an unpriced part is refused, never guessed ─────────────────────────────────────────── */

describe("O8 — a part with no approved price stops the sale, it does not cost zero", () => {
  /**
   * The behavioural half of O8. The structural tests above prove the CALLER cannot name a price;
   * these prove the CATALOGUE cannot be silent about one. A missing add-on price resolving to ₹0 is
   * the dangerous version: the booking succeeds, the customer is charged nothing for the part, and
   * the partner is asked to supply it anyway.
   */
  const service = {
    id: "svc_1",
    basePrice: 799,
    minPrice: 499,
    maxPrice: 999,
    name: "Test service",
  } as never;

  const cfgWith = (addons: Array<Record<string, unknown>>) =>
    ({ addons: addons.map((a) => ({ active: true, ...a })) }) as never;

  test("an add-on with a real price resolves and is priced by the server", () => {
    const r = resolveServiceSelection(service, cfgWith([{ id: "deep", name: "Deep clean", price: 200 }]), {
      addonIds: ["deep"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.addons[0]!.unitPaise).toBe(20_000);
      expect(r.addonTotalPaise).toBe(20_000);
    }
  });

  test("an add-on with NO price refuses with PRICING_CONFIG_MISSING and names the part", () => {
    const r = resolveServiceSelection(service, cfgWith([{ id: "unpriced", name: "Facade rig", price: null }]), {
      addonIds: ["unpriced"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("PRICING_CONFIG_MISSING");
      // Structured enough for an admin to act on: which part, and which field.
      const issue = r.issues.find((i) => i.code === "PRICING_CONFIG_MISSING");
      expect(issue).toBeDefined();
      expect(issue!.id).toBe("unpriced");
      expect(issue!.field).toBe("addonIds");
    }
  });

  test("an add-on the catalogue has never heard of is ADDON_UNKNOWN, not priced at zero", () => {
    const r = resolveServiceSelection(service, cfgWith([{ id: "deep", name: "Deep clean", price: 200 }]), {
      addonIds: ["invented-by-the-client"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "ADDON_UNKNOWN")).toBe(true);
  });

  test("one unpriced part poisons the whole selection — no partial sale", () => {
    const r = resolveServiceSelection(
      service,
      cfgWith([
        { id: "deep", name: "Deep clean", price: 200 },
        { id: "unpriced", name: "Facade rig", price: undefined },
      ]),
      { addonIds: ["deep", "unpriced"] },
    );
    expect(r.ok).toBe(false);
    // and specifically for the pricing reason, not some unrelated validation error
    if (!r.ok) expect(r.error).toBe("PRICING_CONFIG_MISSING");
  });

  test("a nonsense price is treated as no price, not coerced", () => {
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = resolveServiceSelection(service, cfgWith([{ id: "x", name: "X", price }]), { addonIds: ["x"] });
      expect(r.ok, `price ${String(price)} was accepted`).toBe(false);
    }
  });
});
