# Stage D Pre-Flight Checklist

| # | Gate | Criterion | Status |
|---|------|-----------|--------|
| 1 | Step 7 schema | PHASE_0_SCHEMA_CERTIFICATION=PASS | |
| 2 | Staging DB | homigo-staging-step6a-pitr-20260803 | |
| 3 | Cloud Run revision | Serving healthy /health /ready | |
| 4 | Backups / PITR / deletion protection | ON | |
| 5 | Events baseline | OFF before Stage D deploy | |
| 6 | Stage D commit | 95fbb69 includes STAGING_EVENTS_CERTIFICATION opt-in | |
| 7 | Razorpay | rzp_test_* (payment gate) | |

**STAGE_D_COMMIT_SHA:** `95fbb69721b673a0634cb01e6e5bc282f6cdb36f`

**APPLICATION_RC_SHA (unchanged):** `e459175c72b1ece6e6246e5d69f559f23cd0a23e`
