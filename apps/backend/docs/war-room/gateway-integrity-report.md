# Gateway Integrity Report

Generated: 2026-06-17T09:34:41.393Z

## Gateway reconciliation issues (latest 100)
- **MISSING_LOCAL**: 15
- **SETTLEMENT_MISMATCH**: 18
- **MISSING_GATEWAY**: 67

Total gateway issues in DB: **112**

## Settlement batches
Local batches: **0**
Payment-settlement links: **0**

## SQL — payments with PaymentSettlement but NULL settlement_id
```sql
SELECT p.id, p.settlement_id, ps.settlement_id AS ps_settlement
FROM payments p JOIN payment_settlements ps ON ps.payment_id = p.id
WHERE p.settlement_id IS NULL;
```
Count: **0**
