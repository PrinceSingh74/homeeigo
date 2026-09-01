import { test, expect } from "@playwright/test";
import { hasAnyResourcePermission } from "../src/hooks/use-admin-permissions";
import { HQ_SECTIONS } from "../src/lib/hq-navigation";

/**
 * P1-4 — admin nav-section visibility gating.
 *
 * No unit-test runner is configured for this app (only Playwright e2e), and this filtering logic
 * is pure and side-effect-free, so it's tested directly via Playwright's `test()` without a
 * browser page — real logic, real data, no mocking needed. The permission sets below are the
 * ACTUAL `DEFAULT_ROLES` grants from `backend/src/services/rbac.service.ts` (FINANCE_ADMIN,
 * OPERATIONS_ADMIN, SUPPORT_ADMIN, MARKETING_ADMIN, ANALYTICS_ADMIN), verified against that file
 * during the P1-8/P1-4 investigation — not invented for this test.
 */

const FINANCE_ADMIN = ["PAYMENTS:READ", "PAYMENTS:UPDATE", "PAYMENTS:APPROVE", "PAYMENTS:REJECT", "PAYMENTS:EXPORT", "WALLET:READ", "WALLET:UPDATE", "ANALYTICS:READ", "AUDIT_LOGS:READ"];
const OPERATIONS_ADMIN = ["BOOKINGS:READ", "BOOKINGS:UPDATE", "BOOKINGS:APPROVE", "DISPUTES:READ", "DISPUTES:APPROVE", "DISPUTES:UPDATE", "USERS:READ", "USERS:UPDATE"];
const SUPPORT_ADMIN = ["USERS:READ", "BOOKINGS:READ", "DISPUTES:READ", "DISPUTES:UPDATE", "DISPUTES:APPROVE", "USERS:FORCE_LOGOUT"];
const MARKETING_ADMIN = ["CAMPAIGNS:CREATE", "CAMPAIGNS:READ", "CAMPAIGNS:UPDATE", "GIFT_CARDS:CREATE", "GIFT_CARDS:READ", "MEMBERSHIPS:READ", "MEMBERSHIPS:UPDATE", "ANALYTICS:READ"];
const ANALYTICS_ADMIN = ["ANALYTICS:READ", "ANALYTICS:EXPORT", "AUDIT_LOGS:READ"];
const SUPER_ADMIN = ["*"];

function visibleSectionIds(permissions: readonly string[]): string[] {
  return HQ_SECTIONS.filter((s) => !s.requiredAnyResource || hasAnyResourcePermission(permissions, s.requiredAnyResource)).map((s) => s.id);
}

test.describe("HQ nav completeness (P2-1) — built pages must be reachable", () => {
  const allHrefs = HQ_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

  test("previously-orphaned pages are now in the nav", () => {
    // Both pages were fully built but reachable only by typing the URL.
    expect(allHrefs).toContain("/vision");
    expect(allHrefs).toContain("/observability/logs");
    expect(allHrefs).toContain("/audit");
    expect(allHrefs).toContain("/availability");
    expect(allHrefs).toContain("/incentives");
  });

  test("they live in the correct HQ sections", () => {
    const ai = HQ_SECTIONS.find((s) => s.id === "ai")!;
    const monitoring = HQ_SECTIONS.find((s) => s.id === "monitoring")!;
    const audit = HQ_SECTIONS.find((s) => s.id === "audit")!;
    expect(ai.items.map((i) => i.href)).toContain("/vision");
    expect(monitoring.items.map((i) => i.href)).toContain("/observability/logs");
    expect(audit.items.map((i) => i.href)).toContain("/audit");
  });

  test("no href is registered in more than one section", () => {
    // `/finance/reports` was listed under both Finance HQ and Platform HQ, which made
    // resolveHqSection ambiguous and lit up two sidebar entries for a single page.
    const seen = new Map<string, string[]>();
    for (const section of HQ_SECTIONS) {
      for (const item of section.items) {
        seen.set(item.href, [...(seen.get(item.href) ?? []), section.id]);
      }
    }
    const duplicated = [...seen.entries()].filter(([, sections]) => sections.length > 1);
    expect(duplicated, `duplicated nav hrefs: ${JSON.stringify(duplicated)}`).toEqual([]);
  });

  test("every nav href is unique and non-empty", () => {
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
    for (const href of allHrefs) expect(href.startsWith("/")).toBe(true);
  });
});

test.describe("HQ nav permission gating (P1-4)", () => {
  test("exactly 4 of 13 sections are gated at all — the rest are always visible", () => {
    const gated = HQ_SECTIONS.filter((s) => s.requiredAnyResource);
    expect(gated.map((s) => s.id).sort()).toEqual(["audit", "finance", "growth", "risk"]);
    expect(HQ_SECTIONS.length).toBe(13);
  });

  test("SUPER_ADMIN sees all 13 sections (wildcard sentinel)", () => {
    expect(visibleSectionIds(SUPER_ADMIN)).toHaveLength(13);
  });

  test("FINANCE_ADMIN sees Finance HQ but not Risk or Growth HQ", () => {
    const visible = visibleSectionIds(FINANCE_ADMIN);
    expect(visible).toContain("finance");
    expect(visible).not.toContain("risk");
    expect(visible).not.toContain("growth");
    expect(visible).toContain("executive");
    expect(visible).toContain("operations");
    expect(visible).toContain("marketplace");
    expect(visible).toContain("acquisition");
    expect(visible).toContain("ai");
    expect(visible).toContain("monitoring");
    expect(visible).toContain("platform");
    expect(visible).toContain("audit");
  });

  test("OPERATIONS_ADMIN sees Risk HQ (holds DISPUTES) but not Finance, Growth, or Audit HQ", () => {
    const visible = visibleSectionIds(OPERATIONS_ADMIN);
    expect(visible).toContain("risk");
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("growth");
    expect(visible).not.toContain("audit");
  });

  test("SUPPORT_ADMIN sees Risk HQ (holds DISPUTES) but not Finance or Growth HQ", () => {
    const visible = visibleSectionIds(SUPPORT_ADMIN);
    expect(visible).toContain("risk");
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("growth");
    // Platform HQ (Support lives there) must stay visible — it is deliberately ungated because
    // gating it on SETTINGS/ADMIN_USERS (which SUPPORT_ADMIN doesn't hold) would hide the one
    // page this role actually needs.
    expect(visible).toContain("platform");
  });

  test("MARKETING_ADMIN sees Growth HQ but not Finance or Risk HQ", () => {
    const visible = visibleSectionIds(MARKETING_ADMIN);
    expect(visible).toContain("growth");
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("risk");
  });

  test("ANALYTICS_ADMIN sees Audit HQ (AUDIT_LOGS) but none of Finance/Risk/Growth", () => {
    const visible = visibleSectionIds(ANALYTICS_ADMIN);
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("risk");
    expect(visible).not.toContain("growth");
    expect(visible).toContain("audit");
    expect(visible).toContain("executive");
  });

  test("a genuinely empty permission set hides all 4 gated sections", () => {
    const visible = visibleSectionIds([]);
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("risk");
    expect(visible).not.toContain("growth");
    expect(visible).not.toContain("audit");
    expect(visible).toHaveLength(9);
  });
});
