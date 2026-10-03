/**
 * Migration-authority check: prove a database built ONLY from `prisma/migrations` is one the
 * application can actually use.
 *
 * `prisma migrate deploy` exiting 0 says the SQL ran. It does not say the resulting schema matches
 * what the generated client expects, and it does not say the protected objects survived. On
 * 2026-09-21 a rebuild from migrations succeeded and still differed from the running database in
 * both directions — four unique indexes on plaintext PII columns that no migration could drop
 * (`ALTER TABLE ... DROP CONSTRAINT` cannot remove a `CREATE UNIQUE INDEX`, and `IF EXISTS` hid the
 * mismatch), and fifteen indexes that only ever reached the live database through `db push`.
 *
 * This script is deliberately read-only and takes its target from `--url`, never from `.env`:
 * `prisma.config.ts` loads dotenv, and a script that silently inherits `DATABASE_URL` is how a
 * verification run ends up reporting on production instead of the clone it was meant to inspect.
 *
 *   bun run scripts/verify-migration-authority.ts --url "<postgres url of the database to inspect>"
 *
 * No database name is written into this file on purpose. A concrete name in a script is the thing
 * that later gets run against the wrong target, which is exactly what `check-ddl-guard-coverage.ts`
 * refuses — it caught an earlier revision of this comment.
 */
import { PrismaClient } from "@prisma/client";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const url = arg("url");
if (!url) {
  console.error("REFUSING: --url is required. This script never reads DATABASE_URL from the environment.");
  process.exit(2);
}

/**
 * Objects whose loss is silent and expensive. Each is created by raw SQL, so it is invisible to the
 * Prisma datamodel and therefore invisible to `prisma migrate diff` — which actively proposes
 * dropping the slot columns.
 */
const PROTECTED = {
  exclusionConstraints: ["bookings_provider_slot_excl", "bookings_user_slot_excl"],
  uniqueIndexes: [
    "booking_unique_active_slot",
    "wallet_transactions_idempotency_key_key",
    "users_email_hash_key",
    "users_phone_hash_key",
    "providers_pan_number_hash_key",
    "providers_aadhar_number_hash_key",
  ],
  /** Superseded by the `*_hash` indexes above. Their presence means the drop never took effect. */
  mustBeAbsent: [
    "users_email_key",
    "users_phone_number_key",
    "providers_aadhar_number_key",
    "providers_pan_number_key",
    // Plain index on the same plaintext column; init created it, live dropped it by hand, the
    // datamodel never had it. 20260921140000 retires it from the migration history too.
    "users_phone_number_idx",
  ],
  /**
   * CHECK constraints that exist only in migration SQL. `booking_completed_requires_timestamp` was
   * found (2026-09-21, catalog diff) on the live database and in NO migration: a production
   * database built from migrations would have accepted a COMPLETED booking with no completion time.
   */
  checkConstraints: [
    ["bookings", "booking_completed_requires_timestamp", "completed_at IS NOT NULL"],
    ["wallet_transactions", "wallet_balance_consistency", "balance_after"],
  ] as const,
  columns: [
    ["bookings", "provider_slot_start"],
    ["bookings", "provider_slot_end"],
    ["bookings", "user_slot_start"],
    ["bookings", "user_slot_end"],
    ["knowledge_chunks", "search_vector"],
    // Provenance. Added 2026-09-21; its absence is exactly the drift this script reported 29/29
    // PASS against before the bare-find probes were fixed. Asserted structurally here as well so
    // the two checks fail independently.
    ["users", "data_origin"],
    ["bookings", "data_origin"],
    ["refund_requests", "data_origin"],
  ] as const,
};

const prisma = new PrismaClient({ datasources: { db: { url } } });
const failures: string[] = [];
const checks: string[] = [];

function record(ok: boolean, label: string) {
  checks.push(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) failures.push(label);
}

