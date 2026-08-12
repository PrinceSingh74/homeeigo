# Payment Command Center UI

## Location

`apps/admin-panel/src/app/(console)/finance/reconciliation/page.tsx`

## Executive cards

- Total revenue
- Matched payments (settled / total)
- Match rate %
- Settlement pending (in grace window)
- Local issues (critical types only)
- Integrity score

## Table features

- Sticky-style card headers with dark theme
- Status badges (MATCHED, SETTLEMENT_PENDING, SETTLEMENT_MISMATCH, etc.)
- Search + type filter on local issues
- Pagination (10 per page)
- CSV export for local issues
- No overlapping text — zebra rows via `DataTable` hover states

## Actions

- **Gateway sync** — triggers Razorpay gateway reconciliation
- **Run local** — triggers rebuilt payment reconciliation engine
