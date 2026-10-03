import { describe, expect, it } from "bun:test";
import { dataLossDeclaration, droppedIdentifiers, findDataLoss, inlineOverride, scan } from "../check-migration-safety";

/**
 * The guard must refuse exactly the destructive class it exists for and nothing else. Each fixture
 * is a migration shape Prisma or a human actually writes.
 */
const F = "prisma/migrations/x/migration.sql";

describe("check-migration-safety", () => {
  it("passes a safe additive migration", () => {
    const sql = `
      -- AlterTable
      ALTER TABLE "bookings" ADD COLUMN "notes" TEXT;
      CREATE INDEX "bookings_notes_idx" ON "bookings"("notes");
    `;
    expect(scan(F, sql)).toEqual([]);
  });

  it("refuses the prisma-migrate-diff shape that drops the slot columns and constraints", () => {
    const sql = `
      ALTER TABLE "bookings" DROP CONSTRAINT "bookings_provider_slot_excl",
      DROP COLUMN "provider_slot_end",
      DROP COLUMN "provider_slot_start";
    `;
    const found = scan(F, sql).map((f) => f.matched).sort();
    expect(found).toEqual(["bookings_provider_slot_excl", "provider_slot_end", "provider_slot_start"]);
  });

  it("refuses dropping the slot trigger, its function, the extension, and the wallet CHECK", () => {
    const sql = `
      DROP TRIGGER IF EXISTS bookings_conflict_slots_trg ON "bookings";
      DROP FUNCTION IF EXISTS bookings_sync_conflict_slots();
      DROP EXTENSION IF EXISTS btree_gist;
      ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_balance_consistency";
    `;
    const found = scan(F, sql).map((f) => f.matched).sort();
    expect(found).toEqual(["bookings_conflict_slots_trg", "bookings_sync_conflict_slots", "btree_gist", "wallet_balance_consistency"]);
  });

  it("refuses a partial-index or generated-column disappearance", () => {
    const sql = `
      DROP INDEX IF EXISTS "idx_addresses_payload_hash";
      ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector";
    `;
    expect(scan(F, sql).map((f) => f.matched).sort()).toEqual(["idx_addresses_payload_hash", "search_vector"]);
  });

  it("sees through a schema qualifier — `public.\"x\"` and `\"public\".\"x\"` name x, not public", () => {
    expect(scan(F, `DROP INDEX public."users_email_key";`).map((f) => f.matched)).toEqual(["users_email_key"]);
    expect(scan(F, `DROP INDEX "public"."users_email_key";`).map((f) => f.matched)).toEqual(["users_email_key"]);
    expect(droppedIdentifiers(`DROP TABLE IF EXISTS public.wallet_transactions CASCADE;`)).toEqual(["wallet_transactions"]);
  });

  it("treats RENAME of a protected column, index or table as a drop of the old name", () => {
    expect(scan(F, `ALTER TABLE "bookings" RENAME COLUMN "provider_slot_start" TO "old_pss";`).map((f) => f.matched)).toEqual(["provider_slot_start"]);
    expect(scan(F, `ALTER INDEX "users_email_key" RENAME TO "users_email_key_old";`).map((f) => f.matched)).toEqual(["users_email_key"]);
    expect(scan(F, `ALTER TABLE "journal_entries" RENAME TO "journal_entries_old";`).map((f) => f.matched)).toEqual(["journal_entries"]);
    // Renaming an unprotected object is not a finding.
    expect(scan(F, `ALTER TABLE "scratch" RENAME COLUMN "a" TO "b";`)).toEqual([]);
  });

  it("treats DROP NOT NULL / DROP DEFAULT on a protected column as a drop", () => {
    expect(droppedIdentifiers(`ALTER TABLE "bookings" ALTER COLUMN "provider_slot_start" DROP NOT NULL;`)).toEqual(["provider_slot_start"]);
  });

  it("allows drop-then-recreate of a protected object in the same file (the half-open range fix)", () => {
    const sql = `
      ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_provider_slot_excl";
      ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_slot_excl"
        EXCLUDE USING gist ("provider_id" WITH =, tstzrange("provider_slot_start", "provider_slot_end", '[)') WITH &&);
    `;
    expect(scan(F, sql)).toEqual([]);
  });

  it("does not misread the table name of an ALTER … DROP CONSTRAINT as the dropped object", () => {
    // wallet_transactions is protected (FINANCE_LEDGER); only the constraint name follows DROP.
    const sql = `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "some_unrelated_check";`;
    expect(scan(F, sql)).toEqual([]);
  });

  it("accepts an explicit in-file ALLOW_DESTRUCTIVE reason of ≥ 20 characters and rejects a short one", () => {
    expect(inlineOverride(`-- ALLOW_DESTRUCTIVE: replacing the plain unique index with the hash-based one added below\nDROP INDEX "users_email_key";`))
      .toBe("replacing the plain unique index with the hash-based one added below");
    expect(inlineOverride(`-- ALLOW_DESTRUCTIVE: because\nDROP INDEX "users_email_key";`)).toBeNull();
    expect(inlineOverride(`DROP INDEX "users_email_key";`)).toBeNull();
  });
});

