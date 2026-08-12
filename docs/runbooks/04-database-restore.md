# Runbook 04 — Database Restore
**Trigger:** data corruption / loss / ransomware / failed migration.
1. **Stop writes** (stop backend) to prevent further drift.
2. Pick dump: latest in `apps/backend/backups/` (or S3 `homigo-prod-backups-*`). Verify `pg_restore --list`.
3. Restore to a **scratch** DB first: `DR_SCRATCH_DATABASE_URL=...homigo_dr_scratch bun run p2:dr` (drill validates RTO/RPO + integrity). Measured: RTO ~0.9 min, RPO ~1.2 min.
4. If validated, restore to live: terminate connections → `DROP/CREATE DATABASE homigo_db` → `pg_restore --no-owner -U postgres -d homigo_db <dump>` (MUST pass `-U postgres`).
5. Verify: row counts vs expected, `p2:wallet-integrity`=100, app boots.
6. Resume writes. **No financial edits by hand.**
