# Local Finance Anomalies

Generated: 2026-06-17T09:34:41.356Z

## Issue classification (latest 200 reconciliation issues)
- **SETTLEMENT_PENDING**: 200

Total reconciliation issues in DB: **480**

## SQL — amount mismatches
```sql
SELECT id, amount, amount_paid, status, razorpay_payment_id FROM payments
WHERE status = 'SUCCESS' AND amount_paid != amount;
```
```json
[]
```

## SQL — SUCCESS without journal
```sql
SELECT p.id FROM payments p
WHERE p.status = 'SUCCESS'
  AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_id = p.id AND je.reference_type = 'payment');
```
Count: **0**