describe("row deletion is its own finding class", () => {
  const DEL = `DELETE FROM "scheduled_jobs" a USING "scheduled_jobs" b WHERE a.id > b.id;`;

  it("REFUSES an undeclared DELETE — the exact shape that removed 3,939 rows on 2026-09-16", () => {
    const found = scan(F, DEL);
    expect(found.length).toBe(1);
    expect(found[0]!.protection.id).toBe("ROW_DELETION");
    expect(found[0]!.matched).toBe("DELETE");
  });

  it("REFUSES TRUNCATE and an unscoped overwrite with a constant", () => {
    expect(scan(F, `TRUNCATE "notifications";`).map((f) => f.matched)).toEqual(["TRUNCATE"]);
    expect(scan(F, `UPDATE "providers" SET "is_online" = false;`).map((f) => f.matched)).toEqual(["UNSCOPED OVERWRITE"]);
  });

  it("ACCEPTS a derived backfill — it populates a new column from one that still exists", () => {
    // Every *_paise dual-write migration has this shape; flagging it would train people to add the
    // waiver by reflex, which is how a guard stops being read.
    expect(scan(F, `UPDATE "bookings" SET "total_amount_paise" = COALESCE(money_to_paise("total_amount"), 0);`)).toEqual([]);
  });

  it("ACCEPTS an UPDATE that is scoped by WHERE", () => {
    expect(scan(F, `UPDATE "providers" SET "is_online" = false WHERE "id" = x;`)).toEqual([]);
  });

  it("ACCEPTS a DELETE once the author declares the assumption (>= 20 chars)", () => {
    const declared = `-- ALLOW_DATA_LOSS: collapses exact duplicates by the key the new unique index enforces
` + DEL;
    expect(scan(F, declared)).toEqual([]);
    expect(dataLossDeclaration(declared)).toContain("collapses exact duplicates");
  });

  it("a too-short declaration is not a declaration", () => {
    expect(dataLossDeclaration(`-- ALLOW_DATA_LOSS: dupes
` + DEL)).toBeNull();
    expect(scan(F, `-- ALLOW_DATA_LOSS: dupes
` + DEL).length).toBe(1);
  });

  it("ALLOW_DESTRUCTIVE does NOT waive data loss (the two risks are separate)", () => {
    const schemaOnlyWaiver = `-- ALLOW_DESTRUCTIVE: replacing the index with the hash-based one added below
` + DEL;
    expect(scan(F, schemaOnlyWaiver).map((f) => f.protection.id)).toEqual(["ROW_DELETION"]);
  });

  it("finds a DELETE spread across several lines", () => {
    const multi = `DELETE FROM "notifications" a
  USING "notifications" b
  WHERE a."id" > b."id";`;
    expect(findDataLoss(multi).map((d) => d.kind)).toEqual(["DELETE"]);
  });
});
