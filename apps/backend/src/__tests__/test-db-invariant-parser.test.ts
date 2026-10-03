/**
 * The test-DB invariant checker must see every CHECK a migration declares. It used to register only
 * `ADD CONSTRAINT … CHECK` and only the first one per statement, so inline CREATE TABLE constraints
 * and all but the first constraint of a guarded DO block were invisible — homigo_test lacked eight
 * CHECKs while the checker printed OK.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredUnpushableObjects } from "../../scripts/check-test-db-invariants";

function withMigrations(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "inv-"));
  try {
    for (const [name, sql] of Object.entries(files)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "migration.sql"), sql);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("declaredUnpushableObjects", () => {
  test("inline CREATE TABLE CHECKs are declared and replayable as ALTER TABLE ADD", () => {
    withMigrations(
      {
        "001_t": `CREATE TABLE IF NOT EXISTS "things" (
          "id" TEXT NOT NULL,
          "price" DOUBLE PRECISION NOT NULL,
          CONSTRAINT "things_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "things_price_nonneg" CHECK ("price" >= 0),
          CONSTRAINT "things_code_format" CHECK ("id" ~ '^[a-z]+(x)?$')
        );`,
      },
      (dir) => {
        const objs = declaredUnpushableObjects(dir);
        const names = objs.map((o) => o.name).sort();
        expect(names).toEqual(["things_code_format", "things_price_nonneg"]);
        const price = objs.find((o) => o.name === "things_price_nonneg")!;
        expect(price.sql).toBe(`ALTER TABLE "things" ADD CONSTRAINT "things_price_nonneg" CHECK ("price" >= 0)`);
        const code = objs.find((o) => o.name === "things_code_format")!;
        expect(code.sql).toBe(`ALTER TABLE "things" ADD CONSTRAINT "things_code_format" CHECK ("id" ~ '^[a-z]+(x)?$')`);
      },
    );
  });
  test("every constraint of a guarded DO block is declared, not only the first", () => {
    withMigrations(
      {
        "001_do": `DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a_one') THEN
            ALTER TABLE "a" ADD CONSTRAINT "a_one" CHECK ("x" > 0);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a_two') THEN
            ALTER TABLE "a" ADD CONSTRAINT "a_two" CHECK ("y" > 0);
          END IF;
        END $$;`,
      },
      (dir) => {
        expect(declaredUnpushableObjects(dir).map((o) => o.name).sort()).toEqual(["a_one", "a_two"]);
      },
    );
  });
  test("a later DROP CONSTRAINT still retires the object", () => {
    withMigrations(
      {
        "001_t": `CREATE TABLE "b" ("v" INT, CONSTRAINT "b_pos" CHECK ("v" > 0));`,
        "002_d": `ALTER TABLE "b" DROP CONSTRAINT IF EXISTS "b_pos";`,
      },
      (dir) => {
        expect(declaredUnpushableObjects(dir).map((o) => o.name)).not.toContain("b_pos");
      },
    );
  });
  test("the real migrations declare the service-domain CHECKs", () => {
    const names = new Set(declaredUnpushableObjects().map((o) => o.name));
    for (const n of [
      "service_variants_price_nonneg",
      "service_addons_code_format",
      "service_config_versions_version_positive",
      "services_slug_format",
      "services_service_code_format",
      "services_price_range",
      "services_estimated_duration_positive",
      "service_addons_max_quantity_range",
      "services_resolve_taxonomy_trg",
      "services_default_service_code_trg",
      "service_categories_depth_guard_trg",
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });
});
