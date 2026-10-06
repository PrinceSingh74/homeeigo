import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser run, 2026-10-06: the home page of a development build showed promo codes ("COOL100",
 * "Flat ₹150 OFF") that no server issued. Demo business data was on for every build that was not a
 * production build, so staging-like and local runs showed invented offers, services and prices as
 * if they were real. It is now an explicit opt-in, and a release build refuses it.
 */
const root = join(import.meta.dir, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("demo business data is an explicit opt-in", () => {
  for (const file of [["src", "lib", "services.ts"], ["src", "lib", "profile-dashboard.ts"]]) {
    test(`${file.join("/")} turns it on only for NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA=true`, () => {
      const src = read(...file);
      const decl = src.slice(src.indexOf("MOCK_BUSINESS_DATA_ENABLED"), src.indexOf(";", src.indexOf("MOCK_BUSINESS_DATA_ENABLED")));
      expect(decl).toContain('NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true"');
      expect(decl).not.toContain("NODE_ENV");
    });
  }

  test("a release build is refused when the flag is on", () => {
    const check = readFileSync(join(root, "..", "..", "scripts", "check-release-env.cjs"), "utf8");
    expect(check).toContain("NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA");
  });
});
