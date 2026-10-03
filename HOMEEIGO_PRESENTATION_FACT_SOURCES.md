# HOMEEIGO — PRESENTATION FACT SOURCES

Every factual claim in the presentation, its source, and its confidence.
**VERIFIED** = observed in code/schema/config/runtime · **INFERRED** = reasonable interpretation,
labelled as such on the slide · **UNVERIFIED** = excluded from the presentation entirely.

Measurement method: `grep -c`, `find | wc -l`, runtime enumeration, and read-only SQL. No figure was
estimated.

---

## Scale claims

| Claim | Source | Method | Confidence |
|---|---|---|---|
| 189 Prisma models | `apps/backend/prisma/schema.prisma` | `grep -c '^model '` | VERIFIED |
| 119 enums | same | `grep -c '^enum '` | VERIFIED |
| 5,515 schema lines | same | `wc -l` | VERIFIED |
| 94 migrations | `prisma/migrations` | directory count | VERIFIED |
| 481 `@@index`, 29 `@@unique` | schema | `grep -c` | VERIFIED |
| 587 backend TS files | `apps/backend/src` | `find -name '*.ts' \| wc -l` | VERIFIED |
| 42 route modules · 173 services · 96 test files | `src/routes`, `src/services`, `src/**/*.test.ts` | file counts | VERIFIED |
| 6 WebSocket handlers · 8 event consumers | `src/websocket`, `src/events/consumers` | file counts | VERIFIED |
| Web 28 pages/237 comps · Admin 88/80 · Partner-web 52/83 | `apps/*/src` | `find` counts | VERIFIED |
| Customer mobile 29 screens/130 comps · Partner mobile 13/31 | `homigo-mobile`, `homigo-partner-mobile` | `find` counts | VERIFIED |
| 44 Playwright specs · 8 mobile specs · 226 scripts · 3 CI workflows | repo | `find`/`ls` counts | VERIFIED |

## Technology claims

| Claim | Source | Confidence |
|---|---|---|
| Bun 1.3.14 runtime/test/build | `bun test` banner; `package.json` build script | VERIFIED |
| Elysia backend framework | `apps/backend/package.json`; `new Elysia()` in `src/index.ts` | VERIFIED |
| Next.js 15.1–15.5, React 19 | three web `package.json` files | VERIFIED |
| Expo ~54, React Native 0.81.5 | both mobile `package.json` files | VERIFIED |
| PostgreSQL 16 | `docker ps` → `postgres:16-alpine` | VERIFIED |
| Prisma 6.19.3 | `package.json` + generated client version in errors | VERIFIED |
| Redis via `lib/redis.ts` | `redisClient.isEnabled` probe returned false under NODE_ENV=test | VERIFIED |
| AWS S3 | `object-storage.service.ts` — `S3Client`, `AWS_S3_BUCKET` | VERIFIED |
| BigQuery | `@google-cloud/bigquery` + `ML.FORECAST/PREDICT/EVALUATE` | VERIFIED |
| Vertex AI | `@google-cloud/aiplatform` — `PredictionServiceClient.generateContent` | VERIFIED |
| TanStack Query, Zustand, Tailwind, Zod, Sentry | per-app `package.json` + imports | VERIFIED |
| Prometheus `/metrics` | `routes/observability.ts`; endpoint returned 200 | VERIFIED |

## Integration claims

| Claim | Source | Confidence |
|---|---|---|
| Razorpay via direct REST | `api.razorpay.com/v1/{orders,payments,fund_accounts,balance}` in services | VERIFIED |
| Razorpay webhook HMAC verified **before** parsing | `routes/payments.ts` — signature check precedes `JSON.parse` | VERIFIED |
| Google Maps | `maps.googleapis.com/maps/api`, `GOOGLE_MAPS_API_KEY` | VERIFIED |
| Twilio SMS/OTP | `twilio` dependency + `otp.service.ts`, `booking-start-otp.service.ts` | VERIFIED |
| Resend email | `RESEND_API_KEY` in `email.service.ts` | VERIFIED |
| Expo push | `push.adapter.ts`, `expo-notifications` | VERIFIED |
| OpenWeather | `weather.service.ts`, `WEATHER_API_KEY` | VERIFIED |
| 4 notification channels | `src/notifications/channels/` — email, sms, push, in-app | VERIFIED |
| 4 LLM providers, default order GROQ→GEMINI→OPENAI | `ai/config.ts` `DEFAULT_PROVIDER_ORDER` | VERIFIED |
| No LLM vendor SDK installed | backend `package.json` inspection | VERIFIED |

## AI / ML claims

| Claim | Source | Confidence |
|---|---|---|
| 55 tools — 29 READ / 12 WRITE / 14 HIGH_RISK | runtime enumeration of `TOOL_CATALOG` | VERIFIED |
| HIGH_RISK 0/14 bound under NODE_ENV=production | `registerToolHandlers` + `financialSandboxVerdict()` = `{allowed:false, reason:"PRODUCTION_ENVIRONMENT"}` | VERIFIED |
| Catalog byte-identical to freeze `7ce2e71` | `git show` category counts compared | VERIFIED |
| Surge appears in no AI module | search of `src/ai/`, `src/ai-brain/`, `src/ai-tools/` | VERIFIED |
| BigQuery ARIMA_PLUS demand model | `vertex-ai.service.ts` `infer("model_demand_forecast")`, `source: "bigquery:arima_plus"` | VERIFIED |
| Demand confidence derived from CI width, floor 0.5 | `geo-intelligence.service.ts`; live value 0.5 | VERIFIED |
| 8 geo-intel endpoints | route enumeration | VERIFIED |
| ETA / fake-GPS models exist, ETA not promoted | `model_eta`, `model_fake_gps`; ETA blocked at 0/50 labels | VERIFIED |
| ETA dataset quarantined | `is_training_eligible = false` | VERIFIED |
| 9/9 AI-tool attack cases denied, zero mutation | service-backed execution on isolated `homigo_p39` | VERIFIED |
| Vision via Gemini through Vertex | `vision-intelligence.service.ts` → `callGeminiVision` | VERIFIED |

