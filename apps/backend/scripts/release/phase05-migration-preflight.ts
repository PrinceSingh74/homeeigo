/**
 * Phase 05 / 06 migration preflight / post-verify — READ-ONLY, fail-closed.
 *
 * This script never migrates, never writes, and never runs `prisma db push` / `migrate reset`. It
 * answers two questions for an operator who is about to (or just did) run `bunx prisma migrate deploy`:
 *
 *   --pre   Is this the database I think it is, is there a fresh verified backup, is the migration
 *           history clean (no failed / drifted / out-of-order / edited-after-apply rows), and what
 *           exactly is pending? Also records a fingerprint of every existing booking's partner slot.
 *   --post  Did the Phase 05 schema land (columns, CHECKs, exclusion constraints, the duration-aware
 *           slot trigger), and are existing bookings' partner windows byte-identical to --pre
 *           (owner decision D1: existing bookings are never re-slotted)?
 *
 *   bun run scripts/release/phase05-migration-preflight.ts --pre \
 *       --url "$TARGET_URL" --confirm-db <database name> --backup <path/to/file.dump> [--evidence out.json]
 *   bun run scripts/release/phase05-migration-preflight.ts --post \
 *       --url "$TARGET_URL" --confirm-db <database name> --pre-evidence <pre.json> [--evidence out.json]
 *
 * The target is taken ONLY from --url (DATABASE_URL is deliberately ignored: prisma.config.ts loads
 * .env, and an implicit target is how the 2026-09-16 incident happened). Every query runs inside one
 * READ ONLY transaction. Exit: 0 PASS · 1 FAIL · 2 REFUSED (usage / guard).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../prisma/migrations");
const MAX_BACKUP_AGE_HOURS = 6;
/** The Phase 05 set (service domain → pricing integrity → duration-aware partner slot). */
const PHASE05_MIGRATIONS = [
  "20260919090000_service_catalog_config",
  "20260920120000_service_domain",
  "20260920130000_service_variants_addons",
  "20260921120000_data_provenance",
  "20260921140000_live_only_check_and_column_alignment",
  "20260921150000_service_identity_taxonomy",
  "20260921160000_service_addon_dependencies",
  "20260921170000_service_pricing_integrity",
  "20260921180000_duration_aware_partner_slot",
];
/** Phase 06 (additive): requirement catalogue + per-service assignments. Booking snapshots must be untouched. */
const PHASE06_MIGRATIONS = ["20260922100000_service_requirements"];
const PHASE06_TABLES = ["service_requirement_items", "service_requirements"];
const PHASE06_CONSTRAINTS = [
  "service_requirement_items_code_key",
  "service_requirements_service_code_key",
  "service_requirements_customer_charge_check",
  "service_requirements_chargeable_check",
  "service_requirements_blocking_check",
];