async function main() {
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  console.log(`[migration-authority] target database: ${db}\n`);

  // ── Protected objects ─────────────────────────────────────────────────────────────────────────
  const excl = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND contype = 'x'`,
  );
  for (const name of PROTECTED.exclusionConstraints) {
    record(excl.some((r) => r.conname === name), `exclusion constraint ${name}`);
  }
  // A half-open range is the difference between "back-to-back bookings work" and "they do not".
  const halfOpen = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND contype = 'x'`,
  );
  record(halfOpen.length > 0 && halfOpen.every((r) => r.def.includes("'[)'")), "slot ranges are half-open '[)'");

  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const have = new Set(idx.map((r) => r.indexname));
  for (const name of PROTECTED.uniqueIndexes) record(have.has(name), `unique index ${name}`);
  for (const name of PROTECTED.mustBeAbsent) record(!have.has(name), `stale plaintext-PII index absent: ${name}`);

  for (const [table, name, mustMention] of PROTECTED.checkConstraints) {
    const rows = await prisma.$queryRawUnsafe<{ def: string; validated: boolean }[]>(
      `SELECT pg_get_constraintdef(c.oid) AS def, c.convalidated AS validated
       FROM pg_constraint c WHERE c.conname = $1 AND c.conrelid = $2::regclass AND c.contype = 'c'`,
      name,
      table,
    );
    const def = rows[0]?.def ?? "";
    record(rows.length === 1 && rows[0]!.validated && def.includes(mustMention), `check constraint ${table}.${name}`);
  }

  for (const [table, column] of PROTECTED.columns) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table,
      column,
    );
    record(Number(rows[0]!.n) === 1, `column ${table}.${column}`);
  }

  // ── The generated client can actually read the schema ──────────────────────────────────────────
  //
  // These probes used a narrow `select`, naming three or four columns per model. That made them
  // incapable of detecting the drift they exist to detect. A narrow select asks Postgres only for
  // the columns it names, so a column the client's schema declares and the database does not have
  // is never requested and never errors.
  //
  // Measured on 2026-09-21: `prisma.user.findMany({ select: { id, emailHash, walletBalance } })`
  // succeeded while `prisma.user.findFirst()` threw P2022 on the missing `data_origin` column. The
  // narrow probe reported `ok` for user, booking AND refundRequest — all three of which the client
  // could not actually read — and the script printed 29/29 PASS.
  //
  // A bare find is the honest probe: it selects every scalar the client believes exists, which is
  // exactly the claim being tested. `take: 1` keeps it cheap.
  const probes: Array<[string, () => Promise<unknown>]> = [
    ["user", () => prisma.user.findMany({ take: 1 })],
    ["booking", () => prisma.booking.findMany({ take: 1 })],
    ["payment", () => prisma.payment.findMany({ take: 1 })],
    ["ledgerEntry", () => prisma.ledgerEntry.findMany({ take: 1 })],
    ["walletTransaction", () => prisma.walletTransaction.findMany({ take: 1 })],
    ["provider", () => prisma.provider.findMany({ take: 1 })],
    ["assignmentJob", () => prisma.assignmentJob.findMany({ take: 1 })],
    ["refundRequest", () => prisma.refundRequest.findMany({ take: 1 })],
    ["eventOutbox", () => prisma.eventOutbox.findMany({ take: 1 })],
    ["service", () => prisma.service.findMany({ take: 1 })],
  ];
  for (const [name, run] of probes) {
    try {
      await run();
      record(true, `client query ${name}`);
    } catch (e) {
      // Prisma error messages open with a blank line, so `.split("\n")[0]` is the empty string and
      // the failure printed the model name with no reason at all. Take the first line with content,
      // and the code, which is what actually identifies the drift (P2022 = column missing).
      const err = e as { message?: string; code?: string };
      const detail = (err.message ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "unknown";
      record(false, `client query ${name}: ${err.code ? `${err.code} ` : ""}${detail}`);
    }
  }

  // ── Migration history is internally consistent ────────────────────────────────────────────────
  //
  // Two different things look identical in `_prisma_migrations` and must not be conflated:
  //
  //   (1) A migration DIRECTORY that exists on disk but has no clean applied row. That is a real
  //       schema risk: the DDL either never ran or ran partially.
  //   (2) A ROW for a migration name with no directory, marked rolled back. That is the residue of
  //       a rename — `20260817090000_notification_delivery_claim` was renamed to `...110000` in
  //       commit 0a86cd2 so it would run after the deliveries table exists. The DDL is owned by the
  //       renamed migration, which is applied. It is untidy history, not a schema defect.
  //
  // Treating (2) as a failure trains people to ignore this check, which is how (1) gets missed.
  const unclean = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations
     GROUP BY migration_name
     HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0`,
  );

  const { readdirSync, existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
  // withFileTypes so `migration_lock.toml` is not mistaken for a migration.
  const onDisk = new Set(
    existsSync(migrationsDir)
      ? readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [],
  );

  const missingDdl = unclean.filter((r) => onDisk.has(r.migration_name));
  const renameResidue = unclean.filter((r) => !onDisk.has(r.migration_name));

  // `unclean` comes from `_prisma_migrations` ROWS, so intersecting it with the directory listing
  // can only ever surface directories that already have a row. A directory with NO row — one that
  // has simply never been applied — was invisible to this check, even though it is the plainest
  // form of the very thing the check is named after.
  //
  // Measured on 2026-09-21: three migration directories had no row at all, and this printed
  // "(0 without one)". One of them added the `data_origin` column the generated client had already
  // started selecting, so the client could not read users, bookings or refund_requests — and the
  // script still reported PASS.
  const applied = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT DISTINCT migration_name FROM _prisma_migrations`,
  );
  const hasRow = new Set(applied.map((r) => r.migration_name));
  const neverApplied = [...onDisk].filter((d) => !hasRow.has(d)).sort();

  record(
    missingDdl.length === 0 && neverApplied.length === 0,
    `every migration directory has a clean applied row (${missingDdl.length} unclean, ${neverApplied.length} never applied` +
      `${neverApplied.length ? `: ${neverApplied.join(", ")}` : ""})`,
  );
  if (renameResidue.length > 0) {
    console.log(
      `\n[migration-authority] NOTE — ${renameResidue.length} history row(s) name a migration that no longer exists ` +
        `on disk and are marked rolled back: ${renameResidue.map((r) => r.migration_name).join(", ")}. ` +
        `This is rename residue, not a schema defect; see docs/enterprise-2035-migration-authority.md for the ` +
        `operator decision on whether to clear it.`,
    );
  }

  console.log(checks.join("\n"));
  console.log(
    `\n[migration-authority] ${checks.length - failures.length}/${checks.length} checks passed on "${db}".`,
  );
  if (failures.length > 0) {
    console.error(`\nFAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("[migration-authority] PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
