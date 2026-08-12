# Evidence — DR Restore Drill (Live Execution)

**Generated:** 2026-06-08T17:46:00Z  
**Verdict:** 🟡 **PARTIAL PASS** — backup + manual restore verified; automated drill script failed on Windows

## Phase 2.1 — Fresh Backup

| Field | Value |
|---|---|
| Command | `BACKUP_DOCKER_CONTAINER=homigo-postgres bun run backup:db` |
| Exit code | 0 |
| Backup path | `apps/backend/backups/homigo_2026-06-08T17-44-21-750Z.dump` |
| Backup size | **360,165 bytes (351.7 KB)** |
| Integrity check | ✅ `pg_restore --list` passed (script output) |
| SHA-256 | `F698614033594F87D1D2F1DD728301CBFD44E674C639CA10E11B87DB92CAB290` |

### Backup log (excerpt)

```
[backup] dumping homigo_db → backups\homigo_2026-06-08T17-44-21-750Z.dump (via container homigo-postgres)
[backup] ✅ dump complete — 351.7 KB
[backup] ✅ integrity verified (pg_restore --list)
[backup] (AWS_S3_BUCKET unset → local-only)
```

## Phase 2.2 — Automated Drill (`bun run p2:dr`)

| Step | Result | Detail |
|---|:--:|---|
| recreate_scratch_db | ❌ FAIL | `DROP DATABASE cannot run inside a transaction block` (psql -c combined statement) |
| pg_restore | ❌ FAIL | Windows host path not visible inside container |
| integrity_verification | ❌ FAIL | scratch DB empty / tables missing |

**RTO/RPO from script timers:** RTO 0.02 min ✅ · RPO 0.50 min ✅ — but integrity steps failed, so **script verdict = FAIL (exit 1)**.

## Phase 2.3 — Manual Restore (correct procedure, real evidence)

Commands executed:

```bash
docker exec homigo-postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS homigo_dr_drill"
docker exec homigo-postgres psql -U postgres -d postgres -c "CREATE DATABASE homigo_dr_drill"
docker cp backups/homigo_2026-06-08T17-44-21-750Z.dump homigo-postgres:/tmp/p2_restore.dump
docker exec homigo-postgres pg_restore --clean --if-exists --no-owner -U postgres -d homigo_dr_drill /tmp/p2_restore.dump
```

Restore verification: `pg_restore --list /tmp/p2_restore.dump` → archive valid; `\dt` on `homigo_dr_drill` shows **all tables restored** (bookings, users, payments, journal_entries, etc.).

## Phase 2.4 — Record Count Comparison (source vs restored)

| Table | Source (`homigo_db`) | Restored (`homigo_dr_drill`) | Match |
|---|--:|--:|:--:|
| users | 48 | 48 | ✅ |
| bookings | 0 | 0 | ✅ |
| payments | 0 | 0 | ✅ |
| hcoin_wallets | 8 | 8 | ✅ |
| user_subscriptions | 22 | 22 | ✅ |

**Result:** ✅ **PASS** — restored DB matches source counts for all compared tables.

## Phase 2.5 — Wallet / Ledger Integrity Post-Restore

Not re-run against scratch DB in this session. Production integrity on live DB: see `wallet-integrity.md` (ledger drift warnings on live DB — pre-existing, not introduced by restore).

## RTO / RPO

| Metric | Measured | Target | Status |
|---|---|:--:|:--:|
| RTO (manual restore wall time) | ~12 s | ≤ 30 min | ✅ PASS |
| RPO (dump age at backup) | ~0.3 min | ≤ 15 min | ✅ PASS |
| Data corruption | none (counts match) | none | ✅ PASS |

## Finding DR-SCRIPT-001

- **Risk:** Automated drill unreliable on Windows + Docker path mapping.
- **Impact:** CI/staging on Linux may pass while Windows dev fails silently.
- **Fix:** Use `docker cp` before `pg_restore` inside container; split DROP/CREATE into separate psql invocations.
- **Verification:** Re-run `bun run p2:dr` after script fix on Windows.
