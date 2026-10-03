# HOMEEIGO — Enterprise 2035 Security Assessment

Scope: authentication, authorization, session handling, transport hardening, secrets, payment integrity, PII. Runtime probes were read-only; no exploit was executed against data.

---

## 1. Verdict

The security posture is **materially stronger than the rest of the platform's maturity would predict**. Authentication and authorization are enforced at runtime (verified, not inferred), webhook handling is correct in a way most implementations get wrong, and the admin RBAC layer fails closed.

The exposures that matter are **environmental and operational**, not architectural: dev-only bypasses present in the working `.env`, no production secret management, and unbounded PII-bearing audit growth.

---

## 2. Verified at runtime

Unauthenticated probes against the live backend, 2026-09-21:

| Probe | Result |
|---|---|
| `GET /api/users/me` | **401** |
| `GET /api/admin/users` | **401** |
| `GET /api/bookings/upcoming` | **401** |
| `GET /api/wallet/balance` | **401** |
| `GET /api/providers/me/withdrawals` | **401** |
| `GET /api/admin/governance/ai-budgets` | **401** |
| `GET /api/admin/users` with forged `Bearer` (valid shape, bogus signature) | **401** |

Authentication is genuinely enforced. A forged JWT claiming `role: ADMIN` is rejected.

---

## 3. Authentication and session model

`src/plugins/auth.plugin.ts`

- Bearer token extracted from `Authorization`.
- **Single-query verification.** Project memory records that auth previously issued four round trips (Prisma splits nested relations); it is now one raw `LEFT JOIN` across `users`, `admin_users`, `user_auth_epochs` and an `EXISTS` against `token_blacklist`. Measured at 13,212 calls each on the 2026-09-21 load profile; the join cannot fan out because each side is keyed on a primary/unique index. This gave ~+60 % throughput and fixed the heartbeat gate.
- **Three independent revocation mechanisms**, all evaluated per request:
  1. `token_blacklist` by `jti`
  2. `user_auth_epochs` — `payload.authEpoch >= row.auth_epoch`, defaulting to epoch 0 when no row exists
  3. account state (`isActive`, `isBanned`)
- Access token 1 h, refresh 30 d (`/ready`).

Epoch-based revocation is the right design: a single row bump invalidates every outstanding token for a user without enumerating them.

**WebSocket authorization is revocable too** — project memory records `roomManager.evictUser` plus `lib/ws-eviction` hooks on reassign / reject / SUSPENDED / epoch / jti / role change, and a token-expiry sweep. Most implementations authorize a socket once at connect and never again; this one does not.

---

## 4. Admin RBAC

`src/middleware/admin-rbac.ts` + `src/lib/admin-route-permissions.ts`

- **199 explicit route→permission rules** (`{ methods, pattern, resource, action }`).
- **Fails closed** in three places: missing `requireRole` in context → 403; unmatched rule → 403; insufficient permission → 403.
- Every denial writes `ADMIN_ACCESS_DENIED` via `AuditLogService`.

### SEC-1 (P2, SECURITY) — verify RBAC rule coverage against the admin surface

199 rules cover an admin surface of 222 handlers in `admin.ts` plus ~40 in the five mounted sub-routers. The middleware denies unmatched routes, so a gap fails *safe* (a legitimate admin gets 403, not a bypass). But that makes gaps invisible until an operator hits one.

**Action:** add a CI test enumerating every admin route and asserting a matching rule exists. Project memory notes an RBAC coverage test already enforces this for admin refunds — generalise it.

---

## 5. Transport and edge hardening

