import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Re-audit, 2026-10-06: the refund policy page printed its own cancellation tiers (12 hours free,
 * 25 %, 50 %, up to 100 %) while the server charged by different ones. A published policy that
 * disagrees with what is charged is worse than none.
 */
const src = (...p: string[]) => readFileSync(join(import.meta.dir, "..", "..", "src", ...p), "utf8");

describe("the refund policy page states the tiers the server applies", () => {
  test("no tier table is written into the legal data", () => {
    const data = src("lib", "legal", "legal-data.ts");
    expect(data).not.toContain("REFUND_TIERS");
    expect(data).not.toMatch(/More than 12 hours before slot/);
  });

  test("the page renders the server's policy through the same reader as the booking page", () => {
    const table = src("components", "legal", "RefundTierTable.tsx");
    expect(table).toContain("useCancellationPolicyQuery");
    expect(table).toContain("cancellationPolicyView");
    expect(src("components", "legal", "RefundPolicy.tsx")).toContain('from "@/components/legal/RefundTierTable"');
  });

  test("with no answer from the server it names no window and no percentage", () => {
    const table = src("components", "legal", "RefundTierTable.tsx");
    const fallback = table.slice(table.indexOf("rows.length === 0"), table.indexOf("return (", table.indexOf("rows.length === 0") + 200) + 400);
    expect(fallback).not.toMatch(/\d+\s?%|\d+\s?hours?/);
  });
});
