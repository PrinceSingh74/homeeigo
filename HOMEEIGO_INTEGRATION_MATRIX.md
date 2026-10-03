# HOMEEIGO — INTEGRATION MATRIX

Every external dependency, how it is called, what breaks without it, and its verified status.

---

## 1. Matrix

| # | Provider | Category | Integration method | Used for | Failure behaviour | Status |
|---|---|---|---|---|---|---|
| 1 | **Razorpay** | Payments | Direct REST — `/v1/orders`, `/v1/payments`, `/v1/fund_accounts`, `/v1/balance`; HMAC webhook verification | Booking payment, refunds, partner payouts, balance | Payment reservation reclaim on gateway failure; webhook dedup by event id | VERIFIED |
| 2 | **Google Maps Platform** | Maps / Geo | `maps.googleapis.com/maps/api` + `GOOGLE_MAPS_API_KEY` | Geocoding, place autocomplete, distance, navigation | Partner Android map needs its own key — `EXTERNAL_ARTIFACT_REQUIRED` | VERIFIED |
| 3 | **Twilio** | SMS / Voice | `twilio` package | OTP delivery, job-start OTP | OTP is the auth path — hard dependency | VERIFIED |
| 4 | **Resend** | Email | `RESEND_API_KEY` | Transactional email, partner/customer notifications | Governed channel; failure recorded in delivery audit | VERIFIED |
| 5 | **Expo Push** | Push | `expo-notifications` + `push.adapter.ts` | Job offers, status changes, alerts | Server path verified; device delivery `EXTERNAL_ARTIFACT_REQUIRED` | VERIFIED |
| 6 | **AWS S3** | Storage | `@aws-sdk/client-s3` | KYC documents, job evidence, attachments | Bucket via `AWS_S3_BUCKET` | VERIFIED |
| 7 | **OpenWeather** | Weather | `weather.service.ts`, `WEATHER_API_KEY` | Surge input, ETA adjustment, availability impact | Circuit-broken and fail-safe (returns null, callers degrade) | VERIFIED |
| 8 | **Google BigQuery** | Data warehouse / ML | `@google-cloud/bigquery` | ETL, `ML.FORECAST` / `ML.PREDICT` / `ML.EVALUATE` | Throws → consumers report `MODEL_UNAVAILABLE` | VERIFIED |
| 9 | **Google Vertex AI** | Vision / ML platform | `@google-cloud/aiplatform` — `PredictionServiceClient.generateContent` | Image diagnosis (Gemini vision) | Failure recorded as REAL_PROVIDER + PROVIDER_ERROR | VERIFIED |
| 10 | **Groq** | LLM | Direct HTTPS | Primary LLM in default chain | Falls through to next provider | VERIFIED |
| 11 | **Google Gemini** | LLM | Direct HTTPS | Second in default chain; vision | Falls through | VERIFIED |
| 12 | **OpenAI** | LLM | Direct HTTPS | Third in default chain | Falls through | VERIFIED |
| 13 | **Anthropic** | LLM | Direct HTTPS | Configurable provider | Configurable | VERIFIED |
| 14 | **Sentry** | Observability | `@sentry/bun`, `@sentry/nextjs` ×3 | Error tracking, backend + 3 web apps | Optional package; shape-checked at runtime before use | VERIFIED |
| 15 | **Prometheus** | Metrics | `GET /metrics` text exposition | Operational metrics, bounded labels | Scrape target | VERIFIED |
| 16 | **PostgreSQL 16** | Database | Prisma | System of record | Hard dependency | VERIFIED |
| 17 | **Redis** | Cache / coordination | `ioredis` via `lib/redis.ts` | L2 cache, leader locks, presence, flag cache | **Graceful degradation** — in-memory fallback for locks; disabled under test | VERIFIED |

## 2. Notification channels (4, all governed)

`src/notifications/channels/`: `email.adapter.ts`, `sms.adapter.ts`, `push.adapter.ts`,
`in-app.adapter.ts`.

No feature sends directly through an adapter. Every send passes:

```
routeNotification
  → quiet-hours → preferences → cadence → cooldown
  → channel-policy → containment → decision-audit → adapter
```

**Why this matters:** notification fatigue and compliance are handled once, centrally, rather than
re-implemented per feature. Shadow mode can compute what *would* have been sent without sending.

## 3. Dependency criticality

| Tier | Providers | Impact if unavailable |
|---|---|---|
| **Hard** | PostgreSQL, Twilio (OTP = login), Razorpay (payment) | Core journeys blocked |
| **Degrading** | Redis, BigQuery, OpenWeather, LLM providers, Sentry | Feature degrades with an explicit state; platform continues |
| **Asset-blocked** | Expo push (device), Android Maps key, Sentry DSN, EAS projectId | Verification blocked, not functionality |

The degrading tier is the interesting one: it is degrading **by design**. BigQuery down →
`MODEL_UNAVAILABLE`. Weather down → `WEATHER_UNAVAILABLE`. One LLM down → next provider. Redis down →
in-memory lock fallback. None of these fabricate a value to keep a screen looking full.

## 4. Environment configuration (keys referenced in code)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `RAZORPAY_*` (+ `RAZORPAY_WEBHOOK_SECRET`),
`GOOGLE_MAPS_API_KEY`, `TWILIO_*`, `RESEND_API_KEY`, `AWS_S3_BUCKET`, `WEATHER_API_KEY`,
`GEMINI_API_KEY`, `AI_PROVIDER_ORDER`, `SENTRY_DSN`, `AI_TOOL_CB_THRESHOLD`,
`AI_TOOL_CB_RESET_MS`, `LOAD_TEST_MODE`.

**Not verified in repository:** which environments hold live versus test credentials. Razorpay has
dedicated certification scripts (`cert:razorpay`, `cert:razorpay:refund`), but live-key usage cannot
be confirmed from code and must not be claimed.

## 5. Outstanding external artifacts

| Item | Blocks |
|---|---|
| Expo **EAS projectId** | Partner mobile build pipeline |
| **Sentry DSN** (partner mobile) | Mobile crash reporting |
| **Android Google Maps key** (partner app) | Android map rendering (iOS uses Apple Maps, no key) |
| **Physical device** | Push-delivery confirmation — currently `SERVER_SIDE_OBSERVED` / `PHYSICAL_DELIVERY_NOT_VERIFIED` |
