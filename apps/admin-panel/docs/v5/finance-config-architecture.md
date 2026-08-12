# Finance Config Architecture — HOMIGO V5

## Problem
EBITDA, burn rate, cash runway and profit forecast require **non-transactional CFO inputs** (monthly opex, cash on hand) that do not exist in payment/ledger tables. Env vars worked for bootstrap but lack audit trail, UI, history, and RBAC.

## Solution (additive)
Two new tables — no changes to existing finance schema:

| Table | Purpose |
|-------|---------|
| `finance_config` | Current authoritative values (one row per key) |
| `finance_config_history` | Immutable append-only audit trail |

Migration: `20260703140000_finance_config`

## Config keys
| Key | Enables |
|-----|---------|
| `OPERATING_EXPENSE_MONTHLY` | EBITDA, burn rate, profit forecast |
| `CASH_ON_HAND` | Cash runway |
| `PAYMENT_GATEWAY_FEE_PCT` | COGS gateway fees (default 2% if unset) |

## Resolution order (no fake values)
```
finance_config (DB)  →  legacy env var  →  default (gateway fee only)
```
If still missing → dependent metric is `null` + `missingInputs[]` populated.

## Service layer
- `finance-config.service.ts` — resolve, getAll, update, getHistory
- `finance-intelligence.service.ts` — reads via `financeConfigService.resolve()` (async)
- Every `update()` writes history + `AuditLogService.success("ADMIN_ACTION", { action: "FINANCE_CONFIG_UPDATED" })`

## API (additive)
| Method | Route | RBAC |
|--------|-------|------|
| GET | `/api/admin/finance/config` | PAYMENTS:READ |
| GET | `/api/admin/finance/config/history` | PAYMENTS:READ |
| PATCH | `/api/admin/finance/config` | PAYMENTS:UPDATE |

Body: `{ key, value, reason? }`

`FINANCE_ADMIN` role seeded with `PAYMENTS:UPDATE` via `rbacService.syncDefaultRolePermissions()`.

## Prometheus
Gauges (sampled in `finance-intelligence-metrics.ts`):
- `fin_config_opex_monthly_inr`, `fin_config_cash_on_hand_inr`, `fin_config_gateway_fee_pct`
- `fin_config_opex_source_db`, `fin_config_cash_source_db` (1=DB, 0=env/missing)

Intelligence gauges (`fin_ebitda_inr`, `fin_monthly_burn_inr`, etc.) activate when config resolves.

## Admin UI
- **Finance HQ** (`FinanceHqDashboard`) — live intelligence tiles + link to config
- **CFO Config** (`/finance/config`) — edit values, view history, live EBITDA/burn/runway preview
- Nav: Finance HQ → **CFO Config**

Executive HQ + Investor Dashboard read the same `/api/admin/finance/intelligence` endpoint.

## Certification
```bash
cd apps/backend
npm run cert:finance-config
npm run cert:finance-intelligence
```

## Backward compatibility
- Env vars remain as fallback until CFO migrates values into DB
- No existing routes, tables, or APIs removed
- No fabricated defaults for opex/cash
