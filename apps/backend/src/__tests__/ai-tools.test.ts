import { describe, expect, it } from "bun:test";
import { initToolRegistry, listTools, countToolsByCategory, TOOL_CATALOG } from "../ai-tools";
import { validateToolArguments, sanitizeToolId } from "../ai-tools/security/tool-security";
import { POLICY_RULES } from "../ai-tools/policy/policy-rules";

describe("Phase 5 AI Tools", () => {
  it("loads tool catalog with expected categories", () => {
    initToolRegistry();
    const counts = countToolsByCategory();
    expect(counts.READ).toBeGreaterThanOrEqual(20);
    expect(counts.WRITE).toBeGreaterThanOrEqual(10);
    expect(counts.HIGH_RISK).toBeGreaterThanOrEqual(10);
    expect(TOOL_CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it("registers handlers for non-high-risk tools", () => {
    initToolRegistry();
    const executable = listTools().filter((t) => t.category !== "HIGH_RISK");
    const withHandlers = executable.filter((t) => t.handler);
    expect(withHandlers.length).toBe(executable.length);
  });

  it("blocks high-risk direct execution in validation", () => {
    const hr = listTools({ category: "HIGH_RISK" })[0];
    expect(hr).toBeDefined();
    const result = validateToolArguments(hr, { payload: {} });
    expect(result.valid).toBe(false);
  });

  it("sanitizes tool IDs", () => {
    expect(sanitizeToolId("read.customer.getBooking")).toBe("read.customer.getBooking");
    expect(sanitizeToolId("../../../etc/passwd")).toBeNull();
    expect(sanitizeToolId("'; DROP TABLE--")).toBeNull();
  });

  it("has policy rules including default allow", () => {
    const ids = POLICY_RULES.map((r) => r.id);
    expect(ids).toContain("rbac.role_check");
    expect(ids).toContain("high_risk.approval_required");
    expect(ids).toContain("default.allow");
  });

  it("blocks injection in tool arguments", () => {
    const tool = listTools({ category: "WRITE" })[0];
    const result = validateToolArguments(tool, {
      bookingId: "'; DROP TABLE bookings; --",
    });
    expect(result.valid).toBe(false);
  });
});
