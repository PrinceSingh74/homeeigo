# Evidence — DR Restore Drill (RTO / RPO / Recovery)

Generated: 2026-06-25T11:12:18.411Z
Dump restored: `homigo_2026-06-25T11-10-42-927Z.dump`

## RTO Report
- Measured restore time (RTO): **0.29 min**
- Target: ≤ 30 min → **PASS ✅**

## RPO Report
- Dump age at drill time (RPO proxy): **1.22 min**
- Target: ≤ 15 min → **PASS ✅**

## Recovery Evidence Report
| Step | Result | Duration | Detail |
|---|:--:|--:|---|
| recreate_scratch_db | PASS ✅ | 0.7s | created homigo_dr_scratch |
| pg_restore | PASS ✅ | 9.9s | restored homigo_2026-06-25T11-10-42-927Z.dump |
| prisma_migrate_status | PASS ✅ | 5.7s | Datasource "db": PostgreSQL database "homigo_dr_scratch", schema "public" at "localhost:5433" |
| integrity_verification | PASS ✅ | 1.4s | {"bookings":"181","payments":"104","wallets":"10","hcoin_txns":"54","memberships":"28","negative_hcoin_wallets":"0","ledger_table_present":"t"} |

### Recovered row counts / invariants
| Entity | Value |
|---|---|
| bookings | 181 |
| payments | 104 |
| wallets | 10 |
| hcoin_txns | 54 |
| memberships | 28 |
| negative_hcoin_wallets | 0 |
| ledger_table_present | t |