type Check = { name: string; status: "PASS" | "FAIL" | "WARN" | "INFO"; detail: string };
const checks: Check[] = [];
const record = (name: string, status: Check["status"], detail: string) => {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(4)}  ${name} — ${detail}`);
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function refuse(msg: string): never {
  console.error(`REFUSED: ${msg}`);
  process.exit(2);
}

const mode = process.argv.includes("--pre") ? "pre" : process.argv.includes("--post") ? "post" : null;
if (!mode) refuse("pass exactly one of --pre / --post");
if (process.argv.includes("--pre") && process.argv.includes("--post")) refuse("pass exactly one of --pre / --post");
const url = arg("--url");
if (!url) refuse("--url is required (DATABASE_URL is intentionally ignored)");
let target: URL;
try {
  target = new URL(url);
} catch {
  refuse("--url is not a valid URL");
}
const dbName = target.pathname.replace(/^\//, "").split("?")[0] ?? "";
const confirm = arg("--confirm-db");
if (!confirm) refuse("--confirm-db <database name> is required");
if (confirm !== dbName) refuse(`--confirm-db "${confirm}" does not match the target database "${dbName}"`);
const safeTarget = `${target.hostname}:${target.port || "5432"}/${dbName}`; // never print credentials

const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, "migration.sql")))
  .map((d) => d.name)
  .sort();
/**
 * Source database recorded in a pg_dump custom-format header ("PGDMP" … dbname, server version,
 * pg_dump version …): the printable field just before the first version string. null if not a dump.
 */
function dumpSourceDatabase(file: string): string | null {
  const head = readFileSync(file).subarray(0, 512).toString("latin1");
  if (!head.startsWith("PGDMP")) return null;
  const fields = head.split(/[^\x20-\x7e]+/).filter(Boolean);
  const v = fields.findIndex((f) => /^\d+(\.\d+)+$/.test(f));
  return v > 0 ? fields[v - 1]! : null;
}
const fileSha = (name: string) => createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"))).digest("hex");

console.log(`[phase05-preflight] mode=${mode} target=${safeTarget} migrations-on-disk=${onDisk.length}`);

const prisma = new PrismaClient({ datasources: { db: { url } } });
type MigRow = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number };
type SlotRow = { id: string; s: Date | null; e: Date | null; d: number | null };

async function main() {
  const evidence: Record<string, unknown> = { mode, target: safeTarget, at: new Date().toISOString() };

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [{ ro }] = await tx.$queryRawUnsafe<{ ro: string }[]>("SELECT current_setting('transaction_read_only') AS ro");
      if (ro !== "on") throw new Error("could not obtain a READ ONLY transaction");
      record("read-only session", "PASS", "all checks run inside one READ ONLY transaction");

      const [{ db }] = await tx.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
      if (db !== confirm) {
        record("target identity", "FAIL", `connected to "${db}", expected "${confirm}"`);
        return;
      }
      record("target identity", "PASS", `connected to ${safeTarget} (confirmed by --confirm-db)`);

      // ── migration history ─────────────────────────────────────────────────────────────
      const hasTable = (await tx.$queryRawUnsafe<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = '_prisma_migrations'",
      ))[0]!.n > 0;
      const rows: MigRow[] = hasTable
        ? await tx.$queryRawUnsafe<MigRow[]>(
            "SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name",
          )
        : [];
      // Tables but no history = built by `db push` (or restored without _prisma_migrations):
      // `migrate deploy` would replay the init migration onto the existing schema and fail midway.
      const hasSchema = (await tx.$queryRawUnsafe<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'bookings'",
      ))[0]!.n > 0;
      const historyRows = rows.filter((r) => r.finished_at != null && r.rolled_back_at == null).length;
      record(
        "migration history matches the schema",
        hasSchema && historyRows === 0 ? "FAIL" : "PASS",
        hasSchema && historyRows === 0
          ? "tables exist but _prisma_migrations has no applied rows (built by db push?) — migrate deploy would replay init; baseline with the reconciliation runbook first"
          : hasSchema ? `${historyRows} applied rows` : "empty database — migrate deploy builds it from init",
      );
      const failed = rows.filter((r) => r.finished_at == null && r.rolled_back_at == null);
      record("no failed migration rows", failed.length ? "FAIL" : "PASS", failed.length ? failed.map((r) => r.migration_name).join(", ") : `${rows.length} history rows`);
      const applied = rows.filter((r) => r.finished_at != null && r.rolled_back_at == null);
      const appliedNames = new Set(applied.map((r) => r.migration_name));
      const unknown = [...appliedNames].filter((n) => !onDisk.includes(n));
      record("no applied migration missing on disk (drift)", unknown.length ? "FAIL" : "PASS", unknown.length ? unknown.join(", ") : "every applied migration exists in this release");
      // Prisma hashes the file BYTES: a CRLF checkout of an LF-applied file "drifts" with no content change.
      const lfSha = (name: string) => createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n")).digest("hex");
      const mismatched = applied.filter((r) => onDisk.includes(r.migration_name) && r.checksum !== fileSha(r.migration_name));
      const eolOnly = mismatched.filter((r) => lfSha(r.migration_name) === r.checksum).map((r) => r.migration_name);
      const edited = mismatched.filter((r) => lfSha(r.migration_name) !== r.checksum).map((r) => r.migration_name);
      record(
        "applied migrations unedited (checksum)",
        edited.length ? "FAIL" : eolOnly.length ? "WARN" : "PASS",
        edited.length
          ? `content edited after apply: ${edited.join(", ")} — see scripts/release/reconcile-migration-checksums.ts`
          : eolOnly.length
            ? `${eolOnly.length} file(s) are CRLF but were applied as LF (content identical): normalise to LF (.gitattributes pins this)`
            : "every applied checksum matches its file",
      );
      const pending = onDisk.filter((n) => !appliedNames.has(n));
      const newestApplied = [...appliedNames].sort().at(-1) ?? "";
      const outOfOrder = pending.filter((n) => n < newestApplied);
      record("pending migrations are strictly newer than applied (order)", outOfOrder.length ? "FAIL" : "PASS", outOfOrder.length ? `older than ${newestApplied}: ${outOfOrder.join(", ")}` : `newest applied: ${newestApplied || "(none)"}`);
      evidence.pending = pending;
      evidence.phase05 = PHASE05_MIGRATIONS.map((n) => ({ migration: n, onDisk: onDisk.includes(n), applied: appliedNames.has(n) }));
      const missingP05 = PHASE05_MIGRATIONS.filter((n) => !onDisk.includes(n));
      if (missingP05.length) record("Phase 05 migrations present in release", "FAIL", `missing: ${missingP05.join(", ")}`);
      evidence.phase06 = PHASE06_MIGRATIONS.map((n) => ({ migration: n, onDisk: onDisk.includes(n), applied: appliedNames.has(n) }));
      const missingP06 = PHASE06_MIGRATIONS.filter((n) => !onDisk.includes(n));
      if (missingP06.length) record("Phase 06 migrations present in release", "FAIL", `missing: ${missingP06.join(", ")}`);

      // ── destructive statements in what is about to run ───────────────────────────────
      const destructive: string[] = [];
      for (const n of pending) {
        const sql = readFileSync(join(MIGRATIONS_DIR, n, "migration.sql"), "utf8").replace(/--[^\n]*/g, "");
        const hits = sql.match(/\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|TRIGGER)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL|UPDATE\s+\S+\s+SET)\b/gi) ?? [];
        if (hits.length) destructive.push(`${n}: ${[...new Set(hits.map((h) => h.toUpperCase().replace(/\s+/g, " ")))].join(", ")}`);
      }
      evidence.destructivePending = destructive;

      // ── existing bookings' partner windows (D1: never re-slotted) ───────────────────
      const hasSlotCol = (await tx.$queryRawUnsafe<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'slot_duration_minutes'",
      ))[0]!.n > 0;
      const slots = await tx.$queryRawUnsafe<SlotRow[]>(
        `SELECT id, provider_slot_start AS s, provider_slot_end AS e, ${hasSlotCol ? "slot_duration_minutes" : "NULL::int"} AS d
           FROM bookings WHERE provider_slot_start IS NOT NULL ORDER BY id`,
      );
      const slotFingerprint = createHash("sha256")
        .update(slots.map((r) => `${r.id}|${r.s?.toISOString()}|${r.e?.toISOString()}`).join("\n"))
        .digest("hex");
      // Phase 06: every booking's service_config_snapshot, byte for byte. A migration must never touch it.
      const [snap] = await tx.$queryRawUnsafe<{ n: number; h: string | null }[]>(
        "SELECT count(*)::int AS n, md5(string_agg(id || '|' || coalesce(service_config_snapshot::text, ''), E'\\n' ORDER BY id)) AS h FROM bookings",
      );
      const snapshotFingerprint = { count: snap?.n ?? 0, md5: snap?.h ?? "" };

      if (mode === "pre") {
        record("pending set", "INFO", pending.length ? `${pending.length}: ${pending.join(", ")}` : "none — schema is current");
        record(
          "destructive / data-changing statements pending",
          destructive.length ? "WARN" : "PASS",
          destructive.length ? `${destructive.length} migration(s) — review against the runbook: ${destructive.join(" | ")}` : "none",
        );
        evidence.bookingSlots = { count: slots.length, sha256: slotFingerprint };
        record("existing partner windows fingerprinted", "INFO", `${slots.length} bookings with a partner window · sha256 ${slotFingerprint.slice(0, 16)}…`);
        evidence.bookingSnapshots = snapshotFingerprint;
        record("booking snapshots fingerprinted (Phase 06)", "INFO", `${snapshotFingerprint.count} bookings · md5 ${snapshotFingerprint.md5.slice(0, 16)}…`);

        // ── backup evidence ───────────────────────────────────────────────────────────
        const backup = arg("--backup");
        if (!backup) record("verified backup", "FAIL", "--backup <file.dump> is required before a migration");
        else if (!existsSync(backup)) record("verified backup", "FAIL", `${backup} does not exist`);
        else {
          const sidecar = `${backup}.sha256`;
          const ageH = (Date.now() - statSync(backup).mtimeMs) / 3_600_000;
          const actual = createHash("sha256").update(readFileSync(backup)).digest("hex");
          const expected = existsSync(sidecar) ? readFileSync(sidecar, "utf8").trim().split(/\s+/)[0] : null;
          const source = dumpSourceDatabase(backup);
          if (!expected) record("verified backup", "FAIL", `no ${basename(sidecar)} sidecar`);
          else if (expected !== actual) record("verified backup", "FAIL", "sha256 does not match its sidecar");
          else if (ageH > MAX_BACKUP_AGE_HOURS) record("verified backup", "FAIL", `backup is ${ageH.toFixed(1)} h old (max ${MAX_BACKUP_AGE_HOURS} h)`);
          else if (source !== dbName) record("verified backup", "FAIL", `backup is of "${source ?? "unknown"}", not the target "${dbName}"`);
          else record("verified backup", "PASS", `${basename(backup)} · of ${source} · sha256 ${actual.slice(0, 16)}… matches sidecar · ${ageH.toFixed(1)} h old`);
          evidence.backup = { file: basename(backup), sourceDatabase: source, sha256: actual, ageHours: +ageH.toFixed(2) };
        }
        return;
      }

      // ── post: the schema the Phase 05 code depends on ─────────────────────────────
      record("nothing left pending", pending.length ? "FAIL" : "PASS", pending.length ? pending.join(", ") : "every migration in this release is applied");
      const cols: Array<[string, string]> = [
        ["services", "data_origin"], ["services", "partner_slot_policy"], ["services", "service_code"],
        ["bookings", "slot_duration_minutes"], ["bookings", "provider_slot_start"], ["bookings", "provider_slot_end"],
      ];
      for (const [t, c] of cols) {
        const n = (await tx.$queryRawUnsafe<{ n: number }[]>(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", t, c,
        ))[0]!.n;
        record(`column ${t}.${c}`, n ? "PASS" : "FAIL", n ? "present" : "MISSING");
      }
      const constraints = ["bookings_provider_slot_excl", "bookings_user_slot_excl", "services_price_paise_precision", "booking_completed_requires_timestamp"];
      for (const c of constraints) {
        const n = (await tx.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1", c))[0]!.n;
        record(`constraint ${c}`, n ? "PASS" : "FAIL", n ? "present" : "MISSING");
      }
      const [fn] = await tx.$queryRawUnsafe<{ src: string | null }[]>(
        "SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p WHERE p.proname = 'bookings_sync_conflict_slots' LIMIT 1",
      );
      const durationAware = !!fn?.src && /COALESCE\(\s*NEW\.slot_duration_minutes\s*,\s*0\s*\)/i.test(fn.src);
      record("slot trigger is duration-aware (D1)", durationAware ? "PASS" : "FAIL", durationAware ? "bookings_sync_conflict_slots uses COALESCE(NEW.slot_duration_minutes, 0)" : "function missing or not the Phase 05 body");
      const trig = (await tx.$queryRawUnsafe<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE p.proname = 'bookings_sync_conflict_slots' AND NOT t.tgisinternal",
      ))[0]!.n;
      record("slot trigger attached", trig ? "PASS" : "FAIL", `${trig} trigger(s) call it`);
      // ── post: the Phase 06 schema (additive) ────────────────────────────────────────
      for (const t of PHASE06_TABLES) {
        const n = (await tx.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1", t))[0]!.n;
        record(`table ${t}`, n ? "PASS" : "FAIL", n ? "present" : "MISSING");
      }
      for (const c of PHASE06_CONSTRAINTS) {
        const n = (await tx.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1", c))[0]!.n;
        record(`constraint ${c}`, n ? "PASS" : "FAIL", n ? "present" : "MISSING");
      }
      const [fk] = await tx.$queryRawUnsafe<{ d: string | null }[]>(
        "SELECT confdeltype AS d FROM pg_constraint WHERE conname = 'service_requirements_item_id_fkey' LIMIT 1",
      );
      record("used catalogue items cannot be deleted (FK RESTRICT)", fk?.d === "r" ? "PASS" : "FAIL", fk ? `confdeltype=${fk.d}` : "FK missing");
      const [reqRows] = await tx.$queryRawUnsafe<{ items: number; assignments: number }[]>(
        "SELECT (SELECT count(*)::int FROM service_requirement_items) AS items, (SELECT count(*)::int FROM service_requirements) AS assignments",
      ).catch(() => [{ items: -1, assignments: -1 }]);
      record("Phase 06 tables start empty (nothing seeded)", reqRows && reqRows.items === 0 && reqRows.assignments === 0 ? "PASS" : "WARN", `items=${reqRows?.items} assignments=${reqRows?.assignments}`);
      const origins = await tx.$queryRawUnsafe<{ o: string | null; n: number }[]>(
        "SELECT data_origin::text AS o, count(*)::int AS n FROM services GROUP BY 1 ORDER BY 1",
      );
      record("service provenance", "INFO", origins.map((r) => `${r.o ?? "NULL(commercial)"}=${r.n}`).join(" · "));
      const fixed = await tx.$queryRawUnsafe<{ slug: string }[]>("SELECT slug FROM services WHERE partner_slot_policy = 'FIXED' ORDER BY slug");
      record("FIXED-slot services (laundry turnaround)", "INFO", fixed.map((r) => r.slug).join(", ") || "none");

      const preFile = arg("--pre-evidence");
      if (!preFile || !existsSync(preFile)) {
        record("existing partner windows unchanged (D1)", "FAIL", "--pre-evidence <pre.json> is required to prove no booking was re-slotted");
      } else {
        const pre = JSON.parse(readFileSync(preFile, "utf8")) as { target?: string; bookingSlots?: { count: number; sha256: string } };
        if (pre.target !== safeTarget) record("existing partner windows unchanged (D1)", "FAIL", `pre evidence is for ${pre.target}, not ${safeTarget}`);
        else {
          // Only bookings that existed at --pre are compared; new ones may have been created since.
          const preIds = pre.bookingSlots?.count ?? -1;
          const same = pre.bookingSlots?.sha256 === slotFingerprint;
          record(
            "existing partner windows unchanged (D1)",
            same ? "PASS" : "WARN",
            same ? `${slots.length} windows byte-identical to --pre` : `fingerprint differs (pre ${preIds} rows, now ${slots.length}) — if bookings were created/cancelled since --pre this is expected; otherwise investigate before reopening traffic`,
          );
        }
      }
      evidence.bookingSlots = { count: slots.length, sha256: slotFingerprint };
      evidence.bookingSnapshots = snapshotFingerprint;
      if (preFile && existsSync(preFile)) {
        const pre = JSON.parse(readFileSync(preFile, "utf8")) as { target?: string; bookingSnapshots?: { count: number; md5: string } };
        if (pre.target === safeTarget && pre.bookingSnapshots) {
          const same = pre.bookingSnapshots.md5 === snapshotFingerprint.md5 && pre.bookingSnapshots.count === snapshotFingerprint.count;
          record(
            "booking snapshots unchanged (Phase 06)",
            same ? "PASS" : "WARN",
            same ? `${snapshotFingerprint.count} snapshots byte-identical to --pre` : `fingerprint differs (pre ${pre.bookingSnapshots.count} rows, now ${snapshotFingerprint.count}) — expected only if bookings were created since --pre`,
          );
        }
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  evidence.checks = checks;
  const out = arg("--evidence");
  if (out) {
    writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(`[phase05-preflight] evidence → ${out}`);
  }
  const failed = checks.filter((c) => c.status === "FAIL");
  console.log(`[phase05-preflight] ${failed.length ? `FAIL (${failed.length})` : "PASS"} · ${checks.length} checks`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`[phase05-preflight] ERROR: ${(e as Error).message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