`src/middleware/security.middleware.ts` sets on every response:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: <CONTENT_SECURITY_POLICY>
Permissions-Policy: geolocation=(self), microphone=(), camera=()
Strict-Transport-Security: max-age=<HSTS_MAX_AGE>; includeSubDomains; preload   [production only]
```

**CORS** (`src/index.ts`) is environment-split and correctly reasoned. Dev reflects `localhost`, `127.0.0.1` and the three RFC-1918 private ranges with any port — enough for phone/Expo/LAN testing — while *not* reflecting arbitrary public origins. Production uses a strict allowlist from `ALLOWED_ORIGINS`.

### SEC-2 (P1, SECURITY) — `ALLOWED_ORIGINS` is unset and undocumented

`ALLOWED_ORIGINS` is **absent from `.env` and from `.env.example`**, yet it is the sole input to the production CORS allowlist. Project memory records that hardcoded CORS was deliberately replaced with this env-driven list. A production deploy that forgets it will either reject every browser origin or fall through to a permissive default — both are outages or holes.

**Action:** add to `.env.example`; make `assertProductionConfig()` refuse to boot in production without it.

**Rate limiting** (`src/middleware/api-rate-limit.middleware.ts`): ~30/min unauthenticated, ~100/min authenticated, +20 % burst, 60 s window, keyed `global-api:<bucket>:<identity>`, RFC-style `X-RateLimit-*` headers, `rate_limit_triggered_total` metric. Redis-backed with an in-memory fallback (project memory records the fallback's eviction bug as fixed).

---

## 6. Payment security — a genuine strength

`src/routes/payments.ts` webhook handler:

1. **Authenticate first.** Signature verified *before* any parsing. A missing signature, an unconfigured secret **and** a bad signature all return the same `401 INVALID_SIGNATURE` — config state is never disclosed via a 503. Emits `suspicious_activity_total{kind="webhook_bad_signature"}`.
2. **Then** parse JSON (`400` on malformed).
3. **Idempotency:** `eventId = gatewayEventId ?? sha256(rawBody)`; `webhookDedupService.beginProcessing()` claims it; duplicates return `200 {ignored:true, reason:"DUPLICATE_EVENT"}`.
4. Distinct terminal outcomes: `409 PAYMENT_ID_CONFLICT`, `422` with reason, or success — each recorded via `markProcessed` / `markFailed`.
5. Sets a causation ID for event correlation.

This is textbook-correct: authenticate → parse → claim → process → record, with a content hash when the gateway supplies no event id.

**Client cannot set price.** `POST /api/bookings` accepts `serviceId`, `variantId`, `quantity`, `addonIds`, `couponCode` — **ids and quantities only**. The source carries the comment *"Selection ids + quantity only — never a price. Priced in bookingPricingService."* `packagePrice` is accepted but is a tier selector, not an amount (verify independently before production).

**Ledger integrity verified live:** global debit−credit = 0; 0 unbalanced journals of 975; 0 NULL paise; 0 orphan payments.

---

## 7. Secrets and dev bypasses

Credential state in the working `apps/backend/.env`:

| Secret | State |
|---|---|
| `JWT_SECRET` | set |
| `RAZORPAY_KEY_ID` | set — **`rzp_test_` prefix** (test mode) |
| `RAZORPAY_KEY_SECRET` / `_WEBHOOK_SECRET` | set |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_PHONE_NUMBER` | set (**real**) |
| `GOOGLE_MAPS_API_KEY`, `WEATHER_API_KEY`, `SENTRY_DSN`, `AWS_ACCESS_KEY_ID`, `GOOGLE_CLIENT_ID` | set |
| `RESEND_API_KEY`, `APPLE_CLIENT_ID` | **empty** |
| `PII_MASTER_KEY`, `OPS_AUTH_TOKEN`, `S3_BUCKET`, `GCP_PROJECT_ID` | **absent** |

### SEC-3 (P1, SECURITY) — dev bypasses are active in the working environment

| Flag | Value | Effect |
|---|---|---|
| `LOAD_TEST_MODE` | **1** | **disables the global API rate limit** |
| `HOMIGO_ALLOW_PAYMENT_MOCKS` | **1** | enables payment mock paths incl. `POST /api/payments/e2e/mock-signature` |

Both are correct for a load-test session and **catastrophic if they reach a deployed environment**. Project memory records that `ops-auth`/`payment-mocks` are gated on `APP_ENV` with `staging ≠ dev`, which is the right defence — but the flags are sitting enabled in the checked-out environment today.

**Action:** make `assertProductionConfig()` hard-fail on either flag when `APP_ENV` is not `dev`; add a pre-deploy check asserting neither appears in any non-dev env file.

### SEC-4 (P1, SECURITY) — real third-party credentials in a local `.env`

