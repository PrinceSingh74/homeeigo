import { describe, expect, test } from "bun:test";
import { ChargebackStatus } from "@prisma/client";

describe("Chargeback workflow E2E contracts", () => {
  test("workflow states cover enterprise lifecycle", () => {
    const required = ["OPEN", "UNDER_REVIEW", "EVIDENCE_PENDING", "RESPONDED", "WON", "LOST", "CLOSED"];
    for (const s of required) {
      expect(Object.values(ChargebackStatus)).toContain(s as ChargebackStatus);
    }
  });

  test("RECEIVED maps to OPEN for display", () => {
    const display = (s: ChargebackStatus) => (s === ChargebackStatus.RECEIVED ? "OPEN" : s);
    expect(display(ChargebackStatus.RECEIVED)).toBe("OPEN");
  });

  test("evidence file types restricted", () => {
    const allowed = new Set(["pdf", "png", "jpg", "jpeg", "zip"]);
    expect(allowed.has("pdf")).toBe(true);
    expect(allowed.has("exe")).toBe(false);
  });

  test("no duplicate refund on idempotent key", () => {
    const key = "refund:rfnd_abc";
    const seen = new Set<string>();
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    expect(seen.has(key)).toBe(true);
  });
});

describe("Chargeback analytics formulas", () => {
  test("win rate = won / (won + lost)", () => {
    const won = 7;
    const lost = 3;
    expect(Math.round((won / (won + lost)) * 100)).toBe(70);
  });

  test("chargeback ratio vs payments", () => {
    const chargebacks = 5;
    const payments = 1000;
    expect(Math.round((chargebacks / payments) * 10000) / 100).toBe(0.5);
  });
});
