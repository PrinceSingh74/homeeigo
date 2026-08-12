# Finance Config Certification — HOMIGO V5

Generated: 2026-07-03T08:58:46.688Z
Verdict: **PASS**

## Schema (additive)
- `finance_config` — current CFO inputs (key/value)
- `finance_config_history` — immutable audit trail per change

## Resolution order
1. `finance_config` table (DB, authoritative)
2. Legacy env vars (`OPERATING_EXPENSE_MONTHLY`, `CASH_ON_HAND`, `PAYMENT_GATEWAY_FEE_PCT`)
3. Default gateway fee 2% only

## API
| Method | Route | RBAC |
|--------|-------|------|
| GET | `/api/admin/finance/config` | PAYMENTS:READ |
| GET | `/api/admin/finance/config/history` | PAYMENTS:READ |
| PATCH | `/api/admin/finance/config` | PAYMENTS:UPDATE |

## Runtime evidence
- Tables: finance_config=true, finance_config_history=true
- Resolve before write: opex=— (missing), cash=— (missing)
- History row: OPERATING_EXPENSE_MONTHLY null → 1
- EBITDA enabled after opex in DB: ₹4,755
- Probe value restored — no persistent test data left
- PAYMENTS:UPDATE permissions seeded: 1

## All gates passed
