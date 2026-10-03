/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number; with no masked-call relay the backend withholds direct calls and the partner uses the job chat.
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER_CALL_AVAILABLE, CUSTOMER_CALL_UNAVAILABLE_NOTE, customerCallLabel } from "@/lib/customer-call";

describe("X-28 partner → customer calling", () => {
  test("is unavailable and points at chat; the label shows only the masked number", () => {
    expect(CUSTOMER_CALL_AVAILABLE).toBe(false);
    expect(CUSTOMER_CALL_UNAVAILABLE_NOTE).toMatch(/chat/i);
    expect(customerCallLabel("+91 •••• 3210")).toBe("Call +91 •••• 3210 · unavailable");
  });
  test("the call button never dials a number returned by the API", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "components", "requests", "CallCustomerButton.tsx"), "utf8");
    expect(src).not.toMatch(/initiateCall\(/);
    expect(src).not.toMatch(/dialUri/);
  });
});
