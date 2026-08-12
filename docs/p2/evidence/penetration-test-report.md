# Evidence — Penetration Test Report (Live Execution)

**Generated:** 2026-06-08T17:44:53Z  
**Target:** `http://localhost:3000` (live backend)  
**Credentials:** `customer@homigo.demo` / `partner@homigo.demo` (Homigo@123)  
**Exit code:** 1 (5 VULNERABLE findings)

## Executive Summary

16 probes executed against a **running** API. **10 SECURE**, **5 VULNERABLE**, **1 NOT VERIFIED**. Worst open severity: **CRITICAL** (webhook signature handling).

## Risk Matrix

| ID | Category | Title | Severity | Status | Risk | Impact |
|---|---|---|:--:|:--:|---|---|
| WH-1 | Webhook | No signature rejected | CRITICAL | ❌ VULNERABLE | Forged payment webhooks | Fraudulent payment capture |
| WH-2 | Webhook | Bad signature rejected | CRITICAL | ❌ VULNERABLE | Same | Financial integrity breach |
| CORS-1 | Misconfig | Origin reflection + credentials | HIGH | ❌ VULNERABLE | Cross-origin token theft | Account compromise |
| SEC-HDR-2 | Misconfig | No clickjacking protection | MEDIUM | ❌ VULNERABLE | UI redress | Session hijack via iframe |
| SEC-HDR-1 | Misconfig | No X-Content-Type-Options | LOW | ❌ VULNERABLE | MIME sniffing | XSS amplification |
| JWT-NONE | JWT | alg=none rejected | CRITICAL | ✅ SECURE | — | — |
| PRIV-1 | Priv-esc | Admin blocked for customer | CRITICAL | ✅ SECURE | — | — |
| RL-1 | Abuse | Auth rate limited | HIGH | ✅ SECURE | — | — |

## Remediation (VULNERABLE only)

| ID | Evidence | Fix |
|---|---|---|
| WH-1/2 | Webhook returns **503** not 401/400 | Return 401 when `RAZORPAY_WEBHOOK_SECRET` unset or signature invalid; never process body |
| CORS-1 | `ACAO=https://evil.example` + `ACAC=true` | Allowlist `FRONTEND_URL`/`PARTNER_WEB_URL`; disable credentials for unknown origins |
| SEC-HDR-1 | `x-content-type-options` absent | Enable `securityHeadersPlugin` nosniff |
| SEC-HDR-2 | XFO/CSP absent | Add `X-Frame-Options: DENY` |

## NOT VERIFIED

- **IDOR-1:** needs `PENTEST_B_BOOKING_ID` (no bookings in DB — count=0)

Full machine-readable output: `pentest.json`
