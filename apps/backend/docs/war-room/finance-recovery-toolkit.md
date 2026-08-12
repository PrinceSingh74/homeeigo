# Finance Recovery Toolkit

## Scripts

| Script | Purpose | Modes |
|--------|---------|-------|
| `scripts/recovery/repair-settlement-mismatch.ts` | Backfill settlement_id, purge stale issues, sync Razorpay, rerun recon | `--dry-run`, `--apply`, `--rollback` |
| `scripts/recovery/reconcile-ledger.ts` | Ledger backfill + liability reconciliation | apply |
| `scripts/recovery/validate-financial-integrity.ts` | Read-only post-repair validation | read-only |
| `scripts/war-room/payment-forensic-audit.ts` | Phases 1-4 forensic reports | read-only |
| `scripts/war-room/finance-war-room-certify.ts` | Final PASS/FAIL certification | read-only |

## Repair settlement mismatch

```bash
cd apps/backend
bun --env-file=.env run scripts/recovery/repair-settlement-mismatch.ts --dry-run
bun --env-file=.env run scripts/recovery/repair-settlement-mismatch.ts --apply
```

Actions performed on apply:
1. Backfill `payments.settlement_id` from `payment_settlements`
2. Backfill `payments.completed_at` from `created_at` where NULL
3. Purge aggregate stale `reconciliation_issues` (no reference_id)
4. Run `settlementSyncService.runSync()` against Razorpay API
5. Rerun `paymentReconciliationService.runDailyReconciliation()`

All mutations are audit-logged to stdout. Idempotent — safe to re-run.
