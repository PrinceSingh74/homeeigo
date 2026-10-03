/**
 * Automatic refund recovery must never run against a live database merely because a process loaded
 * `.env`. Pure decision tests — no database, no network.
 *
 * The first cases use the REAL dotenv files from this directory, loaded exactly as a watch-mode dev
 * server loads them (`--env-file=.env`, then load-env's `.env` + `.env.local` with override), with the
 * recovery flag switched on as if someone had added it to the shared file.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { databaseTarget, refundAutoRecoveryDecision } from "../lib/refund-recovery-guard";

const dir = resolve(import.meta.dir, "../..");
const load = (name: string): Record<string, string> => {
  const p = resolve(dir, name);
  return existsSync(p) ? parse(readFileSync(p)) : {};
};
/**
 * What a `bun --env-file=.env run --watch src/index.ts` process ends up with after load-env.
 * `.env` / `.env.local` are per-machine and untracked; a clean checkout (CI, a fresh worktree) has
 * only the shipped template, which names the same live-shaped database, so that is the file a
 * developer's server would be loading there.
 */
const devServerEnv = () => ({ ...(existsSync(resolve(dir, ".env")) ? load(".env") : load(".env.example")), ...load(".env.local") });

describe("refund auto-recovery guard", () => {
  test("a dev server loaded from .env / .env.local cannot enable recovery, even with the flag set in the file", () => {
    const env = { ...devServerEnv(), REFUND_AUTO_RECOVERY_ENABLED: "true" };
    const decision = refundAutoRecoveryDecision(env);
    expect(decision.enabled).toBe(false);
    // The shared files point at the live database from a non-production runtime; the reason says so.
    expect(decision.target).toMatch(/\/homigo_db$/);
    expect(decision.reason).toBe("NON_PRODUCTION_RUNTIME");
  });

  test("…nor by also naming the live database as authorized, while the runtime is not production", () => {
    const base = devServerEnv();
    const env = { ...base, REFUND_AUTO_RECOVERY_ENABLED: "true", REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET: databaseTarget(base.DATABASE_URL) ?? "" };
    expect(refundAutoRecoveryDecision(env).enabled).toBe(false);
  });

  test("the flag is required and must be exactly \"true\"", () => {
    const env = devServerEnv();
    expect(refundAutoRecoveryDecision(env)).toMatchObject({ enabled: false, reason: "FLAG_OFF" });
    for (const v of ["1", "TRUE", "yes", " true"]) {
      expect(refundAutoRecoveryDecision({ ...env, REFUND_AUTO_RECOVERY_ENABLED: v }).enabled).toBe(false);
    }
  });

  test("the test configuration may run it", () => {
    const env = { ...load(".env.test"), REFUND_AUTO_RECOVERY_ENABLED: "true" };
    expect(refundAutoRecoveryDecision(env)).toMatchObject({ enabled: true, reason: "TEST_TARGET" });
  });

  test("a production runtime needs an authorization naming this exact database", () => {
    const url = "postgresql://u:p@db.internal:5432/homigo_db?schema=public";
    const base = { NODE_ENV: "production", DATABASE_URL: url, REFUND_AUTO_RECOVERY_ENABLED: "true" };
    expect(refundAutoRecoveryDecision(base)).toMatchObject({ enabled: false, reason: "TARGET_NOT_AUTHORIZED" });
    expect(refundAutoRecoveryDecision({ ...base, REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET: "db.internal:5432/homigo_db" })).toMatchObject({
      enabled: true,
      reason: "AUTHORIZED_TARGET",
    });
  });

  test("an authorization for a different target fails closed", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db.internal:5432/homigo_db", REFUND_AUTO_RECOVERY_ENABLED: "true" };
    for (const wrong of ["db.internal:5432/homigo_staging_db", "other-host:5432/homigo_db", "db.internal:5433/homigo_db", "homigo_db"]) {
      expect(refundAutoRecoveryDecision({ ...base, REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET: wrong })).toMatchObject({
        enabled: false,
        reason: "TARGET_NOT_AUTHORIZED",
      });
    }
  });

  test("an unreadable database target fails closed", () => {
    for (const bad of [undefined, "", "not a url", "mysql://u:p@h/homigo_test", "postgresql://h:5432/"]) {
      expect(refundAutoRecoveryDecision({ REFUND_AUTO_RECOVERY_ENABLED: "true", NODE_ENV: "production", DATABASE_URL: bad })).toMatchObject({
        enabled: false,
        reason: "TARGET_UNKNOWN",
      });
    }
  });

  test("a staging database is not a test database", () => {
    const env = { ...load(".env.staging"), REFUND_AUTO_RECOVERY_ENABLED: "true" };
    expect(refundAutoRecoveryDecision(env).enabled).toBe(false);
  });
});
