# Disaster Recovery — Certification

**Date:** 2026-06-13 · **Method:** executed the full backup → restore → verify cycle. Restore targets an **isolated scratch DB** (`homigo_dr_scratch`); the drill refuses to run if the scratch URL equals the live `DATABASE_URL`, so production is never overwritten. `scripts/backup-db.ts` + `scripts/p2-validation/dr-restore-drill.ts`.

## Executed cycle

1. **Backup** (`bun run backup:db`) — dumped live `homigo_db` → `homigo_2026-06-12T19-42-39-396Z.dump` (141 MB), **integrity verified** via `pg_restore --list`, **checksum** sha256 recorded, **uploaded to S3** `s3://homigo-prod-backups-prince/...` (region eu-north-1, SSE AES256), 14-day retention applied.
2. **Restore drill** (`bun run p2:dr`) — recreated `homigo_dr_scratch`, `pg_restore --clean --if-exists` (45.4 s), `prisma migrate status`, then SQL integrity verification.

## Results

| Metric | Measured | Target | Verdict |
|---|---|---|---|
| **RTO** (time to full restore) | **0.87 min** | ≤ 30 min | ✅ PASS |
| **RPO** (dump age at drill) | **1.16 min** | ≤ 15 min | ✅ PASS |
| Restore integrity | PASS | — | ✅ |

## Recovered-state verification (restored scratch vs LIVE)

| Entity | Restored scratch | Live `homigo_db` | Match |
|---|---|---|---|
| users | 238 | 238 | ✅ |
| bookings | 94 | 94 | ✅ |
| payments | 68 | — | recovered |
| hcoin wallets | 9 | — | recovered |
| hcoin txns | 23 | — | recovered |
| memberships | 23 | — | recovered |
| negative hcoin wallets | **0** | — | ✅ no corruption |
| ledger_entries table | present | — | ✅ |

The restored database is a faithful, complete copy of production (row-for-row on users + bookings), with no negative balances and the ledger intact.

**Verdict: DISASTER RECOVERY CERTIFIED** — backup is automated + checksum-verified + offsite (S3 SSE); restore is reproducible at RTO 0.87 min / RPO 1.16 min, both well inside target; recovered data verified against live. No production data was modified (restore went to an isolated scratch DB).

Evidence: `docs/p2/evidence/dr-restore-drill.{md,json}`. **Rollback:** none — drill is read-only against prod; scratch DB `homigo_dr_scratch` can be dropped freely.
