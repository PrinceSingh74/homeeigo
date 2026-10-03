# HOMEEIGO — TECHNOLOGY AUDIT

Every technology below was confirmed by dependency manifest **plus** actual usage in source.
Libraries present in `package.json` but not imported anywhere are excluded.

Confidence: **VERIFIED** = seen in code/config · **INFERRED** = strongly implied · anything else is
marked *Not verified in repository*.

---

## 1. Runtime & backend

| Technology | Version | Where used | Why it is used | Benefit | Confidence |
|---|---|---|---|---|---|
| **Bun** | 1.3.14 | backend runtime, test runner, bundler | Single toolchain for run/test/build; `bun build --target bun` | One runtime instead of node+jest+bundler; fast test cycles | VERIFIED |
| **Elysia** | latest | `apps/backend/src` — 42 route modules | Type-safe routing with schema validation (`t.Object`) at the edge | Request validation is part of the route contract, so invalid input is rejected before handlers | VERIFIED |
| **TypeScript** | 5.x, `strict: true` | all six apps | End-to-end typing across API, web, mobile | Contract errors surface at compile time; backend typecheck gate is **0 errors** | VERIFIED |
| **Zod** | ^3.24 | schemas across backend + all web apps | Runtime validation where Elysia's schema is not the boundary | Untrusted input validated, not assumed | VERIFIED |

**Architecture pattern (verified):** `Route → Service → Transaction → Database → Outbox Event → Consumer → Notification`.
173 services under `src/services`, plus dedicated domains: `ai/`, `ai-brain/`, `ai-tools/`,
`automation/`, `events/`, `notifications/`, `websocket/`, `analytics/`.

## 2. Data layer

| Technology | Version | Usage | Why | Benefit | Confidence |
|---|---|---|---|---|---|
| **PostgreSQL 16** | postgres:16-alpine | primary store | Transactional integrity for bookings and money | ACID guarantees for financial state | VERIFIED |
| **Prisma ORM** | ^6.19.3 | 189 models, 119 enums, 5,515 schema lines, 94 migrations | Typed data access + migration history | Schema changes are reviewable and reversible | VERIFIED |
| **Redis** | via `ioredis` usage in `lib/redis.ts` | caching, leader locks, presence, feature-flag cache | Distributed coordination | Enables single-execution scheduled jobs across instances | VERIFIED |
| **BigQuery** | `@google-cloud/bigquery` ^8.3.1 | `analytics/`, `vertex-ai.service.ts` | Warehouse + BigQuery ML | ML without a separate serving stack | VERIFIED |
| **AWS S3** | `@aws-sdk/client-s3` ^3.1063 | `object-storage.service.ts` | Document/evidence storage | Durable storage off the app server | VERIFIED |

**Database integrity controls actually in the schema:**
- **481 `@@index`** declarations and **29 `@@unique`** constraints.
- **Check constraints** enforcing domain rules, e.g. `booking_completed_requires_timestamp`
  (a COMPLETED booking must carry `completed_at`) — verified by a fixture being *rejected*.
- **Exclusion constraint** `bookings_user_slot_excl` preventing overlapping bookings per user
  (a `tstzrange` GIST exclusion) — verified by a seed hitting it.

Why this matters: the database refuses invalid states even if application code has a bug. Both
constraints above rejected *test fixtures during this audit* — that is the control working.

## 3. Frontend

| Technology | Version | Apps | Why | Benefit | Confidence |
|---|---|---|---|---|---|
| **Next.js** | 15.1–15.5 | web, partner-web, admin-panel | App Router, server rendering, route-level code splitting | Fast first paint; one framework across three consoles | VERIFIED |
| **React** | 19.x | all web apps | Component model | Shared patterns across surfaces | VERIFIED |
| **TanStack Query** | ^5.64–5.100 | all web + both mobile apps | Server-state caching, refetch intervals | Live dashboards without hand-rolled polling (e.g. 60 s zone refresh) | VERIFIED |
| **Zustand** | ^4.5–5.0 | all web + both mobile | Client state | Small, predictable store; no boilerplate | VERIFIED |
| **Tailwind CSS** | ^3.4 | web apps + customer mobile | Design tokens, utility styling | Consistent design system via tokens rather than per-page CSS | VERIFIED |
| **Sentry** | ^10.56–10.58 | `@sentry/nextjs` ×3, `@sentry/bun` backend | Error tracking | Frontend + backend errors in one place | VERIFIED |

## 4. Mobile

| Technology | Version | Apps | Why | Benefit | Confidence |
|---|---|---|---|---|---|
| **React Native** | 0.81.5 | both mobile apps | Native performance, shared language with web | One TypeScript codebase family across all surfaces | VERIFIED |
| **Expo** | ~54.0 | both mobile apps | Managed build/OTA/native modules | Faster native release cycle | VERIFIED |
| **react-native-maps** | 1.20.1 | both mobile apps | Live tracking + navigation | Partner navigation and customer tracking | VERIFIED |
| **expo-notifications** | ~0.32.17 | both mobile apps | Push delivery | Job offers and status changes reach partners | VERIFIED |

**Note:** partner mobile requires a dev build (not Expo Go) because of native modules (maps,
payments, reanimated).

## 5. Real-time

| Technology | Usage | Why | Benefit | Confidence |
|---|---|---|---|---|
| **WebSockets** (Elysia native) | 6 handlers: tracking, notifications, booking, earnings, admin-ops | Push state instead of polling | Live partner location, live job state, live ops alerts | VERIFIED |
| **Transactional outbox** | `EventOutbox` model + `event-publisher.ts` | Business change and its event commit together | An event can never be lost or emitted for a rolled-back change | VERIFIED |
| **Event bus + DLQ** | `events/core`, 8 consumers | Decoupled side effects | Notification/automation failures don't fail the booking | VERIFIED |

