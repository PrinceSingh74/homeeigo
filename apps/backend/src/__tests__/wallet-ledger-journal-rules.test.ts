/**
 * Pins the two journal rules whose violation produced the CUSTOMER_WALLET residual.
 *
 * On 2026-09-21 the account was ₹32 from its operational counterpart. That ₹32 was the residual of
 * two much larger errors that nearly cancelled:
 *
 *   +₹1,362  journals exceeding transactions
 *              +₹1,000  a WALLET_TOPUP journal (JE-00001323) referencing a wallet_transaction that
 *                       does not exist
 *              +₹552    four H-Coin redemptions journaled TWICE — once as `hcoin_redeemed:` and
 *                       again as `wallet_topup:`
 *              +₹10     the earliest redemption journal, with no wallet_transaction
 *              −₹200    a booking tip debited in the ledger with no wallet_transaction
 *   −₹1,394  reconciliation plugs under-representing seeded balances
 *
 * Posting a ₹32 adjustment would have "fixed" the number and concealed ₹2,756 of gross error. That
 * is the whole argument for these tests: a per-journal debit-equals-credit check cannot see either
 * fault, because both faults balance perfectly on their own.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HCOIN = readFileSync(join(import.meta.dir, "..", "services", "hcoin.service.ts"), "utf8");
const BACKFILL = readFileSync(join(import.meta.dir, "..", "services", "ledger-backfill.service.ts"), "utf8");
const DIAGNOSE = readFileSync(
  join(import.meta.dir, "..", "..", "scripts", "diagnose-wallet-liability.ts"),
  "utf8",
);

/**
 * Comments are stripped before any assertion about what the code CALLS.
 *
 * The removal of the duplicate credit is documented in a comment that necessarily names
 * `recordWalletTopUpInTransaction` to explain what was removed and why. Asserting against raw
 * source therefore fails on the very comment that records the fix — and the obvious "fix" would be
 * to delete the explanation. Strip comments instead, so the test reads calls and nothing else.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The redemption path, from its transaction opener to the end of the method, code only. */
function redemptionBody(): string {
  const code = stripComments(HCOIN);
  const start = code.indexOf("HCOIN_LIABILITY");
  expect(start).toBeGreaterThan(-1);
  return code.slice(Math.max(0, start - 2000), start + 2000);
}

describe("wallet ledger journal rules", () => {
  it("journals an H-Coin redemption exactly once, never also as a wallet top-up", () => {
    // Redeeming coins moves an existing liability; no money arrives from a bank. A second
    // `recordWalletTopUpInTransaction` credited CUSTOMER_WALLET again and debited BANK_SETTLEMENT
    // as though it had.
    expect(redemptionBody()).not.toContain("recordWalletTopUpInTransaction");
  });

  it("keeps the redemption journal as the single HCOIN_LIABILITY -> CUSTOMER_WALLET entry", () => {
    const body = redemptionBody();
    expect(body).toContain('accountCode: "HCOIN_LIABILITY"');
    expect(body).toContain('accountCode: "CUSTOMER_WALLET"');
  });

  it("excludes redemptions from top-up backfill, so the backfill cannot recreate the duplicate", () => {
    // The backfill's own reconstruction must agree with the runtime: only gateway top-ups.
    expect(BACKFILL).toMatch(/referenceType:\s*"razorpay_order"/);
  });

  it("detects journals that reference a wallet_transaction which does not exist", () => {
    expect(DIAGNOSE).toContain("NOT EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.id = je.reference_id)");
  });

  it("detects one redemption carrying both a redemption and a top-up journal", () => {
    expect(DIAGNOSE).toContain("wallet_topup:' || wt.id");
    expect(DIAGNOSE).toMatch(/DUPLICATE/);
  });
});