Twilio (real SMS, with `SMS_ENABLED=true`), Google Maps, Sentry, AWS and Razorpay test keys are all present in a plaintext local file. Project memory records two concrete incidents from exactly this: **real SMS sent from tests** (hitting Twilio's 50/day limit) and **chaos/test backends reporting to the production Sentry project at 100 % tracing**.

Egress barriers now exist (`src/lib/test-egress.ts`, 2026-09-20) covering BigQuery, weather, Twilio and Maps — a good remediation. But the underlying exposure remains: production-capable credentials live in a developer file with no rotation story.

**Action:** move to a secret manager for anything non-local; keep only sandbox credentials on developer machines; rotate the Twilio token given the known test-send incident.

### SEC-5 (P2, SECURITY) — `PII_MASTER_KEY` absent

PII encryption is implemented (`keyManagementService`, `migrate-user-pii-encryption`, `verify-pii-encryption`), and project memory records a real incident where a master-key mismatch made bookings unreadable (*"Unsupported state…"*), traced to a DEK wrapped with `sha256(default JWT_SECRET)`.

With `PII_MASTER_KEY` absent, the system is presumably deriving from that default again. **This must be explicit before production** — a silent default here is how the previous incident happened.

---

## 8. PII and data governance

**Encryption at rest:** user PII, addresses and provider-sensitive fields have dedicated encryption + migration + verification scripts.

**Scrubbing:** `src/events/core/pii.ts` scrubs event payloads. Project memory records a real defect and its fix — a broad phone regex rewrote 8.5 % of trace IDs; the pattern is now shield-then-scrub-then-restore and *must not* be narrowed.

**Compliance:** `ConsentRecord`, `PolicyVersion`, DSR export/delete endpoints and account-deletion flows exist. `GET /api/users/me/export` and `DELETE /api/users/me` are implemented.

### SEC-6 (P1, COMPLIANCE) — consent withdrawal is unreachable

`POST /api/compliance/consent/withdraw` and `GET /api/compliance/request/*` have **no frontend consumer** in any of the five apps. Under DPDP/GDPR a data subject must be able to withdraw consent and track a request. The capability exists; no user can reach it.

### SEC-7 (P1, DATA) — PII-bearing audit tables grow without retention

`enterprise_audit_logs` 401,690 rows / 260 MB and `assignment_audits` 173,197 / 186 MB, **never vacuumed**, no retention policy. These are precisely the tables that accumulate identifiers and behavioural history, and a "delete my data" request cannot be honoured against tables nobody is pruning.

---

## 9. Concurrency and money-race hardening

Recorded in project memory as fixed, and consistent with what the code shows:

- Payout completion in **one transaction**; wallet snapshot **measured, never derived**.
- Referral / H-Coin / transfer / gift-card / adjustment paths locked + compare-and-set.
- Booking/payment state separated onto two axes — payment events never write booking status (this previously resurrected cancelled bookings).
- Consumer idempotency by `INSERT` + `P2002` with partial unique indexes.
- `FOR NO KEY UPDATE` used on bookings (plain `FOR UPDATE` blocked FK inserts from other connections).
- Notification claim-before-send (`findUnique`-then-send let every concurrent process reach the provider).
- SERIALIZABLE page-predicate locks identified as the cause of 7.3 s p99 on booking create.

---

## 10. Findings

| ID | Severity | Class | Finding |
|---|---|---|---|
| SEC-2 | **P1** | SECURITY | `ALLOWED_ORIGINS` unset/undocumented; sole input to production CORS |
| SEC-3 | **P1** | SECURITY | `LOAD_TEST_MODE=1` (rate limit off) + `HOMIGO_ALLOW_PAYMENT_MOCKS=1` active in working env |
| SEC-4 | **P1** | SECURITY | Real Twilio/Maps/Sentry/AWS credentials in plaintext `.env`; two prior leak incidents |
| SEC-6 | **P1** | COMPLIANCE | Consent withdrawal + DSR status unreachable from any client |
| SEC-7 | **P1** | DATA | 575k PII-bearing audit rows, no retention, never vacuumed |
| SEC-1 | P2 | SECURITY | No CI assertion that every admin route has an RBAC rule |
| SEC-5 | P2 | SECURITY | `PII_MASTER_KEY` absent — silent default derivation caused a prior incident |
| SEC-8 | P3 | SECURITY | `TRUST_PROXY` unset — client IP for rate limiting will be the proxy's behind a load balancer |

### Strengths worth preserving

- Runtime-verified 401 enforcement incl. forged-JWT rejection
- Three-mechanism token revocation with epoch bump
- Revocable WebSocket room grants
- Fail-closed admin RBAC with audited denials
- Webhook: authenticate-before-parse, content-hash idempotency, no config disclosure
- Server-authoritative pricing — client sends ids and quantities only
- Perfectly balanced double-entry ledger (975 journals, zero drift)
- Environment-split CORS that supports LAN dev without reflecting public origins
- Test-egress barriers added after two real incidents
