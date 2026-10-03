/**
 * Pins WHICH accounts the reconciler is allowed to post adjusting entries against.
 *
 * `PLATFORM_ESCROW` used to be adjustable. It is commingled — unreleased booking escrow, gift-card
 * float and wallet-debit escrow all sit in it — while `buildReport` compared it against active
 * gift-card balance alone. Every run therefore saw a "delta" that was mostly booking escrow
 * behaving correctly, and posted an ADJUSTMENT to close it. 56 such entries moved −₹17,245:
 * ₹26,631 of real escrow was reported as ₹9,386, and the plug never converged because each new
 * booking payment re-opened the gap.
 *
 * These are pure structural assertions against the service's own source. They need no database, so
 * they run in any environment and cannot be skipped by an unavailable fixture — a test that
 * silently skips is how this regressed the first time.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = join(import.meta.dir, "..", "services", "ledger-reconciliation.service.ts");
const source = readFileSync(SERVICE, "utf8");

/** The `ADJUSTABLE` set literal, as written in the service. */
function adjustableAccounts(): string[] {
  const m = source.match(/const ADJUSTABLE = new Set\(\[([^\]]*)\]\)/);
  if (!m) throw new Error("ADJUSTABLE set not found — the reconciler was restructured; update this test deliberately.");
  return [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!);
}

describe("ledger reconciliation — adjustment scope", () => {
  it("never posts adjusting entries against the commingled escrow account", () => {
    expect(adjustableAccounts()).not.toContain("PLATFORM_ESCROW");
  });

  it("only adjusts accounts whose operational counterpart is a one-to-one invariant", () => {
    // Each of these has exactly one operational quantity it must equal:
    //   CUSTOMER_WALLET  == SUM(users.wallet_balance)
    //   PROVIDER_PAYABLE == SUM(providers.wallet_balance)
    //   HCOIN_LIABILITY  == floor((issued - redeemed - expired) * COIN_TO_RUPEE)
    expect(adjustableAccounts().sort()).toEqual(["CUSTOMER_WALLET", "HCOIN_LIABILITY", "PROVIDER_PAYABLE"]);
  });

  it("keeps the gift-card escrow row informational so it is reported but never acted on", () => {
    expect(source).toContain("Gift Card Escrow (info)");
  });

  it("computes maxDelta only from adjustable accounts", () => {
    // Folding informational rows into maxDelta pins the gauge above the alert threshold forever.
    // An alert that always fires is one nobody reads, which is worse than no alert at all.
    expect(source).toMatch(/final\s*\.filter\(\(r\) => ADJUSTABLE\.has\(r\.ledgerAccount\)\)/);
  });
});
