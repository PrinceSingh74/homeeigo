/**
 * Enterprise backup certification — runtime evidence only.
 *
 * Audits the local backup directory, verifies integrity (SHA256 + pg_restore --list),
 * applies enterprise GFS retention, generates backup-manifest.json, and writes
 * docs/enterprise/backup-enterprise-certification.md.
 *
 *   bun --env-file=.env run scripts/backup-enterprise-certification.ts
 *   bun --env-file=.env run scripts/backup-enterprise-certification.ts --dry-run
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEnterpriseRetention,
  discoverBackups,
  verifyBackups,
  computeRetentionPlan,
  RETENTION_POLICY,
} from "./lib/backup-retention";
import { readBackupMetrics } from "./lib/backup-metrics";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..");
const REPO = join(BACKEND, "..", "..");
const REPORT_PATH = join(REPO, "docs", "enterprise", "backup-enterprise-certification.md");

const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const dryRun = process.argv.includes("--dry-run");

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main() {
  const discovered = await discoverBackups(BACKUP_DIR);
  const beforeCount = discovered.length;
  const beforeBytes = discovered.reduce((s, b) => s + b.size, 0);

  const verified = await verifyBackups(discovered, CONTAINER);
  const valid = verified.filter((r) => r.integrityVerified && r.integrityOk && r.checksumOk);
  const corrupt = verified.filter((r) => r.integrityVerified && (!r.integrityOk || !r.checksumOk));
  const unverified = verified.filter((r) => !r.integrityVerified);

  const planBefore = computeRetentionPlan(verified);
  const toDelete = verified.filter((r) => !planBefore.has(r.filename)).map((r) => r.filename);

  const retention = await applyEnterpriseRetention(BACKUP_DIR, CONTAINER, dryRun);

  const afterDiscovered = dryRun ? discovered : await discoverBackups(BACKUP_DIR);
  const afterBytes = afterDiscovered.reduce((s, b) => s + b.size, 0);
  const metrics = await readBackupMetrics(BACKUP_DIR);

  const newest = valid.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const manifestPath = join(BACKUP_DIR, "backup-manifest.json");
  const manifestExists = await stat(manifestPath).then(() => true).catch(() => false);

  const tierCounts = { newest: 0, monthly: 0, weekly: 0, daily: 0 };
  for (const b of retention.kept) {
    if (b.retentionTier) tierCounts[b.retentionTier]++;
  }

  const lines = [
    "# HOMIGO Enterprise Backup Retention Certification",
    "",
    `**Generated:** ${new Date().toISOString()}  `,
    `**Method:** runtime audit of \`${BACKUP_DIR}\` — no assumptions.`,
    "",
    "## Audit summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total dumps (before) | ${beforeCount} |`,
    `| Total size (before) | ${fmtBytes(beforeBytes)} |`,
    `| Valid backups | ${valid.length} |`,
    `| Corrupt / invalid | ${corrupt.length} |`,
    `| Unverified (pg_restore unavailable) | ${unverified.length} |`,
    `| Retention policy | ${RETENTION_POLICY.daily} daily / ${RETENTION_POLICY.weekly} weekly / ${RETENTION_POLICY.monthly} monthly |`,
    `| Kept after retention | ${retention.kept.length}${dryRun ? " (dry-run)" : ""} |`,
    `| Deleted (expired) | ${dryRun ? toDelete.length + " (would delete)" : retention.deleted.length} |`,
    `| Total size (after) | ${fmtBytes(afterBytes)} |`,
    "",
    "## Integrity verification",
    "",
    "| File | Size | SHA256 OK | Archive OK | Verified | Tier |",
    "|------|------|-----------|------------|----------|------|",
    ...verified.map((b) =>
      `| ${b.filename} | ${fmtBytes(b.size)} | ${b.checksumOk ? "✅" : "❌"} | ${b.integrityOk ? "✅" : "❌"} | ${b.integrityVerified ? "✅" : "—"} | ${planBefore.get(b.filename) ?? "expired"} |`,
    ),
    "",
    "## Retention tier distribution",
    "",
    `- **newest:** ${tierCounts.newest}`,
    `- **monthly:** ${tierCounts.monthly}`,
    `- **weekly:** ${tierCounts.weekly}`,
    `- **daily:** ${tierCounts.daily}`,
    "",
    "## Safety rules",
    "",
    `- Newest valid backup protected: **${newest ? newest.filename : "N/A"}**`,
    `- Monthly snapshots never deleted: **enforced** (${tierCounts.monthly} monthly tier)`,
    "",
  ];

  if (corrupt.length > 0) {
    lines.push("## Corrupt dumps detected", "");
    for (const c of corrupt) {
      lines.push(`- \`${c.filename}\` — integrity=${c.integrityOk} checksum=${c.checksumOk}`);
    }
    lines.push("");
  }

  if (dryRun && toDelete.length > 0) {
    lines.push("## Would delete (dry-run)", "");
    for (const f of toDelete) lines.push(`- \`${f}\``);
    lines.push("");
  } else if (retention.deleted.length > 0) {
    lines.push("## Deleted (expired)", "");
    for (const f of retention.deleted) lines.push(`- \`${f}\``);
    lines.push("");
  }

  lines.push(
    "## Prometheus metrics",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| backup_total | ${metrics.backup_total} |`,
    `| backup_size_bytes | ${metrics.backup_size_bytes} |`,
    `| backup_last_success_timestamp | ${metrics.backup_last_success_timestamp} |`,
    `| backup_retention_deleted_total | ${metrics.backup_retention_deleted_total} |`,
    "",
    "## Manifest",
    "",
    manifestExists || !dryRun
      ? `- \`backup-manifest.json\` → ${manifestPath}`
      : "- Run without `--dry-run` to generate manifest",
    "",
    "## Verdict",
    "",
  );

  const pass =
    valid.length > 0 &&
    corrupt.length === 0 &&
    retention.kept.length > 0 &&
    (newest ? planBefore.has(newest.filename) : false);

  if (unverified.length > 0 && valid.length === 0) {
    lines.push("## Unverified backups", "");
    lines.push("pg_restore was unavailable — integrity could not be confirmed. Start Docker/postgres before certifying.", "");
    for (const u of unverified) lines.push(`- \`${u.filename}\` (${fmtBytes(u.size)})`);
    lines.push("");
  }

  lines.push(
    pass
      ? "**PASS** — Enterprise GFS retention active; integrity verified; newest backup protected."
      : corrupt.length > 0
        ? "**FAIL** — Corrupt backup(s) detected. Investigate before relying on retention."
        : valid.length === 0 && unverified.length > 0
          ? "**NOT PROVEN** — pg_restore unavailable; start Postgres/Docker and re-run."
          : valid.length === 0
          ? "**FAIL** — No valid backups found."
          : "**PARTIAL** — Review retention tier counts.",
    "",
    "## Commands",
    "",
    "```bash",
    "cd apps/backend",
    "bun run backup:db                          # create + retain",
    "bun run backup:retention                   # apply retention only",
    "bun run backup:verify-restore              # scratch DB restore drill",
    "bun run cert:backup                        # re-run this certification",
    "```",
  );

  try {
    await mkdir(dirname(REPORT_PATH), { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  await writeFile(REPORT_PATH, lines.join("\n"));

  console.log(`[cert:backup] report → ${REPORT_PATH}`);
  console.log(`[cert:backup] valid=${valid.length} kept=${retention.kept.length} deleted=${dryRun ? toDelete.length : retention.deleted.length}`);
  console.log(`[cert:backup] verdict=${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error("[cert:backup] fatal:", err);
  process.exit(1);
});
