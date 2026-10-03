import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredUnpushableObjects, splitStatements } from "../check-test-db-invariants";

/**
 * The invariant checker decides which database rules the test database must enforce, and
 * `setup-test-db.ts` now trusts it. That makes its parser load-bearing: an object it fails to see is
 * an invariant nobody notices is missing, and a test asserting "the database refuses this" quietly
 * stops meaning anything.
 *
 * Both parser bugs pinned below were real. The first shipped: splitting on `;` cut through the
 * `DO $$ ... END IF; END $$` blocks that wrap five money CHECKs, so wallet-balance-non-negative,
 * payment-amount-positive and rating-range all looked unreplayable. The second was the opposite
 * error — reporting `assignment_attempts_one_sent_per_job` as missing when two later migrations
 * deliberately drop it, which is the kind of false alarm that teaches people to ignore the check.
 */
let dir = "";

function migration(name: string, sql: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "migration.sql"), sql, "utf8");
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mig-check-"));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("splitStatements", () => {
  test("does not cut inside a dollar-quoted body", () => {
    const sql = `
      ALTER TABLE a ADD COLUMN IF NOT EXISTS b INT;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'c') THEN
          ALTER TABLE a ADD CONSTRAINT c CHECK (b >= 0);
        END IF;
      END $$;
      CREATE INDEX i ON a(b);
    `;
    const stmts = splitStatements(sql).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

    expect(stmts.length).toBe(3);
    // The whole guarded block is ONE statement — the `END IF;` inside it is not a separator.
    expect(stmts[1]).toContain("ADD CONSTRAINT c CHECK");
    expect(stmts[1]!.startsWith("DO $$")).toBe(true);
  });

  test("handles a tagged dollar quote", () => {
    const stmts = splitStatements(`CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN; END; $fn$ LANGUAGE plpgsql;`);
    expect(stmts.filter((s) => s.trim()).length).toBe(1);
  });
});

describe("declaredUnpushableObjects", () => {
  test("finds a partial index whose WHERE clause is on the following line", () => {
    migration("20200101000000_partial", [
      'CREATE UNIQUE INDEX "one_live_per_thing"',
      '  ON "things"("name") WHERE "stage" = \'LIVE\';',
    ].join("\n"));

    const found = declaredUnpushableObjects(dir);
    const idx = found.find((o) => o.name === "one_live_per_thing");
    expect(idx).toBeDefined();
    expect(idx!.kind).toBe("partial unique index");
  });

  test("ignores a plain index — db push creates those from schema.prisma", () => {
    migration("20200102000000_plain", 'CREATE INDEX "things_name_idx" ON "things"("name");');
    expect(declaredUnpushableObjects(dir).some((o) => o.name === "things_name_idx")).toBe(false);
  });

  test("finds a CHECK wrapped in a DO block", () => {
    migration("20200103000000_check", `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'things_size_positive') THEN
          ALTER TABLE things ADD CONSTRAINT things_size_positive CHECK (size > 0);
        END IF;
      END $$;
    `);

    const found = declaredUnpushableObjects(dir).find((o) => o.name === "things_size_positive");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("check constraint");
  });

  test("an object a later migration drops is not reported as missing", () => {
    migration("20200104000000_create", 'CREATE UNIQUE INDEX "doomed" ON "things"("a") WHERE "b" IS NULL;');
    migration("20200105000000_drop", "DROP INDEX IF EXISTS doomed;");

    expect(declaredUnpushableObjects(dir).some((o) => o.name === "doomed")).toBe(false);
  });

  test("an object dropped and then recreated IS reported, with the newest definition", () => {
    migration("20200106000000_v1", 'CREATE UNIQUE INDEX "revived" ON "things"("a") WHERE "b" = 1;');
    migration("20200107000000_gone", "DROP INDEX IF EXISTS revived;");
    migration("20200108000000_v2", 'CREATE UNIQUE INDEX "revived" ON "things"("a") WHERE "b" = 2;');

    const found = declaredUnpushableObjects(dir).find((o) => o.name === "revived");
    expect(found).toBeDefined();
    // Order decides, so the surviving definition must be the LAST one, not the first.
    expect(found!.migration).toBe("20200108000000_v2");
    expect(found!.sql).toContain('"b" = 2');
  });

  test("a redefined constraint keeps the newest body — the superseded one must not win", () => {
    migration("20200109000000_closed", 'ALTER TABLE "bookings" ADD CONSTRAINT "slot_excl" EXCLUDE USING gist (tstzrange(a, b, \'[]\') WITH &&);');
    migration("20200110000000_halfopen", 'ALTER TABLE "bookings" ADD CONSTRAINT "slot_excl" EXCLUDE USING gist (tstzrange(a, b, \'[)\') WITH &&);');

    const found = declaredUnpushableObjects(dir).find((o) => o.name === "slot_excl");
    expect(found).toBeDefined();
    /**
     * This is the case that broke the test database. The closed range makes back-to-back bookings
     * impossible and was replaced for exactly that reason; replaying the older body against real
     * data fails. The checker must carry the half-open definition forward.
     */
    expect(found!.sql).toContain("'[)'");
    expect(found!.sql).not.toContain("'[]'");
  });

  test("tracks a raw-SQL column, since db push drops what schema.prisma does not declare", () => {
    migration("20200111000000_cols", 'ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "provider_slot_start" TIMESTAMPTZ;');

    const found = declaredUnpushableObjects(dir).find((o) => o.name === "bookings.provider_slot_start");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("column");
    expect(found!.table).toBe("bookings");
  });

  test("a commented-out declaration is not treated as declared", () => {
    migration("20200112000000_comment", '-- CREATE UNIQUE INDEX "ghost" ON "things"("a") WHERE "b" IS NULL;');
    expect(declaredUnpushableObjects(dir).some((o) => o.name === "ghost")).toBe(false);
  });
});
