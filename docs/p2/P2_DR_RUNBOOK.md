# HOMIGO — P2 Disaster-Recovery Runbook

> Scope: PostgreSQL recovery, Prisma migrations, and financial/operational data
> integrity (ledger, bookings, wallet balances, provider balances, HCoins,
> memberships). Reuses `scripts/backup-db.ts` (backup) and
> `scripts/p2-validation/dr-restore-drill.ts` (timed restore drill).

## Targets (P2 success criteria)

| Objective | Target | How measured |
|---|---|---|
| RTO (restore time) | ≤ 30 min | wall-clock of the drill (recreate → restore → migrate → verify) |
| RPO (data loss window) | ≤ 15 min | age of the most recent good dump at incident time |
| Data corruption | none | integrity checks on the restored DB (ledger balance, no negative balances) |

To hit **RPO ≤ 15 min** the hourly CronJob in `INFRA_RUNBOOK.md` is **insufficient**
(it yields RPO ≈ 60 min). Two supported paths:
1. **Managed Postgres PITR** (RDS/Cloud SQL/Neon) — continuous WAL archiving → RPO ≈ seconds. *Recommended.*
2. Snapshot the dump every 10–15 min via the CronJob schedule `*/15 * * * *` **plus** WAL streaming replica.

---

## 1. Backup (already implemented — reuse)

```bash
# Local (docker): dump runs inside the postgres container
BACKUP_DOCKER_CONTAINER=homigo-postgres bun run backup:db
# Production: pg_dump on PATH against DATABASE_URL, offsite to S3 (SSE AES256)
AWS_S3_BUCKET=s3://homigo-backups bun run backup:db
```
`backup-db.ts` produces a `pg_dump -Fc` archive, verifies it (`pg_restore --list`),
applies retention, and uploads to S3 (encrypted). Validate the offsite copy with
`bun run p2:s3` (see `S3_BACKUP_VALIDATION` finding below).

## 2. Restore drill (new — `dr-restore-drill.ts`)

The drill **never touches production**: it refuses to run unless
`DR_SCRATCH_DATABASE_URL` is set and differs from `DATABASE_URL`.

```bash
# 1. Take a fresh backup (so RPO reflects "now").
AWS_S3_BUCKET=s3://homigo-backups bun run backup:db
# 2. Restore into an isolated scratch DB and verify, timed.
DR_SCRATCH_DATABASE_URL=postgresql://postgres:pw@host:5432/homigo_dr_drill \
  bun run p2:dr
```
The drill: recreates the scratch DB → `pg_restore --clean --if-exists` →
`prisma migrate status` → integrity SQL (bookings/payments/wallets/hcoins/
memberships counts, **no negative HCoin wallets**, ledger table present) →
writes `docs/p2/evidence/dr-restore-drill.md` with the **RTO Report, RPO Report,
and Recovery Evidence Report**.

## 3. Production restore procedure (incident)

```bash
# 1. Stop writers — scale API to 0 replicas (prevents split data).
kubectl scale deploy/homigo-backend --replicas=0
# 2. Pull the latest good dump from S3 (verify checksum first: bun run p2:s3).
aws s3 cp s3://homigo-backups/homigo_<ts>.dump ./restore.dump
# 3. Restore into the (new/clean) production DB.
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" ./restore.dump
# 4. Reconcile migration history.
bunx prisma migrate status   # then `migrate resolve` only if a partial migration is reported
# 5. Run integrity gates BEFORE reopening traffic.
bun run p2:wallet-integrity && bun run validate:production
# 6. Scale API back up.
kubectl scale deploy/homigo-backend --replicas=3
```

---

## Finding DR-001 — RPO target needs sub-hourly backups / PITR

- **Evidence:** `INFRA_RUNBOOK.md` §4 schedules hourly snapshots ("RPO ≈ 1h"); the
  CronJob template uses `0 * * * *`. P2 requires RPO ≤ 15 min.
- **Risk:** Up to ~60 min of committed transactions (payments, ledger entries,
  wallet mutations) lost on a catastrophic DB failure.
- **Impact:** Financial discrepancy and customer-visible data loss after recovery.
- **Fix:** Enable managed-Postgres PITR (preferred) **or** set CronJob schedule to
  `*/15 * * * *` and add a WAL streaming replica.
- **Verification:** `bun run p2:dr` reports RPO ≤ 15 min (dump age) → PASS.
- **Rollback:** Revert CronJob schedule; PITR is non-destructive to disable.
- **Success criteria:** Drill RPO ≤ 15 min, RTO ≤ 30 min, integrity all PASS.

## Finding DR-002 — Restore was procedure-only (now a runnable, verified drill)

- **Evidence:** Prior `INFRA_RUNBOOK.md` §4 marked restore "NOT executed here".
- **Risk:** Unrehearsed restore → unknown RTO, latent corruption undetected.
- **Impact:** Recovery may exceed RTO or silently lose ledger/wallet consistency.
- **Fix:** `dr-restore-drill.ts` performs and times the full restore + integrity
  verification against an isolated DB; emits RTO/RPO/recovery evidence.
- **Verification:** Run `bun run p2:dr` in staging; attach `dr-restore-drill.md`.
- **Rollback:** Drill is read-only w.r.t. prod (scratch DB only); drop scratch DB.
- **Success criteria:** All recovery steps PASS, RTO ≤ 30 min, no corruption.

> **Current status in this environment: NOT VERIFIED** — `pg_dump`/`pg_restore`
> not installed and no DB running here. Evidence file written with the abort
> reason. Execute in staging/CI (Linux image has both) to certify COMPLETE.
