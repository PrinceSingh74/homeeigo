import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Browser run, 2026-10-06: the home page of a development build showed promo codes ("COOL100",
 * "Flat ₹150 OFF") that no server issued. Demo business data was on for every build that was not a
 * production build, so staging-like and local runs showed invented offers, services and prices as
 * if they were real. It is now an explicit opt-in, and a release build refuses it.
 */
const root = join(import.meta.dir, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

/** Every source file, so a switch added in a new file is covered without editing this test. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const files = sourceFiles(join(root, "src")).map((p) => ({ rel: relative(root, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

/** The text of each `MOCK_BUSINESS_DATA_ENABLED = …;` declaration in a file. */
function switchDeclarations(text: string): string[] {
  return [...text.matchAll(/MOCK_BUSINESS_DATA_ENABLED\s*=[^;]*;/g)].map((m) => m[0]);
}

describe("demo business data is an explicit opt-in", () => {
  const declaring = files.filter((f) => switchDeclarations(f.text).length > 0);

  test("the files known to declare the switch are found (the scan itself works)", () => {
    const found = declaring.map((f) => f.rel).sort();
    for (const known of ["src/lib/services.ts", "src/lib/profile-dashboard.ts", "src/lib/wallet-dashboard.ts"]) {
      expect(found).toContain(known);
    }
  });

  test("every declaration is on only for NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA=true", () => {
    const offenders = declaring.flatMap((f) =>
      switchDeclarations(f.text)
        .filter((d) => d.includes("NODE_ENV") || !d.includes('NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true"'))
        .map(() => f.rel),
    );
    expect(offenders).toEqual([]);
  });

  test("no file turns anything on merely because the build is not a production build", () => {
    const offenders = files.filter((f) => /NODE_ENV\s*!==?\s*["']production["']/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test("a release build is refused when the flag is on", () => {
    const check = readFileSync(join(root, "..", "..", "scripts", "check-release-env.cjs"), "utf8");
    expect(check).toContain("NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA");
  });
});

/** Kept for the two files the original incident was about. */
describe("the original incident files", () => {
  for (const file of [["src", "lib", "services.ts"], ["src", "lib", "profile-dashboard.ts"]]) {
    test(`${file.join("/")} declares the opt-in`, () => {
      expect(switchDeclarations(read(...file)).length).toBeGreaterThan(0);
    });
  }
});
