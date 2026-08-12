# Playwright Execution Report

**Timestamp:** 2026-06-14T21:04:39Z – 2026-06-14T21:07:49Z  
**Spec files:** `apps/*/e2e/signoff-journey.spec.ts`  
**Evidence:** `measurements/playwright-*-signoff.log`

## Summary

| Journey | Steps | Browser Completed | Result |
|---------|-------|-------------------|--------|
| Customer | Login, Booking, Tracking | Partial (login failed) | **FAIL** |
| Partner | Login, Orders, Route Center, Completion | Partial (login timeout) | **FAIL** |
| Admin | Login, Ops Map, Heatmap, Geofence | Partial (login failed) | **FAIL** |

**Overall Playwright sign-off: FAIL** — journeys did not complete end-to-end in this environment.

---

## Customer Journey

**Config:** `E2E_SKIP_SERVERS=1`, `E2E_WEB_URL=http://localhost:3015`  
**Log:** `measurements/playwright-customer-signoff.log`

| Step | Timestamp | Result | Evidence |
|------|-----------|--------|----------|
| Login | 2026-06-14T21:07:40Z | **FAIL** — console 400 errors on resources | `playwright-customer-signoff.log` |
| Booking + checkout | — | **SKIPPED** (serial mode) | — |
| Tracking `/#tracking` | — | **SKIPPED** | — |

**Failure detail:** `monitor.assertClean()` — multiple `400 Bad Request` console errors after `loginCustomerUi`.

---

## Partner Journey

**Config:** `E2E_SKIP_SERVERS=1`, `E2E_PARTNER_URL=http://localhost:3002`  
**Log:** `measurements/playwright-partner-signoff.log`

| Step | Timestamp | Result | Evidence |
|------|-----------|--------|----------|
| Login → orders | 2026-06-14T21:07:49Z | **FAIL** — login POST timeout 60s + 500 console error | `playwright-partner-signoff.log` |
| Route center | — | **SKIPPED** | — |
| Completion tab | — | **SKIPPED** | — |

---

## Admin Journey

**Config:** `E2E_SKIP_SERVERS=1`, `E2E_ADMIN_URL=http://localhost:3003`  
**Log:** `measurements/playwright-admin-signoff.log`

| Step | Timestamp | Result | Evidence |
|------|-----------|--------|----------|
| Login → operations map | 2026-06-14T21:07:39Z | **FAIL** — `Business overview` heading not visible post-login | `playwright-admin-signoff.log` |
| Heatmap | — | **SKIPPED** | — |
| Geofence | — | **SKIPPED** | — |

**Likely causes:** API rate limiting from concurrent audit traffic; auth session not establishing on reused dev servers; port `3001` serving HTTP 500 (stale build).

---

## Environment Notes

| Port | Status | Timestamp |
|------|--------|-----------|
| 3000 backend | **200** `/health` | 2026-06-14T21:01:52Z |
| 3001 web | **500** | 2026-06-14T21:06:55Z |
| 3015 web | **200** | 2026-06-14T21:06:55Z |
| 3002 partner | **200** | 2026-06-14T21:06:55Z |
| 3003 admin | **200** | 2026-06-14T21:06:55Z |

---

## Re-run Command (clean)

```bash
# Single backend only; fresh frontends via playwright webServer (omit E2E_SKIP_SERVERS)
cd apps/web && npx playwright test e2e/signoff-journey.spec.ts
cd apps/partner-web && npx playwright test e2e/signoff-journey.spec.ts
cd apps/admin-panel && npx playwright test e2e/signoff-journey.spec.ts
```
