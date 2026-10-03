/**
 * Provenance classification, tested against the REAL reason strings in `homigo_db`.
 *
 * Every string below was read from the live database on 2026-09-21 with its row count, so this is
 * not a synthetic fixture of what markers might look like — it is the actual population the backfill
 * will run over. 339 refunds across 18 distinct reasons, of which two read as genuine business
 * events.
 *
 * The two properties that matter most are the ones a classifier gets wrong in opposite directions:
 *
 *   - a REAL row must never be labelled synthetic (it would vanish from business analytics);
 *   - an unrecognised row must never be labelled REAL (it would launder unknown data as business).
 *
 * Both are asserted explicitly.
 */
import { describe, expect, it } from "bun:test";
import {
  ALL_RULES,
  classifyBookingFromRefunds,
  SAME_RUN_WINDOW_MS,
  classifyRefundReason,
  classifyUserEmail,
  isMarketplaceSeedAccount,
  type Classification,
  classifyBookingNumber,
} from "../lib/data-provenance";
import { analyticsSqlPredicate, analyticsWhere, isBusinessRow, NON_BUSINESS_ORIGINS } from "../lib/analytics-scope";

const T0 = new Date("2026-08-01T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
/** Account, booking and refund minutes apart: one harness made all three. */
const SAME_RUN = { accountCreatedAt: T0, bookingCreatedAt: at(60_000), firstRefundAt: at(120_000) };
/** Established account, booking, then a certification refund three weeks later. */
const LATER_REFUND = { accountCreatedAt: T0, bookingCreatedAt: at(60_000), firstRefundAt: at(21 * 86_400_000) };
/** Account a month older than a booking that was refunded straight away. */
const OLD_ACCOUNT = { accountCreatedAt: at(-30 * 86_400_000), bookingCreatedAt: T0, firstRefundAt: at(60_000) };
void SAME_RUN_WINDOW_MS;

/** [reason, live row count, expected origin or null for UNKNOWN] */
const LIVE_REASONS: Array<[string, number, string | null]> = [
  ["f2 cert", 204, "INFERRED_CERTIFICATION"],
  ["f2 identity", 68, "INFERRED_CERTIFICATION"],
  ["E2E cleanup", 33, "INFERRED_TEST"],
  ["Cancelled by partner", 8, null],
  ["independent audit", 5, "INFERRED_CERTIFICATION"],
  ["f2 cert reconcile", 4, "INFERRED_CERTIFICATION"],
  ["f2 ai path", 3, "INFERRED_CERTIFICATION"],
  ["phase-5a certification", 3, "INFERRED_CERTIFICATION"],
  ["Cancelled by partner — unable to complete", 2, null],
  ["cleanup", 1, "INFERRED_TEST"],
  ["Created accidentally during automated UI verification", 1, "INFERRED_TEST"],
  ["gateway rejection", 1, "INFERRED_SYNTHETIC"],
  ["E2E wallet refund test", 1, "INFERRED_TEST"],
  ["gateway timeout", 1, "INFERRED_SYNTHETIC"],
  ["e2e cleanup", 1, "INFERRED_TEST"],
  ["adv rbac test", 1, "INFERRED_CERTIFICATION"],
  ["t07 race", 1, "INFERRED_CERTIFICATION"],
  ["E2E gateway refund test", 1, "INFERRED_TEST"],
];

describe("provenance — classification of the live refund population", () => {
  it.each(LIVE_REASONS)("classifies %p (%i rows)", (reason, _count, expected) => {
    const got = classifyRefundReason(reason as string);
    expect(got?.origin ?? null).toBe(expected as never);
  });

  it("leaves the two genuine business reasons UNKNOWN rather than guessing REAL", () => {
    // UNKNOWN is counted as business by the analytics policy, so a real refund is not lost —
    // but the classifier never claims to know it is real.
    for (const r of ["Cancelled by partner", "Cancelled by partner — unable to complete"]) {
      expect(classifyRefundReason(r)).toBeNull();
      expect(isBusinessRow(null)).toBe(true);
    }
  });

  it("never emits a declared origin — only INFERRED_*", () => {
    for (const [reason] of LIVE_REASONS) {
      const c = classifyRefundReason(reason as string);
      if (c) expect(c.origin.startsWith("INFERRED_")).toBe(true);
    }
    for (const rule of ALL_RULES) expect(rule.origin.startsWith("INFERRED_")).toBe(true);
  });

  it("classifies 329 of 339 live refunds, leaving the 10 partner-cancellation rows unknown", () => {
    let classified = 0;
    let unknown = 0;
    for (const [reason, count] of LIVE_REASONS) {
      if (classifyRefundReason(reason as string)) classified += count as number;
      else unknown += count as number;
    }
    expect(classified + unknown).toBe(339);
    expect(classified).toBe(329);
    expect(unknown).toBe(10);
  });

  it("carries reproducible evidence on every classification", () => {
    const c = classifyRefundReason("f2 cert");
    expect(c).not.toBeNull();
    expect(c!.ruleId).toBe("refund.cert.f2");
    expect(c!.evidence.toLowerCase()).toContain("f2 cert");
    expect(c!.because.length).toBeGreaterThan(10);
  });

  it("does not classify prose that merely contains a suite-ish word", () => {
    // "test" inside ordinary prose is not evidence. Over-matching here would delete real customers
    // from every business report.
    expect(classifyRefundReason("Customer said the plumber did a test flush and it leaked")).toBeNull();
    expect(classifyRefundReason("Partner cleanup of the site was incomplete")).toBeNull();
  });
});

describe("provenance — users", () => {
  it("classifies reserved domains that cannot be real mailboxes", () => {
    expect(classifyUserEmail("someone@example.com")?.origin).toBe("INFERRED_SYNTHETIC");
    expect(classifyUserEmail("qa@homigo.test")?.origin).toBe("INFERRED_SYNTHETIC");
  });

  it("classifies plus-tagged suite addresses", () => {
    expect(classifyUserEmail("real.person+e2e@gmail.com")?.origin).toBe("INFERRED_TEST");
  });

  it("does NOT classify the placeholder address the app itself gives phone-OTP customers", () => {
    // routes/auth.ts creates `p<hash>@phone.homeeigo.invalid` for every real phone sign-up. `.invalid`
    // is RFC 2606 reserved, so without the exemption these genuine customers were labelled synthetic.
    // The exact shape the app generates, not a lookalike:
    expect(classifyUserEmail("p0123456789abcdef0123@phone.homeeigo.invalid")).toBeNull();
    expect(classifyUserEmail("P0123456789ABCDEF0123@PHONE.HOMEEIGO.INVALID")).toBeNull();
    // ...and the exemption is exactly that domain, not the whole TLD.
    expect(classifyUserEmail("x@something-else.invalid")?.origin).toBe("INFERRED_SYNTHETIC");
  });

  it("classifies the domain the application's own seed scripts hard-code", () => {
    // scripts/ensure-demo-users.ts, section03-seed-live-job.ts and section05-live-cert.ts create
    // accounts on homigo.demo; the domain is also undelegated. The rule is that exact domain.
    expect(classifyUserEmail("partner@homigo.demo")?.ruleId).toBe("user.seed-domain");
    expect(isMarketplaceSeedAccount("partner@homigo.demo")).toBe(true);
    expect(isMarketplaceSeedAccount("vendor@adv.test")).toBe(false);
    expect(classifyUserEmail("live-customer-s03live-x@HOMIGO.DEMO")?.origin).toBe("INFERRED_SYNTHETIC");
    // ...not every ".demo", and not a mailbox that merely mentions the word.
    expect(classifyUserEmail("someone@acme.demo")).toBeNull();
    expect(classifyUserEmail("demo.person@gmail.com")).toBeNull();
  });
  it("does NOT classify a real address that merely contains a suite word", () => {
    // Real people have these addresses. Mislabelling one removes a customer from every report.
    expect(classifyUserEmail("testa.rossi@gmail.com")).toBeNull();
    expect(classifyUserEmail("certainly@gmail.com")).toBeNull();
    expect(classifyUserEmail("seedhi.baat@gmail.com")).toBeNull();
  });
});

describe("provenance — booking number", () => {
  it("labels a number the generator could not have minted as INFERRED_TEST, with the prefix as evidence", () => {
    const c = classifyBookingNumber("S03L-s03live-mtbhd0x5");
    expect(c?.origin).toBe("INFERRED_TEST");
    expect(c?.ruleId).toBe("booking.non-canonical-number");
    expect(c?.evidence).toBe("S03L");
  });

  it("says nothing about a canonical number — that is not evidence either way", () => {
    expect(classifyBookingNumber("HOMIGO-20260916-00003")).toBeNull();
    expect(classifyBookingNumber(null)).toBeNull();
  });

  it("is the format, not a prefix list: a new script's prefix is caught without a code change", () => {
    expect(classifyBookingNumber("ZZZ9-whatever")?.origin).toBe("INFERRED_TEST");
    expect(classifyBookingNumber("HOMIGO-2026091-00003")?.origin).toBe("INFERRED_TEST");
  });
});
describe("provenance — booking inheritance", () => {
  const cert: Classification = { origin: "INFERRED_CERTIFICATION", ruleId: "refund.cert.f2", because: "x", evidence: "f2 cert" };
  const test: Classification = { origin: "INFERRED_TEST", ruleId: "refund.test.e2e", because: "x", evidence: "e2e" };

  it("inherits the strongest claim when a booking has several classified refunds", () => {
    expect(classifyBookingFromRefunds([test, cert], SAME_RUN)?.origin).toBe("INFERRED_CERTIFICATION");
  });

  it("stays UNKNOWN when no refund on the booking is classified", () => {
    expect(classifyBookingFromRefunds([], SAME_RUN)).toBeNull();
  });

  it("does NOT inherit when the refund came long after the booking", () => {
    // The shape of 46 of the 100 bookings the original rule would have relabelled: an established
    // account, a booking, and a certification refund raised against it weeks later. The refund was a
    // test; nothing says the booking was.
    expect(classifyBookingFromRefunds([cert], LATER_REFUND)).toBeNull();
  });

  it("does NOT inherit when the account long predates the booking", () => {
    expect(classifyBookingFromRefunds([cert], OLD_ACCOUNT)).toBeNull();
  });

  it("records what it inherited from", () => {
    expect(classifyBookingFromRefunds([cert], SAME_RUN)?.ruleId).toBe("booking.inherit:refund.cert.f2");
  });
});

describe("analytics scope — one policy, stated once", () => {
  it("counts REAL and UNKNOWN as business", () => {
    expect(isBusinessRow(null)).toBe(true);
    expect(isBusinessRow("REAL")).toBe(true);
  });

  it("excludes every synthetic origin, declared or inferred", () => {
    for (const o of NON_BUSINESS_ORIGINS) expect(isBusinessRow(o)).toBe(false);
  });

  it("treats an inferred origin exactly as its declared counterpart", () => {
    expect(isBusinessRow("CERTIFICATION")).toBe(isBusinessRow("INFERRED_CERTIFICATION"));
    expect(isBusinessRow("TEST")).toBe(isBusinessRow("INFERRED_TEST"));
  });

  it("keeps the Prisma filter and the SQL predicate in agreement", () => {
    expect(analyticsWhere("BUSINESS")).toEqual({ OR: [{ dataOrigin: null }, { dataOrigin: "REAL" }] });
    expect(analyticsSqlPredicate("r")).toBe("(r.data_origin IS NULL OR r.data_origin = 'REAL')");
    expect(analyticsSqlPredicate("r", "NON_BUSINESS")).toBe("(r.data_origin IS NOT NULL AND r.data_origin <> 'REAL')");
  });

  it("requires ALL to be asked for by name, so it is never the accidental default", () => {
    expect(analyticsWhere()).not.toEqual({});
    expect(analyticsWhere("ALL")).toEqual({});
  });
});
