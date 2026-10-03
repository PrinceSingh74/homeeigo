/**
 * READ-ONLY schema drift check (Phase 28). Target: whatever DATABASE_URL points at — printed first.
 *   bun --env-file=.env.test run scripts/check-schema-drift.ts   (or .env for the dev database)
 *
 * Two things a green `prisma validate` never tells you:
 *   1. The objects that live ONLY in migration SQL are still there — the slot-exclusion constraints
 *      and their hidden columns, the paise sync triggers, the money CHECKs, the history trigger,
 *      the number sequences. `prisma db push` / a generated diff silently drops several of them.
 *   2. Every Prisma model has its table (a model without a table fails at runtime, not at build).
 *
 * Exit 1 on a missing protected object or a model without a table. Tables with no model are listed
 * for information only. Issues SELECTs against the catalog; changes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";

const TRIGGERS = [
  "bookings_conflict_slots_trg",
  "bookings_status_history_trg",
  "booking_status_history_no_update",
  "trg_sync_bookings_paise",
  "trg_sync_chargebacks_paise",
  "trg_sync_earnings_paise",
  "trg_sync_financial_adjustments_paise",
  "trg_sync_ledger_entries_paise",
  "trg_sync_membership_cashbacks_paise",
  "trg_sync_payments_paise",
  "trg_sync_providers_money_paise",
  "trg_sync_refund_requests_paise",
  "trg_sync_users_money_paise",
  "trg_sync_wallet_transactions_paise",
  "trg_sync_wallet_transfers_paise",
  "trg_sync_withdrawals_paise",
  "users_financial_history_guard",
  "providers_financial_history_guard",
  "bookings_financial_history_guard",
  // Proves the check can fail: SCHEMA_DRIFT_SELFTEST=1 must exit 1.
  ...(process.env.SCHEMA_DRIFT_SELFTEST ? ["__selftest_absent_trigger__"] : []),
];
const CONSTRAINTS = [
  "bookings_provider_slot_excl",
  "bookings_user_slot_excl",
  "wallet_balance_consistency",
  "users_wallet_balance_paise_non_negative",
  "providers_wallet_balance_paise_non_negative",
  "providers_reserved_balance_paise_non_negative",
  "payments_amount_paise_positive",
  "ratings_score_range",
  "document_sequences_value_positive",
];
const SEQUENCES = ["journal_entry_number_seq", "wallet_txn_number_seq", "withdrawal_number_seq"];
const HIDDEN_COLUMNS: Array<[string, string]> = [
  ["bookings", "provider_slot_start"],
  ["bookings", "provider_slot_end"],
  ["bookings", "user_slot_start"],
  ["bookings", "user_slot_end"],
];

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"]);

/**
 * Every scalar/enum field of every model, with the column it maps to. Added 2026-09-20 (release
 * certification) after two drifts that models-have-tables could not see:
 *   - dev homigo_db lacked refund_requests.retry_count/next_retry_at (a migration never applied), so
 *     EVERY full RefundRequest read threw P2022;
 *   - a database built from the migrations had chargebacks.risk_level as TEXT while the model says
 *     FinancialRiskLevel, so any Prisma filter on it threw 42883.
 */
function modelColumns(): Array<{ table: string; column: string; enumType: string | null; list: boolean }> {
  const schema = readFileSync(join(import.meta.dir, "..", "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");
  // Prisma enum name → database type name (`@@map` inside the enum block renames the Postgres type).
  const enumDbName = new Map<string, string>();
  for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    enumDbName.set(m[1]!, /@@map\("([^"]+)"\)/.exec(m[2]!)?.[1] ?? m[1]!);
  }
  const enums = new Set(enumDbName.keys());
  const out: Array<{ table: string; column: string; enumType: string | null; list: boolean }> = [];
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const body = block.slice(0, block.indexOf("\n}"));
    const name = body.split(/\s/)[0]!;
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name;
    for (const line of body.split("\n").slice(1)) {
      const m = /^\s+(\w+)\s+(\w+)(\[\])?\??(.*)$/.exec(line);
      if (!m || line.trim().startsWith("//") || line.trim().startsWith("@@")) continue;
      const [, field, type, list, rest] = m;
      const isEnum = enums.has(type!);
      if (!SCALARS.has(type!) && !isEnum) continue; // relation field
      if (/@ignore\b/.test(rest!)) continue;
      const column = /@map\("([^"]+)"\)/.exec(rest!)?.[1] ?? field!;
      out.push({ table, column, enumType: isEnum ? enumDbName.get(type!)! : null, list: Boolean(list) });
    }
  }
  return out;
}

