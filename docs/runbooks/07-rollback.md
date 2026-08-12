# Runbook 07 — Deployment Rollback
**Trigger:** bad deploy (errors, latency, failed health).
1. **App rollback:** redeploy the previous known-good image/commit.
2. **Migration safety:** Prisma migrations are additive; a forward migration that broke things → restore DB (04) IF the migration was destructive (rare — policy forbids destructive prod migrations). Additive tables/columns are safe to leave.
3. **Verify** post-rollback: `/health`, booking + payment smoke, `p2:wallet-integrity`=100.
4. Re-enable traffic. File a revert PR for the bad change.
**Note:** geofence tables were added via `CREATE TABLE IF NOT EXISTS` (idempotent, additive) — safe across rollbacks.
