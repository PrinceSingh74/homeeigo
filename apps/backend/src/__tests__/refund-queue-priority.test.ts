/**
 * Pins the refund console's queue ordering and its authoritative counts.
 *
 * Both defects these tests guard were real and simultaneous on 2026-09-21:
 *
 *   1. `listQueue` ordered every actionable status oldest-first behind a 100-row page. With 303
 *      actionable refunds, the page filled entirely with FAILED rows from June and July, and
 *      **none of the 53 INDETERMINATE refunds reached an operator**. INDETERMINATE is money the
 *      gateway never gave a definite answer about, so it is precisely the row a human must see.
 *
 *   2. The console's "needs retry" tile counted rows in that returned page, so it read 100 while
 *      the real figure was 303 — a tile that under-reports is worse than no tile, because it looks
 *      like an answer.
 *
 * Structural assertions against source, so they need no database and cannot skip silently.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = readFileSync(join(import.meta.dir, "..", "services", "refund-workflow.service.ts"), "utf8");
const CONSOLE_PAGE = join(
  import.meta.dir, "..", "..", "..", "admin-panel", "src", "app", "(console)", "finance", "refunds", "page.tsx",
);

describe("refund queue — priority and counts", () => {
  it("treats INDETERMINATE and PROCESSING as the urgent bucket", () => {
    const m = SERVICE.match(/URGENT_STATUSES:\s*RefundRequestStatus\[\]\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const urgent = [...m![1]!.matchAll(/RefundRequestStatus\.([A-Z_]+)/g)].map((x) => x[1]!);
    expect(urgent.sort()).toEqual(["INDETERMINATE", "PROCESSING"]);
  });

  it("draws the urgent bucket before the remaining actionable statuses", () => {
    // Urgent is queried first and the remainder only fills the leftover budget.
    expect(SERVICE).toMatch(/where:\s*\{\s*status:\s*\{\s*in:\s*RefundWorkflowService\.URGENT_STATUSES\s*\}/);
    expect(SERVICE).toMatch(/take:\s*limit\s*-\s*urgent\.length/);
    // Urgent first, remainder after — whether or not the result is then decorated. The literal
    // `return [...urgent, ...rest]` became `return this.withPayments([...urgent, ...rest])` when the
    // queue stopped including a relation that does not exist (Pass 6). The ORDER is asserted by
    // executing the method in refund-queue-executes.test.ts; this only pins that urgent leads.
    expect(SERVICE).toMatch(/\[\.\.\.urgent,\s*\.\.\.rest\]/);
  });

  it("keeps INDETERMINATE actionable so it can never drop out of the queue entirely", () => {
    const m = SERVICE.match(/ACTIONABLE_STATUSES:\s*RefundRequestStatus\[\]\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("INDETERMINATE");
  });

  it("exposes authoritative indeterminate and needsRetry counts from analytics", () => {
    // Asserted on the shape of the query, not on its exact punctuation. The original pattern
    // required the filter to END at `INDETERMINATE }})`, so adding the DQ-7 business-population
    // predicate to the same `where` broke it while the count it protects got strictly better. A
    // structural test should pin the property, not the formatting around it.
    expect(SERVICE).toMatch(/analytics\(\)/);
    expect(SERVICE).toMatch(/prisma\.refundRequest\.count\(\{[^}]*status:\s*RefundRequestStatus\.INDETERMINATE/);
    expect(SERVICE).toMatch(/needsRetry:\s*failed\s*\+\s*indeterminate/);
  });

  it("makes the console read needsRetry from analytics, not from the returned page", () => {
    const page = readFileSync(CONSOLE_PAGE, "utf8");
    expect(page).toContain("analytics.needsRetry");
    // The old derivation counted statuses inside the capped `refunds` array.
    expect(page).not.toMatch(/refunds\s*\.filter\([^)]*INDETERMINATE/);
  });
});
