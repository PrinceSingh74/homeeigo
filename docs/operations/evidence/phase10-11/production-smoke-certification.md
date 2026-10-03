# Production smoke — 2026-09-27 (live backend `http://127.0.0.1:3000`, read-only; status note 2026-09-29 at the end)

Only demo accounts (`*@homigo.demo`, now INFERRED_SYNTHETIC) and GET/login calls were used; logging in writes session/refresh rows only. No booking, payment, refund or config was created or changed by this smoke.

## Authenticated flows — `scripts/probe-authenticated-flows.ts`: 19/19 PASS

customer login · own profile · own upcoming bookings · own wallet · customer REFUSED admin dashboard (403) · customer REFUSED partner earnings (403) · foreign booking 404 · refresh issues a new token · refreshed token authenticates · replay inside 20 s grace answers with the successor · replay after grace REFUSED (401) · partner login · partner earnings · partner REFUSED admin dashboard · admin login · admin dashboard · admin analytics · admin finance/refunds · admin governance/ai-budgets.

## GET sweep — `scripts/sweep-authenticated-gets.ts`: 310 parameter-free routes as their owning role

- 5xx / no response: **1–2 across two runs**, both explained: `GET /api/admin/cases` → **503 `CASES_UNAVAILABLE` "Cases are not deployed on this database"** — the designed pre-OP-9 answer (the table is absent on live until the owner runs `migrate deploy`); the second run's extra entry was a transient no-response on one intelligence route while the full regression suite was loading the same machine.
- 400s are parameter-requiring routes answering validation errors as designed (geo/eta/quote need coordinates); 404s on `/api/providers/me/intel/*` for the demo partner are "no intel data for this provider yet", not route errors.

## New domains as live sees them today (admin token)

| Endpoint | Status | Meaning |
|---|---|---|
| `GET /api/admin/bookings/:id/quality` (recent COMPLETED booking) | 200 `enforced:false, latest:null` | verdict table absent → honest "not deployed"; completion path falls back to the pre-§10 behaviour |
| `GET /api/admin/bookings/:id/matching-diagnostics` | 200 `serviceCapabilityMode: LEGACY_FALLBACK`, 71.7 ms | canonical matcher runs on live; strict OFF as documented |
| `GET /api/admin/cases` | 503 `CASES_UNAVAILABLE` | table absent (OP-9) |
| `GET /api/admin/providers/:id/capabilities` | 200 (0 typed services for the sampled provider) | capability tables ARE present on live (see live-closure-run.md discrepancy) |
| `GET /api/admin/customer-policy/decisions` | 200 `deployed:false` | table absent (OP-9); refusals still enforced, decisions unrecorded (counter `customer_policy_decision_unrecorded_total`) |
| `GET /health` | 200 | backend up |

## What could not be smoked live, and why

- Booking → payment → matching → execution → completion on LIVE: not executed. It would create real bookings that dispatch to real partners and move real money; the same flows are runtime-verified end to end on the isolated stack (`p10-s10-s11-p11-closure.md`, §27 of the certification) and by the browser run. Classified: LIVE-VERIFIED for read paths + auth + matching diagnostics; ISOLATED-VERIFIED for mutating flows.
- Mobile clients (as of 2026-09-27): `adb devices` empty, no emulator binary, so no runtime run. **Superseded 2026-09-28/29:** an emulator was set up and both apps were driven end to end against an ISOLATED backend (:3100 on `homigo_test`) — see §24 of the certification. That is ISOLATED device evidence, not live: no mobile client has been run against the live backend, and the owner's physical phone was listed by adb as *unauthorized* and was not touched.

## 2026-09-29 — live smoke not re-run

The owner's backend on :3000 is not running (read-only verifier at 00:34 IST: "backend not reachable"), so the authenticated-flow probe and the GET sweep above were not repeated; their results are the 2026-09-27 state of the code then deployed. Backend changes made since (capability provenance inheritance, `?mode=` preview, partner access and privacy fixes, push-token handling, refresh-token logout unlinking the device) are ISOLATED-verified by the full regression and reach live only when the owner restarts the backend on the current code. Re-run after that restart: `bun run scripts/probe-authenticated-flows.ts` and `bun run scripts/sweep-authenticated-gets.ts` against `http://127.0.0.1:3000`.

## Live customer web — axe as the demo customer (`http://localhost:3001`, 2026-09-27)

| Page | Before | After the two fixes |
|---|---|---|
| `/` | 1 serious (`aria-prohibited-attr`, map container) | 0 |
| `/services` | 0 | 0 |
| `/bookings` | 0 serious (2 minor/moderate) | 0 serious |
| `/profile` | 1 serious (`color-contrast` ×2: success toast, active nav link) | 0 serious (2 moderate landmark findings remain) |

Console: the one known 404 asset only. Read-only against live data; the fixes are frontend token/attribute changes (`globals.css`, `AppProviders.tsx`, `Navbar.tsx`, `LiveTrackingMap.tsx`), `tsc` clean.