## Automation claims

| Claim | Source | Confidence |
|---|---|---|
| 14 registered workflows | `automation/registry/definitions/*.ts` workflow-id extraction | VERIFIED |
| 18 leader-locked scheduled jobs | `grep -cE '^let .*Timer' src/lib/maintenance.ts` | VERIFIED |
| Governance chain before every send | `src/notifications/governance/` — quiet-hours, cadence, cooldown, channel-policy, containment, decision-audit | VERIFIED |
| Certification defaults to SHADOW, needs human approver | `automation/registry/certification.ts` | VERIFIED |
| Outbox + 8 consumers + DLQ | `EventOutbox` model, `events/core`, `events/consumers` | VERIFIED |

## Security claims

| Claim | Source | Confidence |
|---|---|---|
| JWT + refresh rotation with reuse detection | `jwt.service.ts`; `REFRESH_TOKEN_REUSE_ATTACK` security event | VERIFIED |
| RBAC by resource/action | `rbac.service.ts` | VERIFIED |
| Field-level PII encryption with key versions | `prisma-pii-extension.ts`; `emailEncryptionKeyVersion`, `phoneEncryptionKeyVersion`, `dataEncryptionStatus` | VERIFIED |
| Masked phone both directions | `maskPhoneForPartner` → `+91 •••• 4821`; both read paths null-guard | VERIFIED |
| Contact path fetches no email | `booking-contact.service.ts` selects only `{id, phoneNumber, phoneEncrypted}` | VERIFIED |
| Security headers on every response | live `curl -D` — CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff | VERIFIED |
| Prompt-injection screening in gateway | `ai/security/prompt-security.ts` | VERIFIED |
| Retention: financial 10y, login 2y, system logs 1y | `data-retention.service.ts` `RETENTION_DAYS` | VERIFIED |

## Data-integrity claims

| Claim | Source | Confidence |
|---|---|---|
| `booking_completed_requires_timestamp` check constraint | `pg_constraint` query; rejected a test fixture live | VERIFIED |
| `bookings_user_slot_excl` exclusion constraint | seed hit it during this audit | VERIFIED |
| Incentive idempotency `(providerId, ruleId, periodKey)` + in-tx re-check | schema `@@unique` + `partner-incentive-payout.service.ts` | VERIFIED |
| Live payout consistency ₹150 = ₹150 | read-only query: payout ↔ WalletTransaction (BONUS/COMPLETED) ↔ audit row | VERIFIED |
| 5 concurrent same-key calls → 1 row | concurrency test on isolated DB | VERIFIED |
| 2 concurrent accepts → 1 success, 1 email, 1 outbox event | same | VERIFIED |

## Engineering-quality claims

| Claim | Source | Confidence |
|---|---|---|
| Backend typecheck 0 errors | `bunx tsc --noEmit` exit 0 | VERIFIED |
| web / admin / partner-web / mobile typecheck 0 errors | `tsc --noEmit` per app | VERIFIED |
| Mobile startup regression gate PASS | `startup-regression-ci.mjs` exit 0 | VERIFIED |
| Elysia chain segmentation runtime-neutral | A/B of original vs segmented server: **80/80 routes identical** | VERIFIED |
| DB tests refuse non-isolated databases | deliberate run without override aborted; prod counts unchanged | VERIFIED |

## Claims deliberately EXCLUDED (unverifiable)

| Excluded claim | Reason |
|---|---|
| Revenue, GMV, transaction volume | No such data in repository |
| User / partner / booking counts as market metrics | Only local database rows exist; not market evidence |
| Uptime or SLA | Not measured in repository |
| Requests-per-second / concurrent-user capacity | No load-test result for the current build |
| Dispatch-efficiency or conversion improvement | No before/after measurement exists |
| Government or vendor KYC verification | No such integration present |
| Emergency-services dispatch on SOS | Not implemented |
| Live payment-gateway certification | Environment configuration; not verifiable from code |
| Current cloud deployment status | Not verified in repository |
| Grafana dashboard specifics | Dashboards live outside application code — INFERRED only |

## Corrections made during this audit (disclosed, not hidden)

| Item | Nature |
|---|---|
| Weekly/monthly earnings ×1.05 / ×1.08 | Unfounded growth factors shown to partners as "projections"; replaced with trailing actuals + basis metadata |
| `getPartnerPerformance` tool | Returned retention stats, not performance; rebound to real counters |
| Financial audit retention | Case-sensitive match dropped credit events to 1-year retention; corrected to 10-year |
| Gross/net unit mismatch | `averagePerJob` (gross) blended with net realised earnings; `averageNetPerJob` added |
| Outbox payload validator | An over-strict validator rejected legitimate `Date` values; corrected to serialization truth |
