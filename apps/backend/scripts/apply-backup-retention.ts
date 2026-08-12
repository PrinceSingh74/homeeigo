/**
 * Apply enterprise GFS retention without creating a new dump.
 *
 *   bun --env-file=.env run scripts/apply-backup-retention.ts
 *   bun --env-file=.env run scripts/apply-backup-retention.ts --dry-run
 */
import { applyEnterpriseRetention } from "./lib/backup-retention";
import { recordRetentionDeletions } from "./lib/backup-metrics";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const result = await applyEnterpriseRetention(BACKUP_DIR, CONTAINER, dryRun);
  console.log(`[retention] kept=${result.kept.length} deleted=${result.deleted.length}${dryRun ? " (dry-run)" : ""}`);
  if (result.deleted.length) console.log(`[retention] removed: ${result.deleted.join(", ")}`);
  if (result.corrupt.length) {
    console.log(`[retention] corrupt (not deleted): ${result.corrupt.map((c) => c.filename).join(", ")}`);
  }
  if (result.unverified.length) {
    console.log(`[retention] unverified (not deleted): ${result.unverified.map((c) => c.filename).join(", ")}`);
  }
  if (!dryRun) await recordRetentionDeletions(BACKUP_DIR, result.deleted.length);
}

main().catch((e) => {
  console.error("[retention] fatal:", e);
  process.exit(1);
});
