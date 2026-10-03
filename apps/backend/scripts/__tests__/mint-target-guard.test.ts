/**
 * 2026-09-30: partner-web's `presence-heartbeat-timer.spec.ts` mints a session with
 * `bun --env-file=.env run scripts/mint-partner-web-session.ts`. On a developer machine `.env` is the
 * LIVE database, so a local E2E run wrote four unrevoked refresh-token rows for a live account. The
 * script now goes through the repository's declared-target guard (scripts/lib/script-target.ts):
 * a non-test database is refused unless `--allow-live` is on the command line, and the spec passes
 * that flag only on a GitHub Actions runner (the job's own throwaway database).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireDeclaredTarget } from "../lib/script-target";

function refusedFor(url: string, argv: string[]): boolean {
  const exit = process.exit;
  const err = console.error;
  let refused = false;
  (process as unknown as { exit: (c?: number) => never }).exit = ((code?: number) => {
    refused = code === 2;
    throw new Error("exit");
  }) as never;
  console.error = () => undefined;
  try {
    requireDeclaredTarget({ env: { DATABASE_URL: url }, argv, label: "t" });
  } catch {
    /* exit stub */
  } finally {
    process.exit = exit;
    console.error = err;
  }
  return refused;
}

describe("mint-partner-web-session target", () => {
  test("the guard refuses the live database without --allow-live, allows a test database", () => {
    expect(refusedFor("postgresql://u:p@localhost:5433/homigo_db", ["bun", "script"])).toBe(true);
    expect(refusedFor("postgresql://u:p@localhost:5433/homigo_test", ["bun", "script"])).toBe(false);
    expect(refusedFor("postgresql://u:p@localhost:5432/homigo_db", ["bun", "script", "--allow-live"])).toBe(false);
  });

  test("the mint script declares its target before it writes anything", () => {
    const src = readFileSync(join(import.meta.dir, "..", "mint-partner-web-session.ts"), "utf8");
    const guard = src.indexOf("requireDeclaredTarget(");
    const write = src.indexOf("createSessionTokens(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });

  test("the partner-web spec asks for the live flag only on a GitHub Actions runner", () => {
    const spec = readFileSync(join(import.meta.dir, "..", "..", "..", "partner-web", "e2e", "presence-heartbeat-timer.spec.ts"), "utf8");
    expect(spec).toMatch(/GITHUB_ACTIONS === "true" \? \["--allow-live"\] : \[\]/);
  });
});
