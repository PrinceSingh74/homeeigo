/**
 * P3-8 — regressions for the partner-incentive payout audit path.
 *
 * Two findings, one from the typecheck error and one from tracing the path it sits on.
 *
 * 1. TS2345: `"PARTNER_INCENTIVE_CREDITED"` was not in the `SecurityEvent` union. This was NOT an
 *    invented value — the live database already holds an audit row with that exact action, written
 *    by the shipped payout path. The union was stale, which meant `AuditLogService.listByAction`
 *    (typed `SecurityEvent`) could not be used to query an event the system was actively writing.
 *
 * 2. Tracing payout → security event → retention exposed a REAL defect: money-movement events were
 *    being classified SYSTEM_LOGS (365-day retention) instead of FINANCIAL_LEDGER (10-year).
 *    `includes("HCoin")` was case-sensitive and could never match the upper-case `HCOIN_*` names,
 *    and only the debit side carried a keyword — so `WALLET_DEBIT` was kept for a decade while the
 *    credits that funded it were dropped after a year.
 *
 * The classifier is pure, so none of this touches the database or moves money.
 */
import { describe, test, expect } from "bun:test";
import { securityEventRetention } from "../services/enterprise-audit.service";
import type { SecurityEvent } from "../services/audit-log.service";
import type { RetentionCategory } from "@prisma/client";

/** Compile-level guard for finding 1: fails the CI typecheck if the member is dropped again. */
const INCENTIVE_EVENT: SecurityEvent = "PARTNER_INCENTIVE_CREDITED";

describe("P3-8 — the incentive credit event is a first-class SecurityEvent", () => {
  test("the event the payout path already writes is part of the union", () => {
    expect(INCENTIVE_EVENT).toBe("PARTNER_INCENTIVE_CREDITED");
  });
});

describe("P3-8 — money-movement events get financial retention", () => {
  /** Every event in the union that records value moving into or out of an account. */
  const MONEY_EVENTS: SecurityEvent[] = [
    "PARTNER_INCENTIVE_CREDITED",
    "PARTNER_REFERRAL_REWARD_CREDITED",
    "REFERRAL_COMMISSION_CREDITED",
    "HCOIN_EARNED",
    "HCOIN_REDEEMED",
    "HCOIN_ADJUSTED",
    "HCOIN_EXPIRED",
    "WALLET_DEBIT",
    "WALLET_TRANSFER",
    "FINANCIAL_ADJUSTMENT_EXECUTED",
    "FINANCIAL_ADJUSTMENT_CREATED",
    "LEDGER_BACKFILL_RUN",
  ];

  test.each(MONEY_EVENTS)("%s is never retained as a system log", (event) => {
    // SYSTEM_LOGS is 365 days and archives at 90 — far too short for a financial record.
    expect(securityEventRetention(event)).not.toBe("SYSTEM_LOGS");
  });

  test("both halves of a ledger movement are retained identically", () => {
    // The original asymmetry: the debit was FINANCIAL_LEDGER, the credits were SYSTEM_LOGS.
    const debit = securityEventRetention("WALLET_DEBIT");
    expect(securityEventRetention("PARTNER_INCENTIVE_CREDITED")).toBe(debit);
    expect(securityEventRetention("REFERRAL_COMMISSION_CREDITED")).toBe(debit);
  });

  test("classification does not depend on letter case", () => {
    // The bug was literally `includes("HCoin")` against `HCOIN_EARNED`.
    expect(securityEventRetention("HCOIN_EARNED")).toBe("FINANCIAL_LEDGER");
    expect(securityEventRetention("hcoin_earned")).toBe("FINANCIAL_LEDGER");
  });
});

describe("P3-8 — the wider fix did not over-capture", () => {
  // Typed against the real Prisma enum, so a mistyped category name fails the CI typecheck.
  const CASES: Array<[SecurityEvent, RetentionCategory]> = [
    ["LOGIN", "LOGIN_EVENTS"],
    ["LOGOUT", "LOGIN_EVENTS"],
    ["TOKEN_REFRESH", "LOGIN_EVENTS"],
    ["PAYMENT_REFUND", "PAYMENT_EVENTS"],
    ["PAYOUT_APPROVED", "PAYMENT_EVENTS"],
    ["CHARGEBACK_RECEIVED", "PAYMENT_EVENTS"],
    ["ADMIN_ACTION", "SECURITY_EVENTS"],
    ["REGISTER", "SYSTEM_LOGS"],
    ["OTP_SENT", "SYSTEM_LOGS"],
  ];

  test.each(CASES)("%s still classifies as %s", (event, expected) => {
    expect(securityEventRetention(event)).toBe(expected);
  });
});