function modelTables(): string[] {
  const schema = readFileSync(join(import.meta.dir, "..", "prisma", "schema.prisma"), "utf8");
  const out: string[] = [];
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const name = block.split(/\s/)[0]!;
    const map = /@@map\("([^"]+)"\)/.exec(block);
    out.push(map ? map[1]! : name);
  }
  return out;
}

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  console.log(`[schema-drift] target database: ${db}`);
  const missing: string[] = [];

  const trg = new Set(
    (await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`).map((r) => r.tgname),
  );
  for (const t of TRIGGERS) if (!trg.has(t)) missing.push(`trigger ${t}`);

  const con = new Set((await prisma.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint`).map((r) => r.conname));
  for (const c of CONSTRAINTS) if (!con.has(c)) missing.push(`constraint ${c}`);

  const seq = new Set(
    (await prisma.$queryRaw<{ relname: string }[]>`SELECT relname FROM pg_class WHERE relkind = 'S'`).map((r) => r.relname),
  );
  for (const s of SEQUENCES) if (!seq.has(s)) missing.push(`sequence ${s}`);

  const cols = await prisma.$queryRaw<{ table_name: string; column_name: string; udt_name: string }[]>`
    SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public'`;
  const colSet = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  for (const [t, c] of HIDDEN_COLUMNS) if (!colSet.has(`${t}.${c}`)) missing.push(`column ${t}.${c}`);

  const udt = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c.udt_name]));
  const existingTables = new Set(cols.map((c) => c.table_name));
  let fieldsChecked = 0;
  for (const f of modelColumns()) {
    if (!existingTables.has(f.table)) continue; // reported below as a model without a table
    fieldsChecked++;
    const key = `${f.table}.${f.column}`;
    const actual = udt.get(key);
    if (actual === undefined) {
      missing.push(`column ${key} (declared by the Prisma model)`);
    } else if (f.enumType && actual !== (f.list ? `_${f.enumType}` : f.enumType)) {
      missing.push(`enum type on ${key}: model says ${f.enumType}${f.list ? "[]" : ""}, database has ${actual}`);
    }
  }
  console.log(`[schema-drift] model fields checked: ${fieldsChecked}`);

  const tables = new Set(
    (await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.tablename),
  );
  const models = modelTables();
  const modelsWithoutTable = models.filter((m) => !tables.has(m));
  const tablesWithoutModel = [...tables].filter((t) => t !== "_prisma_migrations" && !models.includes(t));

  console.log(`[schema-drift] protected objects checked: ${TRIGGERS.length + CONSTRAINTS.length + SEQUENCES.length + HIDDEN_COLUMNS.length}`);
  console.log(`[schema-drift] models: ${models.length}, tables: ${tables.size}`);
  if (tablesWithoutModel.length) console.log(`[schema-drift] info — tables with no Prisma model: ${tablesWithoutModel.join(", ")}`);
  if (missing.length || modelsWithoutTable.length) {
    for (const m of missing) console.error(`[schema-drift] MISSING ${m}`);
    for (const m of modelsWithoutTable) console.error(`[schema-drift] MISSING table for model → ${m}`);
    process.exit(1);
  }
  console.log("[schema-drift] OK");
  process.exit(0);
}

void main();
