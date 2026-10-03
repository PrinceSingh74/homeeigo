/**
 * A liability adjustment cannot be posted without a stated reason.
 *
 * `reconcile()` used to default to posting (`opts.postAdjustments !== false`) and the
 * `reconcile:ledger` CLI passed it unconditionally with no reason, so detecting a mismatch and
 * silencing it with an ADJUSTMENT were the same command. The live database carries a ₹32 wallet
 * drift that has been attributed to two specific historical errors; one run of that script would
 * have plugged it and erased the evidence.
 *
 * The refusals below run before any database access — the guard is the first statement in
 * `reconcile` — so they prove nothing was written by construction, not by cleanup.
 *
 * The acceptance case writes to `homigo_test` and nets to zero: +₹1 then −₹1 on CUSTOMER_WALLET,
 * each with the reason, so no other suite sees a changed balance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import prisma from "../lib/prisma";
import {
  ledgerReconciliationService,
  MIN_ADJUSTMENT_REASON_LENGTH,
} from "../services/ledger-reconciliation.service";
import { financialLedgerService } from "../services/financial-ledger.service";

describe("reconcile — posting requires a reason", () => {
  it("refuses to post with no reason", async () => {
    await expect(ledgerReconciliationService.reconcile({ postAdjustments: true })).rejects.toThrow(
      "ADJUSTMENT_REASON_REQUIRED",
    );
  });

  it("refuses a token reason", async () => {
    await expect(
      ledgerReconciliationService.reconcile({ postAdjustments: true, adjustmentReason: "fix" }),
    ).rejects.toThrow("ADJUSTMENT_REASON_REQUIRED");
    await expect(
      ledgerReconciliationService.reconcile({
        postAdjustments: true,
        adjustmentReason: " ".repeat(MIN_ADJUSTMENT_REASON_LENGTH + 5),
      }),
    ).rejects.toThrow("ADJUSTMENT_REASON_REQUIRED");
  });

  it("does not post by default", () => {
    // Structural: the default must be the non-mutating direction. Asserting it on source rather
    // than by running a reconcile keeps this test from depending on whatever drift the test DB has.
    const src = readFileSync(
      join(import.meta.dir, "..", "services", "ledger-reconciliation.service.ts"),
      "utf8",
    );
    // Comments stripped first: the service's own doc comment quotes the old expression to explain
    // why it was wrong, and this assertion matched that prose on its first run.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("const post = opts.postAdjustments === true;");
    expect(code).not.toContain("opts.postAdjustments !== false");
  });
});

describe("recordLiabilityReconciliation — the reason is kept", () => {
  it("writes the reason into the journal description", async () => {
    const run = `adjreason-${Date.now().toString(36)}`;
    const reason = "test: pair of offsetting entries proving the reason is persisted";

    const up = await financialLedgerService.recordLiabilityReconciliation(
      "CUSTOMER_WALLET",
      1,
      `${run}:up`,
      reason,
    );
    const down = await financialLedgerService.recordLiabilityReconciliation(
      "CUSTOMER_WALLET",
      -1,
      `${run}:down`,
      reason,
    );
    expect(up).toBe(true);
    expect(down).toBe(true);

    const entries = await prisma.journalEntry.findMany({
      where: { idempotencyKey: { in: [`${run}:up`, `${run}:down`] } },
      select: { description: true, type: true },
    });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.type).toBe("ADJUSTMENT");
      expect(e.description).toContain(reason);
    }
  });
});