## 6. AI / ML (detail in the AI audit)

| Technology | Usage | Confidence |
|---|---|---|
| **Groq / Gemini / OpenAI / Anthropic** | 4 LLM providers via direct HTTPS with an ordered failover chain (`AI_PROVIDER_ORDER`, default GROQ→GEMINI→OPENAI) | VERIFIED |
| **Google Vertex AI** | `@google-cloud/aiplatform` ^6.8.1 — `PredictionServiceClient.generateContent` for vision | VERIFIED |
| **BigQuery ML** | `ML.FORECAST`, `ML.PREDICT`, `ML.EVALUATE` over `model_demand_forecast`, `model_eta`, `model_fake_gps` | VERIFIED |

**No LLM vendor SDK is installed** — calls are direct HTTPS. This is a deliberate portability choice
and is why the failover chain can be provider-agnostic.

## 7. Integrations

| Category | Technology | Method | Confidence |
|---|---|---|---|
| Payments | **Razorpay** | direct REST (`/v1/orders`, `/v1/payments`, `/v1/fund_accounts`, `/v1/balance`) + HMAC webhook signature verification | VERIFIED |
| Maps/Geo | **Google Maps Platform** | `maps.googleapis.com/maps/api`, `GOOGLE_MAPS_API_KEY` | VERIFIED |
| SMS/Voice | **Twilio** | `twilio` package used in `otp.service.ts`, `booking-start-otp.service.ts` | VERIFIED |
| Email | **Resend** | `RESEND_API_KEY` in `email.service.ts` | VERIFIED |
| Push | **Expo Notifications** | `push.adapter.ts` | VERIFIED |
| Weather | **OpenWeather** | `weather.service.ts`, `WEATHER_API_KEY` | VERIFIED |
| Storage | **AWS S3** | `object-storage.service.ts` | VERIFIED |

**Environment status:** Razorpay has dedicated certification scripts
(`cert:razorpay`, `cert:razorpay:refund`). Whether the deployed environment uses live or test keys is
environment configuration — **production-key usage is not verified in repository**.

## 8. Security stack

| Control | Implementation | Confidence |
|---|---|---|
| Authentication | JWT (`jsonwebtoken`), `jwt.service.ts`, refresh-token rotation with reuse detection (`REFRESH_TOKEN_REUSE_ATTACK` audit event) | VERIFIED |
| Password hashing | `bcryptjs` | VERIFIED |
| OTP | `otp.service.ts` (Twilio delivery) | VERIFIED |
| Authorization | `rbac.service.ts` with `AdminResource`/`AdminAction`; `requireProvider()`, `requireAdminContext()` | VERIFIED |
| Rate limiting | `api-rate-limit.middleware.ts`, `rate-limit.middleware.ts` | VERIFIED |
| PII encryption | Prisma extension `prisma-pii-extension.ts`, per-field key versions, `dataEncryptionStatus` | VERIFIED |
| Masking | `maskPhone`, `maskPhoneForPartner`, `maskEmail` | VERIFIED |
| Audit trail | `audit-log.service.ts` (typed `SecurityEvent` union) + `enterprise-audit.service.ts` with retention categories | VERIFIED |
| Prompt-injection screening | `ai/security/prompt-security.ts`, applied inside the AI gateway | VERIFIED |
| Security headers | root `onRequest` → CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff (observed on live responses) | VERIFIED |

## 9. Observability

| Technology | Usage | Confidence |
|---|---|---|
| **Prometheus** | `GET /metrics` text exposition (`lib/metrics.ts`), bounded-cardinality labels | VERIFIED |
| **Grafana** | dashboards referenced in ops docs; containers on 3004–3006 | INFERRED (dashboards are outside the app code) |
| **Sentry** | 14 references in `lib/observability.ts`; frontend + backend | VERIFIED |
| **Structured logging** | `lib/logger.ts` with a governed writer (`lib/log-governance.ts`) | VERIFIED |
| Health endpoints | `/health`, `/ready`, `/metrics` (all returned 200 in live checks) | VERIFIED |

## 10. Quality engineering

| Layer | Evidence | Confidence |
|---|---|---|
| Unit + integration | **96 backend test files** run by `bun test` | VERIFIED |
| Web E2E | **44 Playwright specs** across apps | VERIFIED |
| Mobile E2E | **8 specs** across both mobile apps | VERIFIED |
| Startup certification | `homigo-mobile/scripts/startup-regression-ci.mjs` (CI gate, passing) | VERIFIED |
| Operational scripts | **226 backend scripts** (certification, audit, seeding, reconciliation) | VERIFIED |
| CI | **3 GitHub Actions workflows**; typecheck job covers backend + web + admin + partner-web + mobile | VERIFIED |

**Measured CI state at audit time:** backend `tsc --noEmit` **0 errors**; web, admin-panel,
partner-web, homigo-mobile **0 errors each**; mobile startup regression gate **PASS**.

## 11. Deployment

| Item | Evidence | Confidence |
|---|---|---|
| Container | `apps/backend/Dockerfile` | VERIFIED |
| Service unit | `deploy/homigo-backend.service` (systemd) | VERIFIED |
| Local infra | Docker Postgres 16 on 5433 (primary) and 5434 (staging) | VERIFIED |
| Cloud Run | service configuration exists from an earlier phase | INFERRED — current cloud deployment state **not verified in repository** |

## 12. Classification summary

- **INSTALLED + USED:** everything listed above.
- **INSTALLED + UNUSED / TRANSITIVE:** not enumerated; excluded from the presentation by design.
- **Deliberately absent:** LLM vendor SDKs (direct HTTPS instead), Razorpay SDK (direct REST),
  third-party KYC vendor (**none present**).
