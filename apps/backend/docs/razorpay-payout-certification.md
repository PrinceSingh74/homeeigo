# Real Razorpay Payout Certification

**Executed:** 2026-06-12T17:20:00.000Z  
**Run ID:** `rzp-payout-mqb6tvoi` (final validation run)  
**Overall:** **NOT PROVEN**

## Repository Audit

| Location | `RAZORPAY_ACCOUNT_NUMBER` | Notes |
|----------|----------------------------|-------|
| `apps/backend/.env` | **Set** → `245205000637` | Single source of truth for local/dev |
| `apps/backend/.env.production` | **Created** with account number | Gitignored; production secrets from secret manager |
| `apps/backend/.env.example` | Documented (empty placeholder) | Template only |
| `.env.example` (root) | Documented (empty placeholder) | Template only |
| `apps/backend/src/services/razorpay.service.ts` | Reads `process.env.RAZORPAY_ACCOUNT_NUMBER` | Used in composite payout `account_number` field |
| `scripts/enterprise/razorpay-payout-certification.ts` | Validates env before execution | Pre-flight gate |
| `src/lib/production-config.ts` | Required in production | Boot guard |
| `docs/STAGING_DEPLOY_CHECKLIST.md` | Documented | Deployment reference |
| Docker / CI (`.github/workflows/e2e.yml`) | **Not set** (intentional) | CI uses dev-mock; no live payouts in CI |

**Conflicting values:** None found in codebase. No hardcoded RazorpayX account numbers.

**Other `account_number` usages:** Provider/withdrawal bank fields only (beneficiary accounts, not RazorpayX source account).

## Configuration Applied

```
RAZORPAY_ACCOUNT_NUMBER=245205000637
```

Updated in: `.env`, `.env.production` (created), `.env.example`, root `.env.example`, staging checklist, production boot validation.

## Pre-Flight Validation (Executed)

| Check | Verdict | Detail |
|-------|---------|--------|
| Razorpay credentials | **PASS** | `rzp_test_*` keys present; balance API OK (`balancePaise=1099740`) |
| RazorpayX account number | **PASS** | `245205000637` loaded from env |
| Fund accounts API | **PASS** | `GET /v1/fund_accounts` → 200 |
| Contacts API | **PASS** | `POST /v1/contacts` → 201 (contact created during probe) |
| Fund account create | **PASS** | `POST /v1/fund_accounts` → 201 |
| **Payouts API** | **FAIL** | `GET /v1/payouts?count=1` → **400** `Access to requested resource not available` |
| Live payout create | **NOT PROVEN** | `POST /v1/payouts` → **400** `The requested URL was not found on the server` |

**Execution stopped before payouts** — pre-flight gate blocked as required.

## Homigo Workflow (Partial — Blocked at Execute)

| Step | Verdict | Evidence |
|------|---------|----------|
| Create payout batch | **PASS** | Batch `cmqb6twuj0002tz2kkb8mkeui` created |
| Submit for review | **PASS** | Status → UNDER_REVIEW |
| Approve batch (maker-checker) | **PASS** | Finance approver `finance-approver@homigo.demo` |
| Execute payout (Razorpay API) | **FAIL** | No `razorpayPayoutId`; Razorpay payouts endpoint unavailable |

## Financial Integrity (Not Executed)

| Gate | Result |
|------|--------|
| 10 real payouts | **NOT PROVEN** — blocked |
| Duplicate payouts | N/A |
| Orphan payouts | N/A |
| Settlement drift | N/A |
| Ledger drift | N/A |

## Root Cause

Configuration is **correct** (`RAZORPAY_ACCOUNT_NUMBER=245205000637`). The Razorpay **test-mode merchant account does not have the Payouts API enabled**:

- Contacts and fund accounts work (RazorpayX partially active)
- Payouts list/create return **400 Access not available**

## Required to Achieve PASS

1. Enable **RazorpayX Payouts** on the merchant account in Razorpay Dashboard (or switch to **live keys** with payouts activated)
2. Confirm `245205000637` matches Dashboard → RazorpayX → Account Details
3. Re-run:
   ```bash
   cd apps/backend
   bun --env-file=.env run scripts/enterprise/razorpay-payout-certification.ts
   ```

## Verdict

**NOT PROVEN** — Account number configured and validated for env/fund-account APIs, but **zero live payouts executed** because Razorpay blocked the payouts API on the current test merchant.
