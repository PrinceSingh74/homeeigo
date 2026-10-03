import { afterEach, describe, expect, it } from "bun:test";
import {
  assertDdlTarget,
  DdlTargetRefusal,
  parseDdlTarget,
} from "../lib/ddl-target-guard";

/**
 * The seven scenarios from the 2026-09-16 incident review. Each is a way an engineer can end up
 * pointing a maintenance script at the wrong database; the guard must refuse all of them rather
 * than infer an intent.
 */
const TEST_URL = "postgresql://postgres:fixture%40p%23ss!w0rd@localhost:5433/homigo_test?connection_limit=5&pool_timeout=30";
const LIVE_URL = "postgresql://postgres:fixture%40p%23ss!w0rd@localhost:5433/homigo_db";
const PROD_LIKE = "postgresql://homigo:pw@10.20.30.40:5432/homigo_production?sslmode=require";

const savedConfirm = process.env.HOMIGO_DDL_CONFIRM;
afterEach(() => {
  if (savedConfirm === undefined) delete process.env.HOMIGO_DDL_CONFIRM;
  else process.env.HOMIGO_DDL_CONFIRM = savedConfirm;
});

describe("parseDdlTarget", () => {
  it("extracts the database name and never exposes the password", () => {
    const t = parseDdlTarget(TEST_URL)!;
    expect(t.database).toBe("homigo_test");
    expect(t.isTestDatabase).toBe(true);
    expect(t.redacted).not.toContain("pw");
    expect(t.redacted).toContain("***");
  });

  it("keeps the query string out of the database name (the '&' that broke the shell export)", () => {
    // `.env.test` carries ?connection_limit=5&pool_timeout=30 — the name must still parse cleanly.
    expect(parseDdlTarget(TEST_URL)!.database).toBe("homigo_test");
  });

  it("returns null for absent, empty and malformed urls rather than guessing", () => {
    expect(parseDdlTarget(undefined)).toBeNull();
    expect(parseDdlTarget("")).toBeNull();
    expect(parseDdlTarget("   ")).toBeNull();
    expect(parseDdlTarget("not-a-url")).toBeNull();
    expect(parseDdlTarget("postgresql://postgres:pw@localhost:5433")).toBeNull(); // no database
    expect(parseDdlTarget("postgresql://postgres:fixture%40p%23ss!w0rd@localhost:5433/")).toBeNull();
  });
});

describe('assertDdlTarget("test")', () => {
  it("SCENARIO 1 — accepts a real test database", () => {
    const t = assertDdlTarget("test", TEST_URL);
    expect(t.database).toBe("homigo_test");
  });

  it("SCENARIO 2 — REFUSES homigo_db (the exact url the incident ran against)", () => {
    expect(() => assertDdlTarget("test", LIVE_URL)).toThrow(DdlTargetRefusal);
    try {
      assertDdlTarget("test", LIVE_URL);
    } catch (err) {
      // The message must name the database and explain the shell trap, not just say "refused".
      expect((err as Error).message).toContain("homigo_db");
      expect((err as Error).message).toContain("db:execute:test");
    }
  });

  it("SCENARIO 3 — REFUSES a production-like url", () => {
    expect(() => assertDdlTarget("test", PROD_LIKE)).toThrow(/homigo_production/);
  });

  it("SCENARIO 4 — REFUSES a missing url (unknown target is never safe)", () => {
    expect(() => assertDdlTarget("test", undefined)).toThrow(/no usable DATABASE_URL/);
    expect(() => assertDdlTarget("test", "")).toThrow(/no usable DATABASE_URL/);
  });

  it("SCENARIO 5 — REFUSES a malformed url instead of falling back to a default", () => {
    expect(() => assertDdlTarget("test", "postgres//broken")).toThrow(/no usable DATABASE_URL/);
    expect(() => assertDdlTarget("test", "homigo_test")).toThrow(/no usable DATABASE_URL/);
  });

  it("SCENARIO 6 — a .env/.env.test conflict cannot pass: the guard reads the url it is GIVEN", () => {
    // Simulates the incident: process.env still holds the live url because the shell export failed.
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = LIVE_URL;
    try {
      // Default argument path — what a script gets when it trusts the ambient environment.
      expect(() => assertDdlTarget("test")).toThrow(/homigo_db/);
      // Explicit path — what db:execute:test does, reading .env.test itself.
      expect(assertDdlTarget("test", TEST_URL).database).toBe("homigo_test");
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });

  it("SCENARIO 7 — special characters in the url do not break the check", () => {
    const weird = "postgresql://postgres:fixture%40p%23ss!w0rd@localhost:5433/homigo_test?a=1&b=2";
    expect(assertDdlTarget("test", weird).database).toBe("homigo_test");
    const weirdLive = "postgresql://postgres:fixture%40p%23ss!w0rd@localhost:5433/homigo_db?a=1&b=2";
    expect(() => assertDdlTarget("test", weirdLive)).toThrow(DdlTargetRefusal);
  });

  it("a database merely CONTAINING 'test' in a live-looking name is still treated as isolated (documented behaviour)", () => {
    // Deliberate: the same rule prisma-base.ts uses, so the two guards cannot disagree.
    expect(assertDdlTarget("test", "postgresql://u:p@h:5432/homigo_test_clone").database).toBe("homigo_test_clone");
    expect(assertDdlTarget("test", "postgresql://u:p@h:5432/homigo_p39").database).toBe("homigo_p39");
  });
});

describe('assertDdlTarget("live")', () => {
  it("REFUSES without HOMIGO_DDL_CONFIRM — a default .env is not a decision", () => {
    delete process.env.HOMIGO_DDL_CONFIRM;
    expect(() => assertDdlTarget("live", LIVE_URL)).toThrow(/HOMIGO_DDL_CONFIRM=homigo_db/);
  });

  it("REFUSES when the confirmation names a DIFFERENT database (copied command, stale shell)", () => {
    process.env.HOMIGO_DDL_CONFIRM = "homigo_staging";
    expect(() => assertDdlTarget("live", LIVE_URL)).toThrow(DdlTargetRefusal);
  });

  it("accepts when the operator names the exact database being mutated", () => {
    process.env.HOMIGO_DDL_CONFIRM = "homigo_db";
    expect(assertDdlTarget("live", LIVE_URL).database).toBe("homigo_db");
  });

  it("REFUSES a live-intent script pointed at the test database (stale shell in the other direction)", () => {
    process.env.HOMIGO_DDL_CONFIRM = "homigo_test";
    expect(() => assertDdlTarget("live", TEST_URL)).toThrow(/declares intent "live"/);
  });

  it("the confirmation for one database does not authorise another", () => {
    process.env.HOMIGO_DDL_CONFIRM = "homigo_db";
    expect(() => assertDdlTarget("live", PROD_LIKE)).toThrow(/homigo_production/);
  });
});
