import { describe, expect, test } from "bun:test";

describe("Membership coupon discount computation", () => {
  const compute = (pct: number | null, flat: number | null, base: number) => {
    let discount = 0;
    if (pct != null && pct > 0) discount = Math.round((base * pct) / 100);
    if (flat != null && flat > 0) discount = Math.max(discount, Math.round(flat));
    return Math.min(discount, base);
  };

  test("GOLD20 applies 20% off", () => {
    expect(compute(20, null, 2000)).toBe(400);
  });

  test("PLAT100 flat discount", () => {
    expect(compute(null, 100, 500)).toBe(100);
  });

  test("discount capped at base amount", () => {
    expect(compute(50, 200, 100)).toBe(100);
  });
});
