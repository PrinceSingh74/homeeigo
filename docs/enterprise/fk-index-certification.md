# Foreign-Key Index Remediation — Certification (REMEDIATION PHASE 3)

**Date:** 2026-06-18 · **Finding addressed:** 13 foreign keys lacked covering indexes (slow joins + slow FK-constraint checks on cascade delete at scale).

## Before → after (live SQL)
| Metric | Before | After |
|--------|--------|-------|
| FKs without covering index | **13** | **0** ✅ |
| New FK indexes present | 0 | **13** |

## EXPLAIN ANALYZE proof (executed on 200k-row table)
Injected 200,000 rows into `otps`, then ran the same lookup before vs after the index:

| | Plan | Execution time |
|--|------|----------------|
| **Before** | `Parallel Seq Scan on otps` | **13.185 ms** |
| **After** | `Index Scan using otps_user_id_idx` | **0.139 ms** |

**≈ 95× faster.** Synthetic rows cleaned up; index retained.

## Indexes created (Prisma naming convention `{table}_{column}_idx`)
```
otps_user_id_idx                              activity_logs_booking_id_idx
bookings_address_id_idx                       bookings_service_id_idx
compliance_request_audits_actor_id_idx        coupon_usages_booking_id_idx
fraud_alerts_commission_id_idx                fraud_alerts_referral_transaction_id_idx
gift_card_redemption_attempts_gift_card_id_idx  payment_settlements_settlement_batch_id_idx
refresh_tokens_parent_token_id_idx            support_tickets_booking_id_idx
user_subscriptions_plan_id_idx
```

## Schema sync (no drift)
Added matching `@@index([...])` to all 13 Prisma models in `prisma/schema.prisma`
(`prisma validate` → **valid**). `prisma migrate diff` between schema and live DB shows
**none of the 13 indexes** in the diff → schema and database **agree** (in sync). *(The diff
surfaced some pre-existing, unrelated index drift — left untouched, not part of this mission.)*

## Verdict
**PASS** — all 13 FK indexes created, EXPLAIN ANALYZE proves 95× lookup speedup at volume,
schema synchronized, **0 unindexed FKs remain**.
