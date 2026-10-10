# Phase 7 — Backup, security, and integrations (closed)

**Status: CLOSED 2026-10-10.** Owner: project owner (HOMEEIGO). Isolated write target only (`homigo_test` dump → `homigo_phase7_scratch` restore; live probes against `http://127.0.0.1:3100` with `isolatedDatabase: true`). Did **not** write `homigo_db`, `homigo_staging_db`, or production. Did **not** enable `HOMIGO_REQUIRE_SMS|EMAIL|PUSH|MAPS|AI`. Did **not** send live SMS/email/push or spend Google Maps / model-provider quota.

Companion JSON:

- `docs/phase-7-restore-evidence.json`
- `docs/phase-7-security-integrations-evidence.json`
- `docs/phase-7-outbox-evidence.json`
- `docs/phase-7-exit-gate.json`

---

## Exit gate

| Gate | Result |
|---|---|
| Restore demonstrated | **PASS** — dump `homigo_test` (8,061,175 bytes) → `homigo_phase7_scratch`; row counts identical; gold booking identical; ledger debit = credit = **41,396,550 paise** |
| Critical security issue | **PASS** — no critical CVE remaining on web / partner-web / admin production audits after Next **15.5.27** + axios **1.20.0** |
| Required launch integrations verified | **PASS for fail-closed + HMAC + RBAC + files + rate limit + AI timeout/error.** Live email/SMS/push/maps/model **EXTERNAL** (no `HOMIGO_REQUIRE_*=1`) |
| Unresolved risks documented with owner + decision | **PASS** — table below |

---

## 1. Backup & recovery

Drill: `BACKUP_DOCKER_CONTAINER=homigo-postgres bun --env-file=.env.test scripts/phase-7-restore-drill.ts`

| Item | Value |
|---|---|
| Source | `localhost:5433/homigo_test` |
| Scratch | `homigo_phase7_scratch` (refused `homigo_db` / `homigo_staging_db`) |
| Dump | `apps/backend/backups/homigo_test_phase7_2026-10-10T08-42-28-145Z.dump` |
| SHA-256 | `baa4cbc7af6e6737…` (full digest in JSON) |
| RTO | 35.74 s (`pg_restore` exit 0) |
| Counts | users 382, bookings 691, payments 140, journal_entries 629, ledger_entries 1424, earnings 163, notifications 5309, support_tickets 5 — **zero drift** |
| Gold | `cmv20qxxz00b4tzp8muuuj8d6` / `HOMIGO-20261010-00011` / COMPLETED / SUCCESS / ₹439 / provider `cmv209qyj001ytzpcu9pj5q4y` — **source = restored** |
| Ledger | debit 41396550 = credit 41396550 paise on both databases |

---

## 2. Security (live isolated API + suites)

Isolated API `http://127.0.0.1:3100`, `isolatedDatabase: true`.

| Control | Evidence |
|---|---|
| Webhook HMAC | Forged signature **401 `INVALID_SIGNATURE`**. Missing signature **401**. Replay/dedup suite PASS |
| RBAC / IDOR | Customer **403** and partner **403** on `/api/admin/bookings/:gold`. Admin **200**. Partner may read gold as assignee (**200**, expected). `release-idor-rbac` + admin RBAC coverage PASS after DEK unwrap aligned |
| File access | Path traversal and forged rating name **404**. Unauthenticated PNG upload **401**. Chargeback evidence tokens: unknown / wrong admin / replay / expiry refused |
| Rate limits | Dummy login flood **429** (auth burst; Redis disabled on isolated → in-memory limiter) |
| Secrets in git | Tracked env files are **examples only** |
| Production mocks | `unsafeBypassErrors()` + staging-dev-affordances + production-config suites PASS. Isolated process may carry local `.env` names; deployed hosts refuse `LOAD_TEST_MODE`, `HOMIGO_ALLOW_PAYMENT_MOCKS`, AI bypasses |
| Dependency scan | Next pinned **15.5.27** (GHSA-p293-qw3h-jr36 Windows RCE and follow-on 15.5 patches). Axios **1.20.0**. **0 critical** on `--omit=dev` for web / partner / admin |

Focused bun tests (after copying crypto key **names** into gitignored `.env.test` so bun test unwraps the same DEK as the isolated API): **56 pass / 0 fail** across IDOR, chargeback access, notification isolation, security-hardening, AI gateway, rating photos.

---

## 3. AI / automation / notifications

| Integration | Verdict | Why |
|---|---|---|
| AI Assistant | **PASS (fail-closed)** | Unauth **401**. Safe prompt **200** `deterministic_fallback` (162–700 ms, no live model). Injection **400 `PROMPT_BLOCKED`**. Prompt screen now runs **before** the unconfigured short-circuit (`apps/backend/src/routes/ai.ts`) |
| Email | **EXTERNAL** | `HOMIGO_REQUIRE_EMAIL` unset. Preferences: EMAIL `provider_not_configured`. `/ready` email.configured false. Owner: do not send to demo mailboxes |
| SMS | **EXTERNAL** | `HOMIGO_REQUIRE_SMS` unset. Preferences: SMS `provider_not_configured`. `/ready` may show Twilio **presence**; liveProviderAllowed still blocks send |
| Push | **EXTERNAL** | `HOMIGO_REQUIRE_PUSH` unset. PUSH `no_registered_device` |
| Maps | **PASS (fail-closed) / live Google EXTERNAL** | Unauth `/api/geo/config` **401**. `mapsConfigured: false`. Reverse geocode `available: false`. No Google call |
| In-app notifications | **PASS** | Gold booking has **5** in-app rows. Notification failure isolation suite PASS (business op still commits) |
| Outbox | **PASS (processor) / live drain EXTERNAL on this process** | Isolated `:3100` started with `EVENTS_OUTBOX_ENABLED=false` and `EVENTS_CONSUMERS_ENABLED=false` → `/ready` events **consistent** (not publish-without-delivery). `outbox-consumers-disabled` suite PASS. Leftover PENDING on `homigo_test` is observational (ops alerts, eligibility, etc.) — **do not enable consumers on redis-disabled isolated stack in this phase** |

---

## 4. Owner decisions (binding)

1. **Do not enable `HOMIGO_REQUIRE_*`** against demo numbers / mailboxes. Live delivery stays EXTERNAL until a permitted integration window.
2. **Do not drain leftover outbox** on isolated `:3100` (events off + redis disabled). Processor correctness is proven by tests.
3. **Pin Next 15.5.x, do not jump to 16**, do not `npm audit fix --force`. Residual **high** findings are nested toolchain (Sentry `brace-expansion`, Next nested `postcss`/`sharp`, `nanoid`/`browserslist`/`fast-uri`). Owner accepts those as non-critical for this gate.
4. **Copy crypto key names into gitignored `.env.test`** so bun test and isolated API share the same DEK unwrap. Do not rotate keys. Do not print values.
5. Isolated Next UIs `:3011` / `:3016` / `:3013` were **stopped** to unlock `node_modules` for the Next pin. Isolated API `:3100` remains the Phase 7 witness.

---

## Residual (explicit, not reopen)

- Native device push: still Phase 6 `EXTERNAL_BLOCKED` (`adb` empty).
- GCP / production backup: not this path. Local docker restore is the available drill.
- Nested npm **high** (not critical) as in decision 3.
- Isolated `/ready` SMS `configured: true` is credential **presence**, not a live send.
- Probe process may inherit developer `.env` flag **names**; isolated server is started with `.env.test` overlay and still 429s login floods.

Phase 8 is **not** started.
