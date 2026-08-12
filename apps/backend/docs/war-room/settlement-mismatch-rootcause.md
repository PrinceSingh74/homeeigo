# Settlement Mismatch Root Cause

Generated: 2026-06-17T09:34:41.332Z

## Root Cause Summary

The reconciliation engine flags **SETTLEMENT_MISMATCH** when:
`SUCCESS payments with settlement_id IS NULL AND completed_at < now() - 3 days`

### Critical engine bugs identified:
1. **Aggregate issue inflation** — one issue row per daily run ("N payments unsettled") instead of per-payment dedup → inflates local issue count to 100+
2. **completed_at NULL blind spot** — payments with NULL completed_at are excluded from the >3d check but still unsettled
3. **settlement_id not backfilled** — PaymentSettlement rows may exist while payment.settlement_id remains NULL
4. **Settlement sync not scheduled in dev** — without RAZORPAY_KEY_ID or webhooks, settlements never link

## Unsettled SUCCESS payments (evidence)
Total unsettled (settlement_id IS NULL): **63**

| Payment ID | Booking | Amount | RZP Payment | Has PaymentSettlement | Days | Root Cause |
|------------|---------|-------:|-------------|----------------------:|-----:|------------|
| cmq6ukek… | cmq6ukek… | ₹500 | pay_adv_adv- | false | 7 | MISSING_SETTLEMENT |
| cmq928i2… | cmq928hi… | ₹550 | pay_T0D5YQv5 | false | 6 | MISSING_SETTLEMENT |
| cmq93gyh… | cmq93gxj… | ₹550 | pay_T0DeQ1f5 | false | 6 | MISSING_SETTLEMENT |
| cmq946ca… | cmq946bm… | ₹550 | pay_T0DzHYHg | false | 6 | MISSING_SETTLEMENT |
| cmq94i67… | cmq94i5i… | ₹550 | pay_T0E8zTnQ | false | 6 | MISSING_SETTLEMENT |
| cmq94q49… | cmq94q31… | ₹989 | pay_T0EFTvuF | false | 6 | MISSING_SETTLEMENT |
| cmq95rzr… | cmq95ryd… | ₹550 | pay_T0EkdXps | false | 6 | MISSING_SETTLEMENT |
| cmq969ee… | cmq969d8… | ₹550 | pay_T0Eyy8Xb | false | 6 | MISSING_SETTLEMENT |
| cmq96c8d… | cmq96c7f… | ₹550 | pay_T0F1CPzS | false | 6 | MISSING_SETTLEMENT |
| cmq96fau… | cmq96f9t… | ₹550 | pay_T0F3nos7 | false | 6 | MISSING_SETTLEMENT |
| cmq9778r… | cmq9777r… | ₹550 | pay_T0FQidyI | false | 6 | MISSING_SETTLEMENT |
| cmq97blf… | cmq97bjx… | ₹550 | pay_T0FUG7BO | false | 6 | MISSING_SETTLEMENT |
| cmqaib51… | cmqaib4b… | ₹439 | pay_T0btnNUS | false | 5 | MISSING_SETTLEMENT |
| cmqair89… | cmqair7r… | ₹439 | pay_T0c6yZn2 | false | 5 | MISSING_SETTLEMENT |
| cmqajxqh… | cmqajxq0… | ₹494 | pay_T0cfrTKC | false | 5 | MISSING_SETTLEMENT |
| cmqak3dl… | cmqak3cu… | ₹439 | pay_T0ckoHr3 | false | 5 | MISSING_SETTLEMENT |
| cmqak7se… | cmqak7rq… | ₹494 | pay_T0co4mJ5 | false | 5 | MISSING_SETTLEMENT |
| cmqaksg1… | cmqakscw… | ₹494 | pay_T0d53W8I | false | 5 | MISSING_SETTLEMENT |
| cmqaku3u… | cmqaku2z… | ₹494 | pay_T0d6VR1c | false | 5 | MISSING_SETTLEMENT |
| cmqakxfx… | cmqakxes… | ₹494 | pay_T0d9C33J | false | 5 | MISSING_SETTLEMENT |
| cmqal8up… | cmqal8tp… | ₹494 | pay_T0dIbWjd | false | 5 | MISSING_SETTLEMENT |
| cmqale4h… | cmqale3k… | ₹494 | pay_T0dMtehi | false | 5 | MISSING_SETTLEMENT |
| cmqaqnxc… | cmqaqnve… | ₹494 | pay_T0fsrMw1 | false | 4 | MISSING_SETTLEMENT |
| cmqaqryr… | cmqaqrxc… | ₹494 | pay_T0fw4JxL | false | 4 | MISSING_SETTLEMENT |
| cmqat6ol… | cmqat6nz… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |
| cmqat9df… | cmqat9cr… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |
| cmqata7o… | cmqata77… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |
| cmqatart… | cmqatarb… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |
| cmqatb4y… | cmqatb4d… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |
| cmqatgon… | cmqatgm9… | ₹550 | pay_e2e_mqat | false | 4 | MISSING_SETTLEMENT |

## Reconciliation issue records (SETTLEMENT_MISMATCH)
- 2026-06-17T09:25:52.501Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:51.554Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:49.552Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:48.042Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:40.955Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:39.825Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:25:34.035Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:44.828Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:44.630Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:44.463Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:44.302Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:44.051Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:43.719Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:43.537Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:43.332Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:43.092Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:42.276Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:41.332Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:40.371Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
- 2026-06-17T09:14:39.291Z: 49 SUCCESS payments unsettled >3 days (run match 66.67%)
